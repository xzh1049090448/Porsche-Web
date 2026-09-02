# 当前验证进度

## web-010：Issue #3 首次历史加载（本地验证通过）

- 2026-09-02：在隔离 issue-resolution worktree 按批准计划开始。先补真实 store 的行为回归，再修初始加载与旧响应竞态；不触及 Issue #4、认证或真实服务。
- 实现：列表选择后 await 对应详情；保留有效选择，失效选择回退第一项并加载。按字符串 GUID 合并在途详情请求；旧 404 仅清理请求 GUID，只有仍选中该 GUID 时才切换并加载回退历史。失败不缓存，原有点击会话入口可重试。真实历史不写 Storage。
- TDD：真实 store 经 Vite SSR 运行，保留 API/mappers，仅替换 Axios transport 与浏览器导航。RED 看到初始消息 undefined（期望历史正文）、详情请求 0（期望 1）、慢 A 404 抢回 B 选择；失效选择回退另行 RED 后修复。最终 11/11 行为用例 GREEN，`npm test` 65/65、`npm run build`、`git diff --check` 通过。
- 可见 Chrome 本地假数据验证：慢 A 200/404/500 不抢 B 选择、不将 A 正文放入 B；初始 500 后点击同会话重试成功；空账号只创建一个新会话；localStorage/sessionStorage 无历史正文。脚本 `/private/tmp/playwright-test-issue3-races.js`，5 个场景均 PASS。
- 验证环境修正：早期 SSR 测试开启客户端预打包，干扰运行中 Vite 缓存，导致浏览器白屏 `Outdated Optimize Dep`；这不是 Issue #3 RED。测试现已禁用客户端预打包，协调任务重启其 5178 服务后浏览器验证通过；未改依赖。构建仍有既有动态导入/chunk-size 警告。
- 仅记录实现者本地证据；独立规格、质量和安全审查由协调任务另行记录。没有 push、merge、部署、生产访问或 GitHub issue 状态变更。
- web-009 的更广泛认证/管理员验收暂停为 blocked；沿用历史证据，本轮不新增通过声明。真实 HTTPS 验收仍待执行。

## web-009：一期用户名认证与可撤销会话

- 2026-08-31：隔离 worktree 完成认证迁移。Access Token 和用户摘要仅存 Pinia/模块内存；Refresh 仅由浏览器 HttpOnly Cookie 携带。
- 2026-08-31：新增 `src/api/auth-session.test.js`，先确认模块缺失导致 RED，后验证内存无 Storage 写入、401 单飞刷新/一次重放、刷新失败清理和会话 DTO 白名单。
- 2026-08-31：`npm test` 通过（49/49）；`npm run build` 通过。保留既有 Vite/Rollup 注释、动态导入和 chunk 体积警告。
- 2026-08-31：原生 SSE、对话 Markdown 导出及分析权限/Excel 导出统一走内存 Bearer 的单飞 Cookie 刷新路径；401 仅重放一次，刷新失败或二次 401 会清空内存并只跳转一次。登录、刷新及用户状态仅保留 `guid/username/nickname/role/status` 白名单。`npm test` 54/54、`npm run build`、`git diff --check` 通过。

未执行真实 HTTPS 浏览器 E2E：后端 Refresh Cookie 固定 `Secure; HttpOnly; SameSite=Lax`，需要 HTTPS 页面和配置在 `AUTH_TRUSTED_ORIGINS` 中的同源 Origin。管理员创建/角色展示未做：后端没有创建端点，且 `AdminUser` DTO 未提供 username/role。

## web-008：模型选择搜索

- 2026-08-27：`node --test src/utils/model-search.test.js` 通过（5/5），覆盖名称、ID、厂商、描述字段的本地匹配，以及单选/对比控件共用过滤列表的组件契约。
- 2026-08-27：`npm test` 通过（44/44）。
- 2026-08-27：`npm run build` 通过；仅保留既有 Vite/Rollup 警告（注释、动态导入与 chunk 体积）。
- 2026-08-27：`git diff --check` 通过。

未运行需后端认证的浏览器手动 smoke；`web-002` 更广泛的模型面板浏览器端到端验证仍未完成。
