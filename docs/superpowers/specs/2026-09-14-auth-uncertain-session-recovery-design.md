# 认证未决会话恢复设计

日期：2026-09-14

状态：APPROVED_DESIGN

范围：Porsche-Web 登录、刷新和退出三类认证 Cookie 操作的未决状态恢复

## 背景与问题

生产登录页在认证状态为 `uncertain` 时显示“已在本地退出；服务端会话状态尚未确认，认证操作已暂停”，并禁用登录。页面提供“检查恢复状态”按钮，但当前 `authSession.recover()` 只在 Web Lock 内重读 `porsche_auth_coordination_v1`：只要持久记录仍含 `pending`/`suppressed`，或内存状态已经是 `uncertain`，函数就再次抛出 `auth_uncertain`。它不会调用 `/api/v1/auth/refresh`、`/api/v1/auth/self` 或 `/api/v1/auth/logout`，因此无法产生新的服务端证据，也无法从该状态收敛。

2026-09-14 已核对：

- Porsche-Web `origin/main` 为 `72c4d8c182486cc440da02cfc137a2260d85b8c8`。
- Porsche 后端 `origin/main` 为 `6ce8e48657cd8bc6a86b286503fde3d0d670749f`。
- 生产入口加载 `index-jg1SRd-U.js`、`request-Uhs-Y70_.js` 和 `AuthStatus-DkgLD0tG.js`，包含同一未决状态逻辑。
- 当前 `interface-contract.json` 为 `v1.0.0-p0` / `agreed_for_implementation`，已定义 refresh `200 LoginResponse` 和 logout `204`；本设计不改变这些接口。

该故障发生在前端发送恢复请求之前，不能归因于本次用户名、密码或后端登录响应。最常见触发条件是先前 login、refresh 或 logout 请求出现网络错误、超时、`5xx`、无效响应或标签页中断，留下故意持久化的未决标记。浏览器能力或站点存储不可用也会进入同一内存状态，但当前 UI 将两类原因混在一个提示里。

## 目标

- 让“检查恢复状态”真正取得服务端证据并将 login、refresh、logout 未决状态安全收敛。
- 保持 Access Token 仅在内存，Refresh Token 仅存在于 HttpOnly Cookie。
- 保持跨标签 Cookie 操作串行化，不因恢复引入重复登录、身份串线或旧响应发布。
- 对登录/刷新未决，恢复有效会话或明确进入未登录状态。
- 对退出未决，始终以“完成退出”为目标；不得因发现会话仍有效而把用户直接恢复为登录状态。
- 将浏览器能力不足与服务端状态未确认拆成不同提示。
- 网络结果仍不明确时继续 fail closed，并允许用户再次显式检查。

## 非目标

- 不恢复改密码、撤销单个会话、撤销其他会话或其他认证写操作的业务结果。
- 不新增或修改后端接口、DTO、Cookie 属性、CORS、可信 Origin、数据库、Redis 或会话模型。
- 不自动清除未决记录，不用 TTL、刷新页面、取消请求或页面卸载推断请求结果。
- 不把协调记录扩展为凭据存储；其中不得出现用户名、密码、Token、SID、用户资料或响应正文。
- 不执行生产部署、真实账号操作或服务端会话清理。

## 方案比较

### 方案 1：前端复用现有 refresh/logout 接口（采用）

在 Web Lock 内由显式恢复流程读取未决类型，并通过现有接口取得服务端证据。login/refresh 未决使用 refresh 收敛；logout 未决先用 refresh 判断会话是否仍有效，有效时继续完成一次 logout。

优点是无需改变后端契约，变更集中在现有认证状态机和状态组件；现有 Refresh Cookie、Access Token 响应校验和 logout 语义均可复用。风险是退出恢复最多包含 refresh 和 logout 两个顺序请求；任一阶段再次不明确时必须继续保留未决状态。

### 方案 2：新增后端协调接口（拒绝）

新增幂等服务端接口，集中处理“确认会话”与“确保退出”。该方案可减少前端编排，但需要跨仓库合同、后端实现、部署和联合验收；现有接口已足以完成本次三类恢复，因此范围与交付成本不成比例。

### 方案 3：超时或直接删除本地标记（拒绝）

