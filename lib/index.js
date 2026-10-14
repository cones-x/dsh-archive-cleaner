/**
 * dsh-archive-cleaner — DSH 归档会话清理插件
 *
 * 注册三个工具供 AI 助手调用：
 * - clean_workspace_archives     : 扫描并清理工作区中的归档文件/目录
 * - list_dsh_sessions            : 查看 DSH 会话存储状态（含已归档会话）
 * - delete_dsh_archived_sessions : 删除已归档会话的日志文件（释放磁盘空间）
 *
 * @module dsh-archive-cleaner
 */

import { readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// 插件元信息
// ---------------------------------------------------------------------------
export const name = 'archive-cleaner';
export const inject = ['tools'];

// webServer / workspaceRegistry 通过 ctx.get 软查找（agent-teams 同款模式），
// 避免硬依赖导致整个插件在缺服务时拒绝加载。

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
const DSH_DIR = join(homedir(), '.dsh');
const SESSIONS_DIR = join(DSH_DIR, 'sessions');
const WORKSPACE_STORE = join(DSH_DIR, 'storages', 'workspace.json');

// ---------------------------------------------------------------------------
// 帮助函数
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

async function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dirPath, e.name);
      size += e.isDirectory() ? await getDirSize(full) : (await stat(full)).size;
    }
  } catch { /* skip */ }
  return size;
}

function isArchivePattern(name) {
  return /[._-]backup[._-]/i.test(name) || /-backup-/i.test(name) ||
    /[._-]bak[._-]?$/i.test(name) || /\.bak$/i.test(name) ||
    /[._-]old[._-]?$/i.test(name) || /\.old$/i.test(name) ||
    /[._-]archive[._-]?$/i.test(name) ||
    /\.tar\.(gz|bz2|xz|zst)$/i.test(name) || /\.(zip|rar|7z|tgz)$/i.test(name) ||
    /uninstall/i.test(name) || /\.tmp$/i.test(name) || /~$/.test(name);
}

function getWorkspacePath() {
  return process.cwd();
}

/**
 * DSH 将工作区路径编码为目录名：/ → --
 */
