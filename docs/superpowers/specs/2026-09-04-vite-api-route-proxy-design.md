# Vite API代理与客户端路由边界修复设计

日期：2026-09-04

状态：APPROVED_DESIGN

范围：本地Vite开发/联合验收环境的代理匹配边界

## 背景与问题

2026-09-04本地FE+BE联合验收中，P02与R01最终状态为`FAIL_LOCAL_DEV_ROUTE`。当前`vite.config.js`使用`'/api'`作为代理前缀；Vite因此也匹配浏览器文档路由`/api-keys`。对`/api-keys`执行hard reload时，请求在Vue Router运行前被代理到后端并返回404，SPA fallback没有机会返回前端入口文档。

该失败不属于logout、Cookie清理或后端会话撤销：两个独立`127.0.0.1`上下文均观察到logout 204、浏览器上下文Cookie清空、显式refresh 401，并且没有渲染私有API Key DOM。第二阶段报告只在logout后直达路由的早期解释上取代核心阶段结论，原始证据继续保留。

## 目标

代理规则只接管真正的API命名空间：精确的`/api`和以`/api/`开头的请求。名称以`/api-`开头的客户端文档路由必须留给Vite SPA fallback。

目标行为：

- `/api/v1/**`继续代理到现有后端target。
- 未来的`/api/public/**`自动落入同一代理边界，无需新增前缀。
- `/api-keys`以及任意`/api-*`客户端文档路由不进入代理，并由SPA fallback加载前端应用。
- 登录后的`/api-keys` hard reload能够渲染对应页面。
- logout后直达或hard reload `/api-keys`进入登录页，且没有私有API Key DOM。

## 方案比较

### 方案1：正则代理键（采用）

把Vite proxy键从`'/api'`改为`'^/api(?:/|$)'`。Vite对以`^`开头的代理键按正则匹配；该表达式只接受`/api`本身或紧随`/`的后代路径。

优点：

- 一条规则覆盖当前`/api/v1/**`和未来`/api/public/**`。
- API命名空间边界由路径结构表达，不依赖客户端路由清单。
- `/api-keys`及其他`/api-*`天然不匹配。
- 变更集中在现有proxy键，现有target、`changeOrigin`及`chat/compare`响应头处理保持不变。

风险是后续开发者可能误把前端文档路由放到`/api/`下面；该空间在本设计中明确保留给后端API。

### 方案2：维护显式API前缀（拒绝）

分别配置`/api/v1`、`/api/public`及后续每个API前缀。

该方案能避开`/api-keys`，但每次新增API版本或公共命名空间都必须同步Vite配置和测试。漏配会产生只在本地环境出现的404或直连差异，维护成本和漂移风险高于单一命名空间边界，因此拒绝。

### 方案3：针对客户端路由绕过（拒绝）

保留`'/api'`代理，再为`/api-keys`增加bypass、rewrite或专用例外。

该方案把代理配置耦合到当前客户端路由名。新增任意`/api-*`页面时仍会复发，并且例外顺序容易掩盖真实API匹配问题。因此拒绝route-specific bypass。

## 设计决定

采用方案1，把代理键精确改为：

```js
'^/api(?:/|$)'
```

其他代理属性不变。请求处理边界如下：

1. Vite收到请求。
2. 正则命中精确`/api`或`/api/`后代时，继续使用现有后端target和proxy hooks。
3. 正则不命中`/api-keys`或其他`/api-*`路径时，不进入后端代理。
4. 对浏览器文档导航，Vite SPA fallback返回前端入口，随后Vue Router执行认证与页面路由。

`/api/`命名空间继续专用于后端API；客户端页面不得新增在该命名空间内。

## 修改范围

实施只允许修改：

- `vite.config.js`：替换proxy匹配键，不改target、`changeOrigin`或现有proxy hook。
- 针对代理边界的测试：建议新增根目录`vite.config.test.js`，使用`node:test`读取实际配置中的proxy键并验证匹配矩阵。

本方案不修改：

- 后端代码、路由、DTO、数据库或Redis。
- logout、refresh、Cookie、Access Token或认证状态机。
- Vue Router业务路由和`/api-keys`页面实现。
- 生产反向代理、生产HTTPS、部署或发布配置。

## 测试设计

