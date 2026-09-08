# Vite API 路由补救验收报告

日期：2026-09-04
状态：`PARTIAL_ACCEPTANCE_8_LIMITED_18_BLOCKED`
清理：`PENDING_EXACT_CLEANUP`

## 历史失败与范围

原联合验收将P02/R01记为`FAIL_LOCAL_DEV_ROUTE`：本地Vite的宽`/api`前缀代理截获`/api-keys`文档硬刷新，Vue Router运行前即由后端返回404。logout本身当时已通过204、Cookie清空及显式refresh 401。不可变来源为`docs/agents/validation/joint-acceptance-20260904/FINAL-ACCEPTANCE-REPORT.md`（SHA-256 `4147caaef7e745f49126f5689528f580dc8bb1b69e4c2c55d1e59e55324312f2`）；CORE、SECOND、原始JSON和截图继续保留。

本次只补救本地Vite API代理边界并重验P02/R01。生产HTTPS、生产反向代理、部署、后端业务代码、模型、chat与SSE均未运行或修改。

## 候选与评审

- 初始RED边界测试：`8cf9b9b54092432f14ebdaa59d9a963f15ed5f95`。
- 初始代理修复：`717b278985ea3d142a454392d9ad6e5509846a7e`。
- query边界RED测试：`5e1ee58f3477373db6ec414230264bb4ca7af060`。
- 最终query代理实现：`612897c58d362352e4ff2fcd45e80aac6cc14015`。
- 运行候选（含零内容guard重命名）：`c788e78848a08c2fa3472812374448f388fb81aa`。
- writer证据提交：`20ea497ae19a90ca3db949a88bf65e4f369fdb09`。
- Task6评审证据提交：`37ae3845c6ae79b0fcb8a24c42f4730ae15a654d`。

PM结论为`SPEC_PASS`，独立质量结论为`PASS`。独立代码门禁为目标测试2/2、全量134/134、build通过、`git diff --check`通过。独立QA结果SHA-256为`e822b1655465eb233d4a985f7b77dedfdd1120bce87bd1da1e9599fa7b536286`，manifest SHA-256为`a7cf2ba005ebad6ab8dbc08e299aa3af5f01a3404d630f2adb7f5c7af2ce3629`。

## 代理与浏览器结果

实际正向代理矩阵覆盖`/api`、`/api?health=1`、`/api/`、`/api/v1/**`、`/api/public/**`；反向矩阵覆盖`/api-keys`、`/api-keys/`、`/api-admin`、任意`/api-*`文档路径及`/application`。既有target、`changeOrigin`与configure hook保持。

writer与独立QA分别创建新浏览器上下文，均确认：

- 登录后`/api-keys`返回200 HTML，初次导航和硬刷新均渲染私有页面；
- `/users`与`/profile`初次导航和硬刷新回归通过；
- `/api?health=1`及`/api/public/**`返回后端非HTML 404；
- UI logout返回204，Cookie数量为0，显式refresh返回401；
- 退出后直接访问和硬加载`/api-keys`、`/users`、`/profile`均返回SPA文档，最终落到`/login`且私有DOM为0；
- 自动模型目录请求在浏览器发网前中止，没有模型、chat、SSE或上游请求到达后端。

因此P02与R01更新为本地`PASS_LIMITED_SCOPE`。当前聚合为8项限定通过、0项本地路由失败、18项阻塞（16项未实现、1项产品、1项环境）。生产HTTPS仍未运行，本结果不构成完整PRD或生产验收通过。

## 资源状态

cleanup：`PASS`。本地FE、BE进程及15174/8000监听已消失；两个精确容器ID、名称和任务标签均为零残留；精确私有目录、生命周期指针和cleanup环境文件均不存在。独立复核确认无关容器、volume和image清理前后计数及SHA-256一致。清理仅覆盖本任务记录的资源，未执行prune、volume删除、image删除、glob删除或其他容器操作。

该清理结论不扩大验收范围。最终状态仍为本地`PARTIAL_ACCEPTANCE_8_LIMITED_18_BLOCKED`，`web-012`仍为`in_progress`，生产HTTPS与生产反向代理仍未验证。