达到 TTL 后自动解除锁定，或允许用户直接清除协调记录。该方案不能证明服务端是否创建、刷新或撤销了会话，可能遗留有效服务端会话或覆盖另一个标签页的身份变化，违反现有 fail-closed 边界。

## 状态与记录

现有协调记录继续使用：

```js
{
  epoch: 'non-sensitive-identity-epoch',
  pending: { operationId, kind, epoch } | null,
  suppressed: boolean,
}
```

本次不新增凭据字段。恢复函数在取得 Web Lock 后重新读取记录，并以锁内记录为权威输入。处理 `pending.kind` 为 `login`、`refresh` 或 `logout` 的记录。现有实现还会在 logout 收到明确 4xx 后写出 `{ pending: null, suppressed: true }`；该精确形态在当前代码中只由 logout 产生，因此作为兼容的 `legacy-logout` 未决状态进入 logout 恢复。其他结构不合法或类型不在允许集合中的记录保持 `uncertain` 并返回不可自动恢复结果。

恢复开始后不得覆盖原 `operationId` 或提前清除 `pending`。服务端结果明确并且写入协调存储成功后，才允许发布新的内存状态与跨标签通知。

## 恢复流程

### 能力预检

1. 检查安全上下文、Web Locks、BroadcastChannel 和可读写 localStorage。
2. 任一能力不可用时不发送认证网络请求，返回 `auth_capability_unavailable`。
3. Browser adapter 提供可重复执行的能力探测，使用独立、非敏感、立即删除的 probe key 验证 localStorage 写后可读，并按需创建 BroadcastChannel；不得只依赖模块初始化时冻结的 `available` 布尔值。
4. 能力恢复后允许重新读取协调记录；不得仅因内存状态已经是 `uncertain` 就拒绝恢复。
5. 若协调记录干净但内存状态因先前能力不足仍为 `uncertain`，将其视作初始化 refresh 恢复：refresh `200` 恢复会话，明确 `401` 进入 anonymous，其他结果继续 uncertain。

### login 或 refresh 未决

1. 持有现有认证 Web Lock。
2. 保存当前 `epoch` 和未决操作标识，并调用现有 `POST /api/v1/auth/refresh`。
3. 收到 `200` 时按现有 `validateLoginResponse` 校验完整 `LoginResponse`。
4. 响应有效且锁内记录仍匹配时，清除 `pending`/`suppressed`，推进新的 `epoch` 并发布跨标签失效通知，再仅在发起恢复的标签页把 Access Token 和过滤后的 AuthUser 发布为 `authenticated`。
5. 收到明确的 refresh `401` 时，清除 `pending`/`suppressed`，推进新的匿名 `epoch`，发布跨标签失效通知并进入 `anonymous`。
6. 超时、取消、网络错误、`408`、`5xx`、响应解析失败、登录响应校验失败、协调记录漂移或存储写失败时，保留原未决记录并保持 `uncertain`。

refresh `403` 表示 Origin 或会话约束异常，不足以证明浏览器无有效会话；保持 `uncertain`，不得当作匿名成功。

### logout 未决

1. 持有同一 Web Lock，并调用现有 `POST /api/v1/auth/refresh`。
2. refresh 明确 `401` 表示当前 Refresh Cookie 已不可用于建立会话；清除未决记录，推进匿名 `epoch`，发布失效通知并确认退出完成。
3. refresh `200` 时校验 `LoginResponse`，但不把该身份发布到 UI。Access Token 只作为锁内完成退出的临时值。
4. 使用该 Access Token 和当前 Refresh Cookie 调用一次现有 `POST /api/v1/auth/logout`。
5. logout `204` 后清除未决记录，推进匿名 `epoch`，发布失效通知并保持 `anonymous`。
6. refresh 成功后的 logout `401`、`403` 或其他非 `204` 响应不能证明 Refresh 会话已经失效；不得发布 refresh 返回的用户或 Access Token，也不得清除未决记录。
7. refresh/logout 任一阶段出现网络错误、超时、`408`、`4xx`（refresh 的明确 `401` 除外）、`5xx`、无效响应、记录漂移或存储失败时，继续保持 `uncertain`。用户可再次显式检查；不得自动循环重试。

