# 当前验证进度

## web-009：一期用户名认证与可撤销会话

- 2026-08-31：隔离 worktree 完成认证迁移。Access Token 和用户摘要仅存 Pinia/模块内存；Refresh 仅由浏览器 HttpOnly Cookie 携带。
- 2026-08-31：新增 `src/api/auth-session.test.js`，先确认模块缺失导致 RED，后验证内存无 Storage 写入、401 单飞刷新/一次重放、刷新失败清理和会话 DTO 白名单。
- 2026-08-31：`npm test` 通过（49/49）；`npm run build` 通过。保留既有 Vite/Rollup 注释、动态导入和 chunk 体积警告。

未执行真实 HTTPS 浏览器 E2E：后端 Refresh Cookie 固定 `Secure; HttpOnly; SameSite=Lax`，需要 HTTPS 页面和配置在 `AUTH_TRUSTED_ORIGINS` 中的同源 Origin。管理员创建/角色展示未做：后端没有创建端点，且 `AdminUser` DTO 未提供 username/role。

## web-008：模型选择搜索

- 2026-08-27：`node --test src/utils/model-search.test.js` 通过（5/5），覆盖名称、ID、厂商、描述字段的本地匹配，以及单选/对比控件共用过滤列表的组件契约。
- 2026-08-27：`npm test` 通过（44/44）。
- 2026-08-27：`npm run build` 通过；仅保留既有 Vite/Rollup 警告（注释、动态导入与 chunk 体积）。
- 2026-08-27：`git diff --check` 通过。

未运行需后端认证的浏览器手动 smoke；`web-002` 更广泛的模型面板浏览器端到端验证仍未完成。
