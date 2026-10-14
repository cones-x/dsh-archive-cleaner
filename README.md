# dsh-archive-cleaner

> DeepSeek Harness 插件：清理工作区归档文件 + 在会话 ⋯ 菜单注入「彻底删除」按钮

DSH（DeepSeek Harness）官方只提供「归档会话」功能，归档后的会话日志仍占用磁盘空间且无法从界面删除。本插件补齐这个缺口：

- 🗑 **会话 ⋯ 菜单注入「彻底删除」** —— 侧边栏右键已归档会话，点「🗑 彻底删除」即可永久删除日志文件
- 🤖 **3 个 AI 工具** —— 在对话中让 AI 帮你查看/批量删除归档会话、清理工作区归档文件

## 功能概览

### 1. 会话菜单「彻底删除」按钮（UI）

在侧边栏任意**已归档**会话上点击 `⋯` 菜单，底部会出现红色的「🗑 彻底删除」：

```
📌 钉选
✏️ 重命名
🌱 分支
📦 归档
🗑 彻底删除   ← 本插件注入
```

- 仅对**已归档且未钉选**的会话显示（安全保护）
- 点击后弹出浏览器确认框，二次确认后执行删除
- 删除磁盘日志文件 + 同步更新 `workspace.json` 注册表
- 重启 DSH 后该会话从侧边栏彻底消失

### 2. AI 对话工具

| 工具 | 用途 |
|------|------|
| `list_dsh_sessions` | 查看 DSH 会话存储状态：活动/已归档/已钉选会话列表、日志大小、最后修改时间 |
| `delete_dsh_archived_sessions` | 批量删除已归档会话日志（支持 dry-run 预览、按 ID 删除、一键全删） |
| `clean_workspace_archives` | 扫描并清理工作区中的归档文件（备份目录、压缩包、卸载残留、临时文件等） |

**使用示例**（在 DSH 对话中直接说）：

> 帮我查看当前有哪些已归档会话占用了多少空间

> 把所有已归档会话都删掉释放空间

> 扫描一下工作区里有没有可以清理的归档文件

## 安装

### 方式一：通过 `dsh plugin` 命令（推荐）

```bash
dsh plugin --profile desktop add @conessun/dsh-archive-cleaner
```

### 方式二：本地路径安装

```bash
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-archive-cleaner
```

然后在 profile 的 `package.json` 的 `dsh.profile.bundles` 中添加：

```json
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "@conessun/dsh-archive-cleaner"
    ]
  }
}
```

安装后**重启 DeepSeek Harness** 即可生效。

## 技术架构

```
dsh-archive-cleaner/
├── package.json              # dsh.bundle.patch + dsh.client.inject 元信息
├── cordis.patch.yml          # 宿主插入配置（insert include:archive-cleaner）
├── lib/
│   ├── index.js              # 宿主端：3 个 AI 工具 + 2 个 Web 路由（懒注册）
│   ├── client.js             # 客户端：__ModuleLoader__.load 格式，React 菜单组件
│   └── types/
│       ├── index.d.ts        # 宿主端类型声明
│       └── client.d.ts       # 客户端类型声明
├── README.md
├── README_EN.md
├── LICENSE
└── CHANGELOG.md
```

### 关键设计

- **懒注册 Web 路由**：`apply()` 执行时 `webServer` 服务可能尚未绑定，采用 `ctx.on('internal/service')` 事件重试机制（与官方 dsh-agent-teams 同款模式）
- **客户端纯脚本格式**：`client.js` 必须用 `window.__ModuleLoader__.load({id, factory})` 包装，不能用 `import/export`（Renderer 按 classic script 解析）
- **安全保护**：删除前校验会话必须是「已归档且未钉选」，拒绝删除活动会话和钉选会话
- **原子写入**：更新 `workspace.json` 时先写临时文件再替换，写入前自动备份 `.bak`

## 兼容性

- DeepSeek Harness `>= 0.2.0-rc.2`
- Node.js `^22.19.0 || >=24`
- 仅支持 Web（Electron 桌面端）平台

## 安全说明

- 删除操作不可撤销，会话日志文件将从磁盘永久删除
- 已通过双重保护：仅对已归档会话显示按钮 + 浏览器确认框二次确认
- `workspace.json` 写入前自动备份为 `.bak` 文件
- 建议定期检查 `~/.dsh/storages/workspace.json.bak`

## 开发

```bash
# 语法检查
node --check lib/index.js
node --check lib/client.js

# 本地开发：用 link 方式安装到 profile
cd ~/.dsh/profiles/desktop
pnpm add /path/to/your/dev/dsh-archive-cleaner
```

修改代码后重启 DSH 即可生效（HMR 不覆盖 bundle 结构变更）。

## License

[MIT](./LICENSE)