退出恢复不是后台重放原请求，而是用户主动触发的、持锁的会话收敛动作。若 refresh 成功但 logout 结果再次不明确，后续检查重新从 refresh 开始；后端的 refresh 轮换结果负责处理合法 Cookie，前端仍不猜测第一次 logout 是否完成。

### 非本次范围操作

`password`、`revoke-session`、`revoke-others` 或未知 kind 的未决结果无法通过 refresh 判断原写操作是否完成。恢复流程不得清除其记录或重新发送操作，只返回 `auth_recovery_unsupported`，保持认证操作暂停并提示人工核对。

## 并发与身份隔离

- 恢复与 login、refresh、logout、密码和会话撤销共用 `porsche_auth_cookie_v1` Web Lock。
- 获取锁后必须重新读取记录；锁外快照不能授权网络请求。
- 每个响应落地前再次比较 `epoch`、`operationId`、pending epoch 和 kind。任何变化都按 `identity_changed`/`auth_uncertain` 失败关闭。
- 恢复期间不向 Pinia、DOM、日志或 BroadcastChannel 发布临时 Access Token 或用户数据。
- BroadcastChannel 只发送失效类型和新 epoch；共享存储仍是权威来源。
- 同时点击或多个标签页恢复时只允许一个恢复流程发送请求。后续调用在锁内看到 epoch 已变化且记录已收敛后同步为 anonymous 并解除未决，不重复发送恢复请求。由于 Access Token 禁止跨标签共享，只有发起请求的标签页可进入 authenticated；其他标签页之后有独立访问需求时按正常初始化流程使用 Refresh Cookie 建立自己的内存会话。

## UI 与错误处理

`AuthStatus.vue` 根据原因显示两个独立状态：

1. 能力不可用：显示“当前浏览器环境不支持安全认证”，列出安全上下文、Web Locks、BroadcastChannel 或站点存储要求；不显示会误导为服务端已收到请求的文案。
2. 服务端结果未确认：显示“上一次认证请求结果尚未确认”，提供“检查恢复状态”。

检查期间按钮进入 loading，登录、注册和重复检查保持禁用。恢复结果：

- login/refresh 恢复为 authenticated：路由守卫使用原安全 redirect 进入目标页面。
- logout `204` 或 refresh 明确 `401` 收敛为 anonymous：解除登录按钮；保留组件内已填写的用户名，不读取、记录或持久化密码。
- 再次不明确：保留检查按钮并显示“仍未确认，可在网络恢复后重试”。
- 非本次范围：显示“该认证操作结果需要人工核对”，不承诺自动恢复。

组件只渲染状态与触发 store/session API，不复制协调、HTTP 或身份判断逻辑。

## 修改范围

实施预计只修改或新增：

- `src/api/auth-browser.js`：可重复执行且能区分失败原因的能力探测。
- `src/api/auth-session.js`：可测试的恢复状态机。
- `src/api/auth-refresh.js` 或 `src/api/request.js`：向恢复流程注入无拦截器的 refresh/logout transport；保持普通 cookieOperation 行为不变。
- `src/components/AuthStatus.vue`：能力、未决、恢复中和结果提示。
- `src/stores/user.js`：如路由/UI 需要，暴露最小恢复动作或响应式恢复状态。
- 对应 `src/api/*.test.js`、`src/components/*.test.js` 和登录页挂载测试。

若实现无需 store 变更，不应为了结构对称而修改 `src/stores/user.js`。不得修改 `interface-contract.json`，因为现有方法、路径、认证、请求和响应均不变。

## 测试设计

### 状态机单元测试

login 与 refresh 未决分别覆盖：

- refresh `200` 且响应有效，清标记并恢复 authenticated。
- refresh 明确 `401`，清标记并进入 anonymous。
- `403`、`408`、`5xx`、网络错误、取消和非法 `LoginResponse` 保持 uncertain。
- 本地写失败、记录漂移和 epoch 变化不发布身份。

logout 未决覆盖：