function encodeWorkspaceName(wsPath) {
  return wsPath.replace(/\//g, '--');
}

/**
 * 读取 workspace.json
 */
async function readStore() {
  try {
    return JSON.parse(await readFile(WORKSPACE_STORE, 'utf-8'));
  } catch { return null; }
}

/**
 * 原子写入 workspace.json（带备份）
 */
async function writeStore(data) {
  const tmp = WORKSPACE_STORE + '.tmp';
  const bak = WORKSPACE_STORE + '.bak';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  // 备份旧文件
  try { await rm(bak); } catch { /* no old backup */ }
  try { await readFile(WORKSPACE_STORE, 'utf-8'); await writeFile(bak, await readFile(WORKSPACE_STORE, 'utf-8'), 'utf-8'); } catch { /* no old file */ }
  await rm(WORKSPACE_STORE);
  await writeFile(WORKSPACE_STORE, JSON.stringify(data, null, 2), 'utf-8');
  try { await rm(tmp); } catch { /* cleanup */ }
}

/**
 * 扫描所有会话，返回包含完整信息的列表
 */
async function readAllSessions() {
  const result = [];
  try {
    const wss = await readdir(SESSIONS_DIR, { withFileTypes: true });
    for (const ws of wss) {
      if (!ws.isDirectory()) continue;
      const wsPath = join(SESSIONS_DIR, ws.name);
      const sessions = await readdir(wsPath, { withFileTypes: true });
      for (const s of sessions) {
        if (!s.isDirectory() || !s.name.startsWith('session-')) continue;
        const sPath = join(wsPath, s.name);
        try {
          const files = await readdir(sPath);
          const logFile = files.find(f => f.endsWith('.jsonl.zstd'));
          if (!logFile) continue;
          const logStat = await stat(join(sPath, logFile));
          result.push({
            id: s.name,
            workspace: ws.name,
            sPath,
            logFile,
            sizeBytes: logStat.size,
            size: formatBytes(logStat.size),
            lastModified: logStat.mtime.toISOString(),
          });
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return result;
}

// ---------------------------------------------------------------------------
// 工具 1：clean_workspace_archives — 清理工作区归档文件
// ---------------------------------------------------------------------------
const cleanWorkspaceArchivesDef = {
  name: 'clean_workspace_archives',
  description:
    '扫描当前 DSH 工作区，查找并清理归档/备份/临时文件及目录。' +
    '默认 dry_run=true，仅预览不删除。确认后设 dry_run=false 执行实际删除。' +
    '自动识别备份目录、压缩包、卸载残留、临时文件等。',

  parameters: {
    type: 'object',
    properties: {
      dry_run:          { type: 'boolean', description: '仅预览不删除（默认 true）', default: true },
      include_dsh_trash:{ type: 'boolean', description: '同时清理 .dsh-conversation-manager 残留', default: false },
      include_hidden:   { type: 'boolean', description: '扫描隐藏文件（默认 true）', default: true },
    },
    required: [],
  },

  output: {
    schema: {
      type: 'object',
      properties: {
        scanned:  { type: 'number' },
        matched:  { type: 'number' },
        totalSize:{ type: 'string' },
        items:    { type: 'array', items: { type: 'object', properties: { path:{type:'string'}, type:{type:'string'}, size:{type:'string'}, reason:{type:'string'} } } },
        deleted:  { type: 'number' },
        freed:    { type: 'string' },
        errors:   { type: 'array', items: { type: 'string' } },
      },
    },
    render(args, value) {
      const L = [`扫描 ${value.scanned} 个条目，匹配 ${value.matched} 个归档项（共 ${value.totalSize}）。`];
      if (value.items.length) {
        L.push('', '匹配的归档条目：');
        for (const i of value.items) L.push(`  [${i.type}] ${i.path}  ${i.size}  — ${i.reason}`);
      }
      if (value.deleted > 0) L.push('', `✅ 已删除 ${value.deleted} 项，释放 ${value.freed}。`);
      if (value.errors.length) { L.push('', '⚠ 删除错误：'); for (const e of value.errors) L.push(`  - ${e}`); }
      if (args.dry_run && value.matched > 0) L.push('', '💡 预览模式。确认后请设 dry_run=false 执行删除。');
      return [{ type: 'text', text: L.join('\n') }];
    },
  },

  async execute(args) {
    const dryRun = args.dry_run !== false;
    const wsPath = getWorkspacePath();
    const items = [], errors = [];
    let scanned = 0, totalBytes = 0, deleted = 0, freedBytes = 0;

    async function scan(dir, depth) {
      let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name === 'dsh-archive-cleaner') continue;
        if (e.name.startsWith('.') && !args.include_hidden) continue;
        scanned++;
        const full = join(dir, e.name), rel = relative(wsPath, full);
        let reason = null;
        if (isArchivePattern(e.name)) reason = '文件名匹配归档模式';
        if (!reason && args.include_dsh_trash && e.name === '.dsh-conversation-manager') reason = 'DSH 会话管理器残留';

        if (reason) {
          const sz = e.isDirectory() ? await getDirSize(full) : (await stat(full)).size;
          totalBytes += sz;
          items.push({ path: rel, type: e.isDirectory() ? 'directory' : 'file', size: formatBytes(sz), reason });
          if (!dryRun) {
            try { await rm(full, { recursive: true, force: true }); deleted++; freedBytes += sz; }
            catch (err) { errors.push(`${rel}: ${err.message}`); }
          }
        }
        if (e.isDirectory() && depth < 2) await scan(full, depth + 1);
      }
    }
    await scan(wsPath, 0);
    return { scanned, matched: items.length, totalSize: formatBytes(totalBytes), items, deleted, freed: formatBytes(freedBytes), errors };
  },
};

// ---------------------------------------------------------------------------
// 工具 2：list_dsh_sessions — 查看会话存储状态
// ---------------------------------------------------------------------------
const listDshSessionsDef = {
  name: 'list_dsh_sessions',
  description:
    '查看 DeepSeek Harness 会话存储信息：当前工作区的所有会话、已归档/已钉选会话列表、各会话日志大小和最后修改时间。' +
    '若需释放空间，用 delete_dsh_archived_sessions 删除已归档会话日志。',

  parameters: { type: 'object', properties: {}, required: [] },

  output: {
    schema: {
      type: 'object',
      properties: {
        currentWorkspace:    { type: 'string' },
        archivedSessionIds:  { type: 'array', items: { type: 'string' } },
        pinnedSessionIds:    { type: 'array', items: { type: 'string' } },
        sessions:            { type: 'array', items: { type: 'object', properties: { id:{type:'string'}, workspace:{type:'string'}, size:{type:'string'}, sizeBytes:{type:'number'}, lastModified:{type:'string'}, isArchived:{type:'boolean'}, isPinned:{type:'boolean'}, deletable:{type:'boolean'} } } },
        totalActive:         { type: 'number' },
        totalArchived:       { type: 'number' },
        archivedTotalSize:   { type: 'string' },
        note:                { type: 'string' },
      },
    },
    render(args, value) {
      const L = [
        `当前工作区: ${value.currentWorkspace}`,
        `活动会话: ${value.totalActive} 个  |  已归档: ${value.totalArchived} 个（共 ${value.archivedTotalSize}）  |  已钉选: ${value.pinnedSessionIds.length} 个`,
      ];
      if (value.sessions.length) {
        L.push('', '会话详情：');
        for (const s of value.sessions) {
          const tags = [];
          if (s.isArchived) tags.push('📦已归档');
          if (s.isPinned) tags.push('📌已钉选');
          if (!s.isArchived && !s.isPinned) tags.push('活跃');
          tags.push(s.deletable ? '🗑可删除' : '🔒不可删');
          L.push(`  ${s.id}  ${s.size}  ${s.lastModified}  ${tags.join(' ')}`);
        }
      }
      L.push('', `💡 ${value.note}`);
      return [{ type: 'text', text: L.join('\n') }];
    },
  },

  async execute() {
    const wsPath = getWorkspacePath();
    const store = await readStore();
    const archivedIds = store?.global?.archivedSessionIds ?? [];
    const pinnedIds   = store?.global?.pinnedSessionIds ?? [];
    const sessions = await readAllSessions();

    for (const s of sessions) {
      s.isArchived = archivedIds.includes(s.id);
      s.isPinned   = pinnedIds.includes(s.id);
      s.deletable  = s.isArchived && !s.isPinned;  // 只有已归档且未钉选的可删
    }

    const currentWsEncoded = encodeWorkspaceName(wsPath);
    const filtered = sessions.filter(s =>
      s.workspace === currentWsEncoded || s.isArchived || s.isPinned
    );

    const archivedSessions = sessions.filter(s => s.isArchived);
    const archivedBytes = archivedSessions.reduce((sum, s) => sum + s.sizeBytes, 0);
    const activeCount = sessions.filter(s => !s.isArchived).length;

    const deletableCount = archivedSessions.filter(s => !s.isPinned).length;
    const note = archivedSessions.length > 0
      ? `有 ${archivedSessions.length} 个已归档会话（其中 ${deletableCount} 个可删除），日志共占用 ${formatBytes(archivedBytes)}。` +
        `用 delete_dsh_archived_sessions 可彻底删除并释放空间。`
      : '当前没有已归档会话。';

    return {
      currentWorkspace: wsPath,
      archivedSessionIds: archivedIds,
      pinnedSessionIds: pinnedIds,
      sessions: filtered,
      totalActive: activeCount,
      totalArchived: archivedSessions.length,
      archivedTotalSize: formatBytes(archivedBytes),
      note,
    };
  },
};

// ---------------------------------------------------------------------------
// 工具 3：delete_dsh_archived_sessions — 删除已归档会话
// ---------------------------------------------------------------------------
const deleteDshArchivedSessionsDef = {
  name: 'delete_dsh_archived_sessions',
  description:
    '⚠️ 危险操作：永久删除已归档的 DSH 会话日志文件，释放磁盘空间。' +
    '默认 dry_run=true 预览模式。只能删除已归档且未钉选的会话。' +
    '删除后同时更新 workspace.json 移除对应归档记录。' +
    '先用 list_dsh_sessions 查看哪些可删除，再调用本工具。',

  parameters: {
    type: 'object',
    properties: {
      dry_run:     { type: 'boolean', description: '仅预览不删除（默认 true，⚠️ 必须确认后设 false）', default: true },
      session_ids: { type: 'array',  items: { type: 'string' }, description: '要删除的会话 ID 列表。为空且 delete_all_archived=true 时删除所有可删归档会话。' },
      delete_all_archived: { type: 'boolean', description: '删除所有已归档且未钉选的会话（session_ids 为空时生效，默认 false）', default: false },
    },
    required: [],
  },

  output: {
    schema: {
      type: 'object',
      properties: {
        dryRun:        { type: 'boolean' },
        candidates:    { type: 'array', items: { type: 'object', properties: { id:{type:'string'}, workspace:{type:'string'}, size:{type:'string'}, lastModified:{type:'string'}, status:{type:'string'} } } },
        deletedCount:  { type: 'number' },
        skippedCount:  { type: 'number' },
        freed:         { type: 'string' },
        errors:        { type: 'array', items: { type: 'string' } },
        summary:       { type: 'string' },
      },
    },
    render(args, value) {
      const L = [`${value.dryRun ? '🔍 预览模式' : '⚠️ 执行删除'}：候选 ${value.candidates.length} 个会话`];
      if (value.candidates.length) {
        L.push('');
        for (const c of value.candidates) L.push(`  ${c.status === 'deleted' ? '✅' : c.status === 'skipped' ? '⏭' : '🔍'} ${c.id}  ${c.size}  ${c.lastModified}  [${c.status}]`);
      }
      if (value.deletedCount > 0) L.push('', `✅ 已删除 ${value.deletedCount} 个会话，释放 ${value.freed}。`);
      if (value.skippedCount > 0) L.push('', `⏭ 跳过 ${value.skippedCount} 个（非归档/已钉选/不存在）。`);
      if (value.errors.length) { L.push('', '⚠ 错误：'); for (const e of value.errors) L.push(`  - ${e}`); }
      if (value.dryRun && value.deletedCount === 0 && value.candidates.length > 0) L.push('', '💡 预览完毕。确认后设 dry_run=false 执行删除。');
      L.push('', value.summary);
      return [{ type: 'text', text: L.join('\n') }];
    },
  },

  async execute(args) {
    const dryRun = args.dry_run !== false;
    const store = await readStore();
    const archivedIds = new Set(store?.global?.archivedSessionIds ?? []);
    const pinnedIds   = new Set(store?.global?.pinnedSessionIds ?? []);
    const allSessions = await readAllSessions();

    // 构建 id → session 映射
    const sessionMap = new Map(allSessions.map(s => [s.id, s]));

    // 确定要处理的会话 ID
    let targetIds;
    if (args.session_ids?.length) {
      targetIds = args.session_ids;
    } else if (args.delete_all_archived) {
      targetIds = [...archivedIds].filter(id => !pinnedIds.has(id));
    } else {
      return { dryRun, candidates: [], deletedCount: 0, skippedCount: 0, freed: '0 B', errors: ['请提供 session_ids 或设 delete_all_archived=true'], summary: '未指定要删除的会话。' };
    }

    const candidates = [];
    const errors = [];
    let deletedCount = 0, skippedCount = 0, freedBytes = 0;
    const actuallyDeletedIds = [];

    for (const sid of targetIds) {
      const s = sessionMap.get(sid);
      if (!s) {
        candidates.push({ id: sid, workspace: '?', size: '?', lastModified: '?', status: 'skipped' });
        skippedCount++;
        errors.push(`${sid}: 会话目录不存在`);
        continue;
      }

      // 安全检查：只能删除已归档且未钉选的
      if (!archivedIds.has(sid)) {
        candidates.push({ id: sid, workspace: s.workspace, size: s.size, lastModified: s.lastModified, status: 'skipped' });
        skippedCount++;
        errors.push(`${sid}: 不是已归档会话，拒绝删除`);
        continue;
      }
      if (pinnedIds.has(sid)) {
        candidates.push({ id: sid, workspace: s.workspace, size: s.size, lastModified: s.lastModified, status: 'skipped' });
        skippedCount++;
        errors.push(`${sid}: 已钉选会话，拒绝删除`);
        continue;
      }

      candidates.push({ id: sid, workspace: s.workspace, size: s.size, lastModified: s.lastModified, status: dryRun ? 'would-delete' : 'deleted' });

      if (!dryRun) {
        try {
          await rm(s.sPath, { recursive: true, force: true });
          deletedCount++;
          freedBytes += s.sizeBytes;
          actuallyDeletedIds.push(sid);
        } catch (err) {
          errors.push(`${sid}: 删除失败 — ${err.message}`);
          candidates[candidates.length - 1].status = 'error';
        }
      }
    }

    // 更新 workspace.json（仅在非 dry-run 且有实际删除时）
    if (!dryRun && actuallyDeletedIds.length > 0 && store) {
      const newArchived = store.global.archivedSessionIds.filter(id => !actuallyDeletedIds.includes(id));
      store.global.archivedSessionIds = newArchived;

      // 同时清理 tables.workspaces 中的 sessionIds
      if (store.tables?.workspaces) {
        for (const [wsId, wsData] of Object.entries(store.tables.workspaces)) {
          if (wsData.sessionIds) {
            wsData.sessionIds = wsData.sessionIds.filter(id => !actuallyDeletedIds.includes(id));
          }
        }
      }

      try {
        await writeStore(store);
      } catch (err) {
        errors.push(`更新 workspace.json 失败: ${err.message}`);
      }
    }

    const summary = dryRun
      ? `预览完成：${candidates.length} 个候选会话可删除，预计释放 ${formatBytes(candidates.reduce((s, c) => s + (sessionMap.get(c.id)?.sizeBytes ?? 0), 0))}。`
      : `已删除 ${deletedCount} 个会话，跳过 ${skippedCount} 个，释放 ${formatBytes(freedBytes)}。`;

    return { dryRun, candidates, deletedCount, skippedCount, freed: formatBytes(freedBytes), errors, summary };
  },
};

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------
const WEB_SERVER_KEYS = ['webServer', 'httpServer'];

export function apply(ctx, config) {
  // 注册工具（AI 会话侧）—— 立即注册，不依赖其他服务
  const disposers = [
    ctx.tools.register(cleanWorkspaceArchivesDef),
    ctx.tools.register(listDshSessionsDef),
    ctx.tools.register(deleteDshArchivedSessionsDef),
  ];
  ctx.on('dispose', () => disposers.forEach(d => d()));

  // ---- Web 路由（Client UI 侧调用）----
  // 懒注册：先试一次，webServer 未就绪则监听 internal/service 事件重试
  // （与 dsh-agent-teams 同款模式，避免 apply() 执行时 webServer 尚未绑定）
  let webRegistered = false;

  function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function registerWebSurface() {
    if (webRegistered) return;
    const rawWs = WEB_SERVER_KEYS.map(k => ctx.get(k)).find(v => v && typeof v.register === 'function');
    if (!rawWs) return;  // webServer 尚未绑定，等事件重试

    const connection = ctx.get('connection');
    function authorized(req) {
      if (!connection || typeof connection.requestRejection !== 'function') return true;
      return connection.requestRejection(req) === undefined;
    }

    webRegistered = true;

    // GET：返回归档/钉选会话 ID 列表，供 ⋯ 菜单项判定可见性
    ctx.effect(() => rawWs.register({
      kind: 'exact',
      path: '/plugins/dsh-archive-cleaner/status',
      handler: async (req, res) => {
        if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
        const store = await readStore();
        json(res, 200, {
          archivedSessionIds: store?.global?.archivedSessionIds ?? [],
          pinnedSessionIds: store?.global?.pinnedSessionIds ?? [],
        });
      },
    }), 'archive-cleaner: status route');

    // POST：永久删除一个已归档且未钉选的会话
    ctx.effect(() => rawWs.register({
      kind: 'exact',
      path: '/plugins/dsh-archive-cleaner/delete-session',
      handler: async (req, res) => {
        if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
        try {
          const body = await readJsonBody(req);
          const { sessionId } = body;
          if (!sessionId || typeof sessionId !== 'string') return json(res, 400, { error: '缺少 sessionId' });

          const store = await readStore();
          const archivedIds = new Set(store?.global?.archivedSessionIds ?? []);
          const pinnedIds   = new Set(store?.global?.pinnedSessionIds ?? []);
          if (!archivedIds.has(sessionId)) return json(res, 400, { error: '该会话未归档，不能删除' });
          if (pinnedIds.has(sessionId))   return json(res, 400, { error: '该会话已钉选，不能删除' });

          const sessions = await readAllSessions();
          const target = sessions.find(s => s.id === sessionId);
          if (!target) return json(res, 404, { error: '会话目录未找到（可能已删除）' });

          await rm(target.sPath, { recursive: true, force: true });

          // 同步 durable 注册表：移除归档标记与各工作区的 sessionIds 引用
          if (store) {
            store.global.archivedSessionIds = store.global.archivedSessionIds.filter(id => id !== sessionId);
            if (store.tables?.workspaces) {
              for (const wsData of Object.values(store.tables.workspaces)) {
                if (wsData.sessionIds) wsData.sessionIds = wsData.sessionIds.filter(id => id !== sessionId);
              }
            }
            await writeStore(store);
          }
          json(res, 200, { ok: true, freed: target.size, freedBytes: target.sizeBytes });
        } catch (err) {
          json(res, 500, { error: err && err.message ? err.message : String(err) });
        }
      },
    }), 'archive-cleaner: delete route');
  }

  // 先试一次，如果 webServer 已就绪则立即注册
  registerWebSurface();
  // webServer 尚未绑定时，监听服务绑定事件重试
  ctx.on('internal/service', (name) => {
    if (WEB_SERVER_KEYS.includes(name)) registerWebSurface();
  });
}

/** 读取 JSON 请求体 */
async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
