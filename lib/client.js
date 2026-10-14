/**
 * dsh-archive-cleaner client — 在会话 ⋯ 菜单中注入「彻底删除」项。
 *
 * DSH Client half 约定：纯脚本，由 window.__ModuleLoader__.load 包装，
 * 通过 factory(require) 取 react，通过 exports.apply/exports.inject 导出。
 * 禁止 import/export 语句（Renderer 按 classic script 解析）。
 */
window.__ModuleLoader__.load({
	id: "dsh-archive-cleaner",
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");

		var STATUS_URL = "/plugins/dsh-archive-cleaner/status";
		var DELETE_URL = "/plugins/dsh-archive-cleaner/delete-session";

		/**
		 * 会话 ⋯ 菜单中的删除项。
		 * ownerProps 由 slot 宿主注入：{ sessionId, displayTitle }。
		 * 仅在会话已归档且未钉选时渲染；删除走 host 端 HTTP 路由。
		 */
		function DeleteMenuItem(props) {
			var sessionId = props.sessionId;
			var displayTitle = props.displayTitle || "Untitled";
			var _visible = React.useState(false);
			var visible = _visible[0], setVisible = _visible[1];
			var _busy = React.useState(false);
			var busy = _busy[0], setBusy = _busy[1];
			var _done = React.useState(false);
			var done = _done[0], setDone = _done[1];

			// 菜单打开（组件挂载）时向 host 查询该会话的归档/钉选状态
			React.useEffect(function () {
				var cancelled = false;
				fetch(STATUS_URL)
					.then(function (r) { return r.json(); })
					.then(function (data) {
						if (cancelled) return;
						var archived = (data.archivedSessionIds || []).indexOf(sessionId) !== -1;
						var pinned = (data.pinnedSessionIds || []).indexOf(sessionId) !== -1;
						setVisible(archived && !pinned);
					})
					.catch(function () { /* 查询失败则不显示 */ });
				return function () { cancelled = true; };
			}, [sessionId]);

			if (!visible || done) return null;

			function onClick(e) {
				e.preventDefault();
				e.stopPropagation();
				var ok = window.confirm(
					"⚠️ 永久删除会话「" + displayTitle + "」？\n\n" +
					"会话日志文件将从磁盘彻底删除，此操作不可撤销。"
				);
				if (!ok) return;
				setBusy(true);
				fetch(DELETE_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId: sessionId })
				})
					.then(function (r) {
						return r.json().then(function (body) {
							if (!r.ok) throw new Error(body.error || ("HTTP " + r.status));
							return body;
						});
					})
					.then(function () {
						setDone(true);
						// 关闭菜单（合成 Esc，best-effort）
						try {
							document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
						} catch (_) { /* noop */ }
						window.alert("已删除。重启 DSH 后该会话从侧边栏彻底消失。");
					})
					.catch(function (err) {
						window.alert("删除失败: " + (err && err.message ? err.message : String(err)));
						setBusy(false);
					});
			}

			return React.createElement("button", {
				role: "menuitem",
				onClick: onClick,
				disabled: busy,
				style: {
					display: "block",
					width: "100%",
					padding: "6px 12px",
					border: "none",
					background: "none",
					textAlign: "left",
					color: busy ? "#999" : "#e53e3e",
					cursor: busy ? "not-allowed" : "pointer",
					fontSize: "13px",
					lineHeight: "1.5"
				}
			}, busy ? "Deleting…" : "🗑 彻底删除");
		}

		function apply(ctx) {
			// 注册进会话 ⋯ 菜单，order=500 排在 pin(100)/rename(200)/fork(300)/archive(400) 之后
			ctx.slots.inject("sidebar.workspaces.session.menu.item", function () {
				return ctx.slots.register({
					name: "sidebar.workspaces.session.menu.item",
					id: "archive-cleaner.delete",
					order: 500,
					label: "彻底删除"
				}, DeleteMenuItem);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