- refresh `401` 直接确认 anonymous，零 logout。
- refresh `200` 后 logout `204`，全程不发布临时身份。
- refresh `200` 后 logout `401`、`403` 或其他非 `204` 响应保留原标记。
- 两个阶段分别发生超时、网络错误、其他 `4xx`、`5xx` 或非法响应时保留原标记。
- 第二次显式恢复可从第一次再次不明确的记录安全重试。
- `{ pending: null, suppressed: true }` 按 legacy logout 恢复；其他畸形或未知记录零网络并保持 uncertain。

并发与范围覆盖：

- 两个 manager/标签页并发恢复只产生一条恢复网络序列；发起者可恢复 authenticated，观察到新 epoch 的另一标签页收敛为 anonymous 且不接收 Token/User。
- BroadcastChannel 延迟或丢失时，共享存储仍阻止旧身份响应。
- 页面刷新、组件卸载和请求取消不清除未决记录。
- password、revoke-session、revoke-others 和未知 kind 返回 unsupported，零认证请求。
- 能力不可用时零网络；能力重新可用后重新建立 Browser adapter 协调能力，不受旧内存 `uncertain` 状态永久阻塞。

### 组件与浏览器验证

- 挂载真实 `AuthStatus.vue`，分别验证能力不足和服务端未决文案。
- 检查期间 loading、登录/注册禁用和重复点击抑制。
- anonymous 收敛后登录按钮恢复；authenticated 收敛后安全 redirect 生效。
- production build + synthetic backend 在两个真实浏览器标签页执行 login/refresh/logout 未决矩阵。
- Network 证据确认 login/refresh 恢复只有一个 refresh；logout 恢复为 refresh 后最多一个 logout；非范围操作为零请求。
- 不在测试证据、日志、截图或错误文案中保存密码、Token、Cookie、SID 或完整响应正文。

### 回归命令

- 新增测试先在未修改实现上产生可解释 RED，再进行最小实现并转为 GREEN。
- 运行认证相关定向测试。
- 显式提供现有权威合同路径后运行完整 `npm test`，不得以缺合同 skip 代替通过。
- `VITE_USE_MOCK=false npm run build`。
- production bundle sentinel/扫描及 `git diff --check`。
- 按完整认证风险流程执行 Explorer、Developer、Spec Review、Quality/Test Gate，并把各结论绑定同一 review snapshot、最终 revision 和 `interface-contract.json` 内容哈希。

## 验收标准

- 生产缺陷可在未修改版本稳定复现，新回归测试先 RED。
- login、refresh、logout 三类未决状态按本设计的明确响应收敛。
- 能力不足与服务端结果未确认不再共用同一提示。
- logout 恢复发现有效会话时不会把用户恢复为登录状态，而是继续完成退出。
- 网络不明确、记录漂移、存储失败和非范围操作继续 fail closed。
- Access Token、Refresh Cookie、用户数据和密码的存储边界不变。
- 全量测试、生产构建、bundle 隔离检查、浏览器双标签矩阵、diff check、独立规格与质量门禁全部通过。

通过上述本地门禁只代表前端候选通过。生产部署、真实账号和公开 HTTPS 恢复验收需要单独授权与证据，不随代码完成自动通过。

## 回滚

回滚仅撤销恢复状态机、UI 分流和对应测试。回滚后必须恢复为当前 fail-closed 行为，并明确重新暴露“未决状态无法自动恢复”的已知缺陷；不得只删除测试或放宽断言来声称回滚安全。

回滚不修改后端、Cookie、数据库、Redis、生产配置、历史协调记录或既有验收证据。

## 风险

- logout 恢复是两阶段网络序列，第二阶段仍可能不明确；设计通过保留原标记和允许显式重试处理，而不是猜测结果。
- refresh 会轮换 Cookie；恢复代码必须使用无普通业务重试的认证 transport，并与现有锁共享，不得经 Axios 401 拦截器递归刷新。
- 将明确 `401` 收敛为匿名只适用于 refresh。refresh 成功后的 logout `401` 仍不能证明 Refresh 会话失效；`403`、未知 4xx 和错误体漂移同样不能泛化为匿名。
- UI 自动跳转必须复用现有安全 redirect 过滤，不能从未决记录或响应正文构造目标 URL。
- 当前协调记录没有服务端 operation query；本设计因此严格限制为能用会话终态判断的三类操作，不能外推到其他写动作。
