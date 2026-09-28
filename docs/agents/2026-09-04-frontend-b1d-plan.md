# FE B1-D 只读用户管理候选实现

状态：实现者本地候选已完成，等待独立 FE 质量审查与 PM 最终复核；不代表真实后端联调或整体 PRD 验收。

## 已实现范围

- `Users.vue` 提供 `/users` 的筛选、排序、分页、错误清理与重试；`UserDetail.vue` 提供 `/users/:guid` 的只读详情。现有 `/` Chat 路由保持不变。
- `admin-users` API 与状态层严格校验 B1-D 的查询、精确 DTO 字段、UTC `Z` 时间、分页和 GUID；分页越界只回退末页一次，并同步 Element Plus 当前页，避免其总数收缩时的重复 `current-change` 请求。
- 菜单与页面只消费内存中的 `permissionProjection`。`login`、`refresh`、嵌套 `self` 与平铺 `users/me` 都替换投影；投影缺失或损坏会清管理页面数据。相同投影不会无谓清页，实际权限修订会失效并重载。
- Root 查看 Admin 详情时才请求目录和权限详情；无写按钮、金额、分组或 Mock 业务操作。

## 已完成本地验证

- Node 行为测试覆盖 DTO/目录/权限语义、Unicode、认证世代、迟到响应、身份失效、分页回退通知和 Root 权限加载。
- 合成 API Chrome 场景覆盖首次 refresh 401 后登录、硬刷新恢复、桌面与移动、筛选排序、403/503 数据清理与重试、缺失/非法投影恢复、相同投影保留列表、Root 权限请求及一次分页回退。最终证据见 `docs/agents/validation/b1d-20260904/`。

## 仍待执行

- 真实 B1-D 后端、数据库和真实认证会话联调。
- 100k 数据量与生产性能验证。
- 独立 FE 质量审查、PM 最终复核及 PRD 的其余接口/联合用例验收。
