# 当前验证进度

## web-011：Issue #4 一次性 API Key 安全复制（本地验证与独立审查通过）

- 2026-09-02：只修改 API Key 复制路径。`copyText(text, environment)` 原生优先；缺失/拒绝时使用临时 readonly textarea，同步复制严格返回 true 才提示成功。显式使用现有 secret input 容器，校验容器连接且属于当前 document，避免 Element Plus 外层 dialog role 超出焦点陷阱。临时节点 finally 清空并移除，恢复焦点、页面选区与输入框选择。
- TDD：空实现先出现 8 个 boolean 断言 RED；焦点恢复异常、页面 Range 覆盖输入选区、显式内容容器、脱离/跨 document 容器分别补 RED 后修复。最终工具 14/14、全量 `npm test` 81/81。既有 secret 清理源码断言更新为仍要求清空且先 abort，并未移除检查。
- 弹窗关闭/卸载同步清空 secret 并 abort 当前复制；已提交给浏览器的原生写入无法撤回，但迟到成功不 toast、迟到拒绝不 fallback。无 Storage、日志或模块级 secret 保留；只保留组件原有一次性 readonly 手动复制入口。
- 本地可见 Chrome 假数据：`/private/tmp/playwright-test-issue4-independent.js` 原生/缺失/拒绝/失败四场景通过（兼容路径实际 execCommand，检查选中文本、真实剪贴板假密钥、dialog 焦点、节点清理、手动选择和关闭清空）；`/private/tmp/playwright-test-issue4-lifecycle.js` close resolve/reject、unmount resolve/reject、fallback throw、选区恢复六场景通过。全部 API 拦截，不使用真实密钥、不连接生产。
- 浏览器 RED 与环境说明：旧页面 native 成功但 missing 时无成功反馈；旧复制在 close 后仍 toast。中间实现发现外层 `[role=dialog]` 不属于 Element Plus 内部焦点陷阱、Chromium Range 恢复重置 input caret，均已回归修正。本地 hard-load `/api-keys` 被既有 `/api` proxy 匹配，验证经已挂载 app router 进入；没有改代理配置。Playwright skill 执行需独立 Chrome 沙箱外权限，未安装依赖。
- `npm run build` 与 `git diff --check` 通过；构建保留既有动态导入/chunk-size 警告。独立 PM/spec PASS、quality/security APPROVE，无 actionable finding；协调任务重新执行全量测试 81/81、构建 7.87s、diff-check 及 Chrome 四复制路径，均通过。真实 HTTPS 生产验收仍未执行；无 push、merge、部署、真实 API Key 创建或 GitHub issue 状态变更。

## web-010：Issue #3 首次历史加载（本地验证通过）

- 2026-09-02：在隔离 issue-resolution worktree 按批准计划开始。先补真实 store 的行为回归，再修初始加载与旧响应竞态；不触及 Issue #4、认证或真实服务。
- 实现：列表选择后 await 对应详情；保留有效选择，失效选择回退第一项并加载。按字符串 GUID 合并在途详情请求；旧 404 仅清理请求 GUID，只有仍选中该 GUID 时才切换并加载回退历史。失败不缓存，原有点击会话入口可重试。真实历史不写 Storage。
- TDD：真实 store 经 Vite SSR 运行，保留 API/mappers，仅替换 Axios transport 与浏览器导航。RED 看到初始消息 undefined（期望历史正文）、详情请求 0（期望 1）、慢 A 404 抢回 B 选择；失效选择回退另行 RED 后修复。最终 11/11 行为用例 GREEN，`npm test` 65/65、`npm run build`、`git diff --check` 通过。
- 可见 Chrome 本地假数据验证：慢 A 200/404/500 不抢 B 选择、不将 A 正文放入 B；初始 500 后点击同会话重试成功；空账号只创建一个新会话；localStorage/sessionStorage 无历史正文。脚本 `/private/tmp/playwright-test-issue3-races.js`，5 个场景均 PASS。
- 验证环境修正：早期 SSR 测试开启客户端预打包，干扰运行中 Vite 缓存，导致浏览器白屏 `Outdated Optimize Dep`；这不是 Issue #3 RED。测试现已禁用客户端预打包，协调任务重启其 5178 服务后浏览器验证通过；未改依赖。构建仍有既有动态导入/chunk-size 警告。
- 仅记录实现者本地证据；独立规格、质量和安全审查由协调任务另行记录。没有 push、merge、部署、生产访问或 GitHub issue 状态变更。
- 质量审查后补充（本地提交 `7471a38` 之后）：确认历史 pending 时发送会过早请求并可能脱离消息数组；先补两个真实 store/SSE 回归得到 RED（请求 1 次而非 0、B 详情未完成时已 ready）。`ensureActive` 现在仅等待当前 GUID 已有的详情 promise，await 后重查最新选择；不增加每次发送 GET、不缓存失败为已加载。13/13 store 回归、全量 67/67、构建、diff-check 通过。浏览器新增第 6 个 send 场景确认带完整历史发送，新问题和流式回答均保留；最终独立复核仍交协调任务记录。
- web-009 的更广泛认证/管理员验收暂停为 blocked；沿用历史证据，本轮不新增通过声明。真实 HTTPS 验收仍待执行。
- 独立复核收尾：PM/spec 与 quality/security 均通过；协调任务独立 Chrome 首次进入/刷新探针与历史竞态 6 场景全部 PASS。最终前端全量测试 81/81、构建与 diff-check 通过；`web-010` 仅代表 Issue #3 本地范围完成。

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