### 配置边界测试

测试必须读取实际Vite配置中的代理匹配键，不能在测试里复制另一份独立规则作为唯一被测对象。至少覆盖：

| 请求路径 | 是否代理 |
| --- | --- |
| `/api` | 是 |
| `/api/` | 是 |
| `/api/v1/auth/login` | 是 |
| `/api/v1/users/me?include=profile` | 是 |
| `/api/public/models` | 是 |
| `/api-keys` | 否 |
| `/api-keys/` | 否 |
| `/api-admin` | 否 |
| `/api-any-future-page` | 否 |
| `/application` | 否 |

测试还要断言现有target、`changeOrigin`和`chat/compare`hook仍存在，避免修复边界时丢失当前代理行为。

### 本地真实联合重跑

使用新的隔离本地FE+BE环境重新执行P02/R01：

1. 验证`/api/v1/**`真实请求仍到达后端；追加验证`/api/public/**`代理边界，可使用不会写数据的已知路径或受控404确认请求确实到达后端。
2. 登录后访问并hard reload `/api-keys`，确认返回前端文档并渲染API Key页面。
3. 执行真实logout，确认204、浏览器Cookie清空和显式refresh 401。
4. logout后直达并hard reload `/api-keys`，确认进入登录页且不存在主布局或私有API Key DOM。
5. 保存请求去向、HTTP状态、稳定URL和DOM断言；不保存密码、token、Cookie值或带凭据URL。

## 验收门禁

实现候选只有同时满足以下条件才能提交质量复核：

- 代理边界测试全部通过。
- `npm test`通过。
- `npm run build`通过；既有已记录警告可保留，新增错误不接受。
- `git diff --check`通过。
- P02与R01在新的真实本地联合环境完成重跑，`/api-keys`不再由后端返回文档404。
- 登录后hard reload渲染页面；logout后直达进入登录页且无私有DOM。
- 原CORE与SECOND失败证据继续保留，不覆盖或删除。

生产HTTPS、生产反向代理和真实发布仍需独立验收。本地P02/R01通过不能自动把生产P02、R01、R02或完整PRD标为通过。

## 失败处理

- 如果`/api/v1/**`不再到达后端，停止验收，保留失败请求与Vite日志，先核对正则键是否由当前Vite版本按预期解析。
- 如果`/api-keys`仍被代理，保存实际请求URL、响应来源和代理日志；不得通过放宽认证断言或隐藏404来通过测试。
- 如果SPA fallback成功但认证守卫行为失败，将其作为独立认证/路由问题处理，不扩大本代理修复范围。
- 如果`/api/public/**`未被代理，视为边界实现失败；不得改回显式多前缀方案绕过本设计决定。

## 回滚

若正则代理键导致现有API请求无法代理，回滚仅撤销`vite.config.js`的代理键修改及其配套边界测试。回滚会恢复已知的`/api-keys` hard reload失败，因此回滚后P02/R01必须重新标为`FAIL_LOCAL_DEV_ROUTE`或未通过，不能沿用修复候选的验收结果。

回滚不触及后端、认证状态、生产配置或已归档联合验收证据。

## 风险

- Vite版本或代理插件对正则键的解析行为可能变化；配置边界测试和真实代理请求共同防止静态假阳性。
- 未来若把客户端页面放入`/api/`命名空间，它会按设计进入后端代理；路由评审必须保持该命名空间保留规则。
- 单元测试只能证明匹配配置，无法证明SPA fallback、Vue Router和认证状态的组合行为；P02/R01真实本地重跑仍是必需门禁。
- 本地Vite结果不能代表生产HTTPS或生产反向代理；生产仍需要单独的路由、Cookie、安全头和hard reload验收。

## 证据

- [联合验收第二阶段报告](../../agents/validation/joint-acceptance-20260904/SECOND-PHASE-REPORT.md)
- [联合验收最终报告](../../agents/validation/joint-acceptance-20260904/FINAL-ACCEPTANCE-REPORT.md)
- [26项机器可读矩阵](../../agents/validation/joint-acceptance-20260904/acceptance-matrix.json)
- [P02三上下文原始摘要](../../agents/validation/joint-acceptance-20260904/p02-three-contexts.json)
- [当前Vite配置](../../../vite.config.js)
