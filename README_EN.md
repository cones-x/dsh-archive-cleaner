# dsh-archive-cleaner

> DeepSeek Harness plugin: clean up workspace archive files + inject a "Delete Permanently" button into the session "⋯" menu.

DSH (DeepSeek Harness) only ships an "Archive session" action — archived session logs still occupy disk space and cannot be removed from the UI. This plugin fills that gap:

- 🗑 **"Delete Permanently" in the session ⋯ menu** — right-click an archived session in the sidebar, click "🗑 Delete Permanently" to permanently remove its log file.
- 🤖 **3 AI tools** — ask the AI in chat to inspect / batch-delete archived sessions and clean up workspace archive files.

## Features

### 1. Session menu "Delete Permanently" button (UI)

On any **archived** session in the sidebar, open the `⋯` menu — a red "🗑 Delete Permanently" item appears at the bottom:

```
📌 Pin
✏️ Rename
🌱 Fork
📦 Archive
🗑 Delete Permanently   ← injected by this plugin
```

- Only shown for **archived and unpinned** sessions (safety guard).
- A browser confirm dialog appears; deletion runs only after a second confirmation.
- Deletes the on-disk log file and synchronizes `workspace.json`.
- The session disappears from the sidebar after restarting DSH.

### 2. AI conversation tools

| Tool | Purpose |
|------|---------|
| `list_dsh_sessions` | Inspect DSH session storage: active / archived / pinned sessions, log sizes, last-modified times. |
| `delete_dsh_archived_sessions` | Batch-delete archived session logs (dry-run preview, by ID, or delete-all). |
| `clean_workspace_archives` | Scan and clean archive files in the workspace (backup dirs, archives, uninstall leftovers, temp files). |

**Usage examples** (just say it in a DSH chat):

> Show me which archived sessions are taking up space

> Delete all archived sessions to free up space

> Scan the workspace for archive files that can be cleaned up

## Installation

### Option 1: via `dsh plugin` (recommended)

```bash
dsh plugin --profile desktop add @conessun/dsh-archive-cleaner
```

### Option 2: local path

```bash
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-archive-cleaner
```

Then add the bundle to `dsh.profile.bundles` in the profile's `package.json`:

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

**Restart DeepSeek Harness** after install.

## Technical Architecture

```
dsh-archive-cleaner/
├── package.json              # dsh.bundle.patch + dsh.client.inject metadata
├── cordis.patch.yml          # host insert config (insert include:archive-cleaner)
├── lib/
│   ├── index.js              # host: 3 AI tools + 2 web routes (lazy-registered)
│   ├── client.js             # client: __ModuleLoader__.load format, React menu component
│   └── types/
│       ├── index.d.ts        # host type declarations
│       └── client.d.ts       # client type declarations
├── README.md
├── README_EN.md
├── LICENSE
└── CHANGELOG.md
```

### Key design choices

- **Lazy web route registration**: `webServer` may not be bound when `apply()` runs; we retry on the `ctx.on('internal/service')` event (same pattern as the official dsh-agent-teams).
- **Client-side plain-script format**: `client.js` must be wrapped in `window.__ModuleLoader__.load({id, factory})` — no `import/export` (the renderer parses it as a classic script).
- **Safety guards**: a session must be archived AND unpinned before deletion is allowed.
- **Atomic writes**: `workspace.json` is written to a temp file then swapped; a `.bak` backup is kept.

## Compatibility

- DeepSeek Harness `>= 0.2.0-rc.2`
- Node.js `^22.19.0 || >=24`
- Web (Electron desktop) only

## Safety notes

- Deletion is irreversible; session log files are permanently removed from disk.
- Double protection: the button only appears on archived sessions + a browser confirm dialog.
- `workspace.json` is backed up to `.bak` before each write.

## Development

```bash
# Syntax check
node --check lib/index.js
node --check lib/client.js

# Local dev: link-install into your profile
cd ~/.dsh/profiles/desktop
pnpm add /path/to/your/dev/dsh-archive-cleaner
```

Restart DSH after changes (HMR does not cover bundle-structure changes).

## License

[MIT](./LICENSE)
