/**
 * dsh-archive-cleaner — DSH 归档会话清理插件
 *
 * Tools:
 * - clean_workspace_archives     : scan & delete workspace archive files
 * - list_dsh_sessions            : inspect DSH session storage (archived/pinned)
 * - delete_dsh_archived_sessions : permanently delete archived session logs
 */

export const name = 'archive-cleaner';
export const inject: readonly ['tools'];

export interface CleanWorkspaceArgs  { dry_run?: boolean; include_dsh_trash?: boolean; include_hidden?: boolean }
export interface DeleteSessionsArgs  { dry_run?: boolean; session_ids?: string[]; delete_all_archived?: boolean }

export interface ArchiveItem  { path: string; type: 'file' | 'directory'; size: string; reason: string }
export interface SessionInfo  { id: string; workspace: string; sPath: string; logFile: string; size: string; sizeBytes: number; lastModified: string; isArchived: boolean; isPinned: boolean; deletable: boolean }
export interface DelCandidate { id: string; workspace: string; size: string; lastModified: string; status: string }

export interface CleanResult  { scanned: number; matched: number; totalSize: string; items: ArchiveItem[]; deleted: number; freed: string; errors: string[] }
export interface ListResult   { currentWorkspace: string; archivedSessionIds: string[]; pinnedSessionIds: string[]; sessions: SessionInfo[]; totalActive: number; totalArchived: number; archivedTotalSize: string; note: string }
export interface DeleteResult { dryRun: boolean; candidates: DelCandidate[]; deletedCount: number; skippedCount: number; freed: string; errors: string[]; summary: string }

export function apply(ctx: {
  tools: { register(def: Record<string, unknown>): () => void };
  on(event: string, handler: () => void): void;
}, config: Record<string, unknown>): void;
