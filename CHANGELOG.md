# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-13

### Added
- 🗑 会话 ⋯ 菜单注入「彻底删除」按钮（客户端 React 组件，仅对已归档且未钉选的会话显示）
- `list_dsh_sessions` 工具：查看 DSH 会话存储状态（活动/已归档/已钉选、日志大小、最后修改时间）
- `delete_dsh_archived_sessions` 工具：批量删除已归档会话日志（支持 dry-run、按 ID、一键全删）
- `clean_workspace_archives` 工具：扫描并清理工作区归档文件（备份目录、压缩包、卸载残留、临时文件）
- Web 路由 `/plugins/dsh-archive-cleaner/status`（GET）和 `/plugins/dsh-archive-cleaner/delete-session`（POST）
- 客户端 `__ModuleLoader__.load` 格式，注入 `sidebar.workspaces.session.menu.item` slot
- 宿主端懒注册 Web 路由（`ctx.on('internal/service')` 事件重试，避免 webServer 未就绪时跳过）
- `workspace.json` 原子写入 + `.bak` 备份
- 安全保护：拒绝删除未归档/已钉选的会话

### Fixed
- 修复 `package.json` 的 `dsh` 字段格式（`dsh.bundle.patch` + `dsh.client.inject`），解决 `not-bundle` 错误
- 修复 `client.js` 使用 `export` 语句导致 Renderer 解析失败（`Uncaught SyntaxError: Unexpected token 'export'`）
- 修复 `apply()` 执行时 `webServer` 未绑定导致路由注册被跳过（改用懒注册模式）

## [0.1.0] - 2026-10-12

### Added
- 初始版本：`clean_workspace_archives` 工具（扫描工作区归档文件）
- 初始版本：`list_dsh_sessions` 工具（查看会话存储状态）
- Cordis 插件骨架（`name`、`inject`、`apply`）
- `cordis.patch.yml` 插入配置
- TypeScript 类型声明
