# Porsche-Web 前端领域架构

实施工作树：feature/auth-p0-harden，基于前端认证分支6f8fbca（其父为main@9e13351）复用加固。后端契约基线90abbdc49513039fa9218a6ce72d3147fbf1721e，用户明确确认 https://aiportcloud.com 运行该版本；公开health返回200不单独证明部署SHA。旧后端main@e0efac2并非本轮契约目标。

## 最新同步

2026-09-03按用户要求已拉取前端origin/main@7fbf616、后端origin/main@0bab2b7。本分支将新前端历史加载/复制修复与P0合并；新后端代码在Porsche/.worktrees/frontend-alignment-latest核对。90abbdc仍仅是之前用户确认的部署版本，新main是否部署需另有证据。此前验证不能替代合并后验证。

## 开工与角色

先读 [AGENTS.md](../../AGENTS.md)、[README.md](../../README.md)、[progress.md](../../progress.md)、[feature_list.json](../../feature_list.json)、[interface-contract.json](../../interface-contract.json)，确认实际工作树、分支、revision 和已有修改。Explorer 是协调者自己执行的只读探索阶段。角色范围、启动和交接见 [启动说明](README.md) 与 [协同模板](collaboration-templates.md)。

## 当前技术与分层

- Vue 3.5、Vue Router 4、Element Plus 2、Pinia 2、Vite 6；使用 JavaScript 与 Vue SFC，未配置 TypeScript strict。
- npm：package.json 提供 test（node --test）、dev、build、preview。未配置 ESLint、Prettier、Stylelint 或 Lighthouse 脚本，不把建议工具写成已生效门禁。
- src/router/index.js：固定路由和 requiresAuth/guest 登录守卫；未实现按角色动态路由或完整按钮 RBAC。
- src/views 与 src/layouts：页面和布局；src/components：组件；src/stores：Pinia 状态。
- src/api/request.js：Axios、Bearer header、响应正文解包与错误处理；src/api/platform.js：fetch POST 流。
- src/utils/sse.js：SSE 解帧；src/utils/platform-mappers.js：数据映射；src/utils/storage.js：localStorage 封装。

## 认证对齐与证据层级

本轮用户已确认目标90abbdc与域名，并批准M1后实施M2。九个auth端点与GET users/me已按双方协调者书面确认落盘 [interface-contract.json](../../interface-contract.json)，其agreed_for_implementation状态仅表示实施合同，不代表联合验收通过。

原前端main的手机号/localStorage实现与目标不兼容；既有6f8fbca用户名分支只提供复用基础，仍需补齐M1并发、失败关闭、跨用户隔离及SSE终态。不得将旧main、领域文档、候选历史验收或本地测试混成同一发布状态。

执行顺序及M1边界见 [P0实施计划](../superpowers/plans/2026-09-02-auth-p0-implementation.md)。实现完成后的证据由progress与验证报告记录，不能仅凭本说明判passing。Access只存内存；共享浏览器存储只允许非敏感协调标志，不能写Token、SID、密码或profile。AuthUser与业务profile独立，服务端仍负责权限。

## SSE 与权限

当前采用 fetch POST + ReadableStream，支持自定义 Authorization 和请求体；不是 EventSource。消费者识别 message delta、chunk、model_done、model_error、error，以及 JSON type=meta/done；处理 [DONE]、CRLF、多行 data。未确认自动重连、事件 id 恢复或 ping 约定，不能写成现有能力。非幂等生成请求不得未经确认自动重放。

前端权限用于显示控制，服务端负责实际授权。应覆盖 token 过期、撤销、跨用户 GUID、模型 ACL 和路由跳转；登录态判断不能替代 RBAC 验收。

## 测试隔离

按 [工程规范](../conventions/frontend-standards.md)、[API 契约规范](../conventions/api-contract-standards.md) 和 [数据规范](../conventions/database-standards.md) 执行。Mock 单测、浏览器 E2E、真实接口联调分别记录。使用专用环境和账号，不读取生产 .env 或写生产数据。

init.sh 包含 npm install 和 npm run build，会改变依赖/产物。M2已授权本地安装和验证；不得因此执行部署或正式站点写请求。只读角色输出报告，由被授权写入者保存。
