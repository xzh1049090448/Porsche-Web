# PRD-260903 管理员用户管理与公共页面体系综合设计评审稿（PRD-260903-DESIGN-r3）

状态：设计 review 草案。适用 FE `25a66a4ad546a481941dfc6e0cc9bc75da2e631b`、BE `aec1619ee710c80cd71dbe529660e2d12b3fda7b` 同名分支。本文不覆盖根 `interface-contract.json`，不授权实现、迁移、部署或线上测试。

## 推荐方案与替代方案

用户已确认 `/` 官网、`/chat` 对话入口、默认公开价格与受控统一开关建议，以及权限/票据安全方向和排除范围。该确认批准设计进入后续实施准备，不冻结 DTO、接口草案或验收证据；User 无 email 仍为基线差异。

推荐保留 Vue 3 + JavaScript + Vite + Pinia + Element Plus，在现有认证客户端上增加 PublicLayout、AdminLayout、真实管理 service/store 和隔离金额 Mock。管理动作和能力判断走真实 API；金额仅在开发/测试入口使用合成 fixture，不进入生产包、query、storage、真实 GUID、票据或审计链路。

替代方案一是纯 SPA，改动少但不能满足公共页真实 HTML、SEO 和受保护报价要求；不推荐。替代方案二是 Vue SSR，引入新的运行和缓存复杂度；仅在预渲染无法满足真实动态策略时评估。React 重写是独立替代方案，不是 SSR 前提，也不纳入本期。推荐 Vue 预渲染公共页面并由 Go 统一请求门禁。

## 路由、布局和组件

公共路由：`/`、`/pricing`、`/pricing/:modelKey`、`/about`、`/terms`、`/privacy`、公共 404。管理路由：`/users`、`/users/audit`、`/users/:guid`、`/system-settings/site`、`/system-settings/public-content`。既有 `/profile`、`/billing`、`/api-keys` 保留，原对话迁移到 `/chat`。静态 `/users/audit` 必须先于参数路由匹配。

`PublicLayout` 只读取已发布公共 DTO，包含公共头、页脚、SEO 壳和匿名错误态；不得加载管理数据。`AdminLayout` 负责侧栏、顶栏、面包屑、能力驱动导航、403 和退出，不把能力显示当作授权。页面组件只组装，服务层通信，store 管共享状态。

建议任务文件：`src/layouts/PublicLayout.vue`、`src/layouts/AdminLayout.vue`；`src/views/public/{Home,Pricing,PricingDetail,About,Terms,Privacy,PublicNotFound}.vue`；`src/views/admin/{Users,UserDetail,UserAudit,Groups,PublicContent,SiteSettings,BalanceMock}.vue`；配套 `src/api/admin-*.js`、`src/api/public-*.js`、`src/api/mock-balance.js`、`src/stores/admin-*.js` 及 admin/public 组件。具体命名可在 writer 任务中调整，但不得与真实/Mock边界混淆。

## 数据流和 API 边界

真实管理 API 族为 PRD 拟定草案：`/admin/v2/users`、`/admin/v2/users/:guid`、`actions`、`sessions`、`audit-events`、`user-audit-events`、`action-verifications`、`authz/catalog`、`permissions`、`groups`、`/admin/v2/public-content`。公共 API 族为 `/api/public/site`、`/api/public/pages/:slug`、`/api/public/models` 和 `/api/public/models/:modelKey`。

每个接口必须先冻结 method、request、response、分页、错误、能力和版本字段。建议分页为 `items,total,page,page_size`，page size 20/50/100；冲突 409；错误 400/401/403/404/409/429/503 并带 request ID。未知字段、重复 JSON key 和未声明金额字段拒绝。GUID 对外始终字符串，时间按 DTO 约定的 UTC 文本，内部 id/user_id 不外露。

认证响应 `login/refresh/self/users/me` 可选统一投影 `admin_permissions: string[]` 与 `permissions_version`；字段缺失时前端不给管理能力。用户状态、权限、plan、group、model ACL 和 password reset 变更统一触发 AuthVersion/会话与 Gateway ACL 失效，Gateway 放行范围为全局允许范围 ∩ 最新用户 ACL ∩ Key 自身 ACL，并校验 Key 状态及请求模型。密码重置撤销会话但不自动删除 Gateway Key；禁用/删除时所有凭据拒绝，启用不恢复已撤销会话或 Key。DB 最新状态读取失败必须 fail closed，outbox 只做传播，不是唯一安全屏障。B0 还需逐项审查旧 `/admin/users`、`/admin/logs`、`/admin/logs/alerts`、`alerts/dashboard` 及其子路由等入口，确保绑定错误、未知字段和全局告警读写不能绕过新 capability；无合法 capability 不默认放 Root，B0 先做客户端兼容盘点再收紧或受控退役；本期不扩展为全量系统设置。

账户授权由共享动作服务和独立 authz 模块组成。判断顺序：actor 最新状态 → Root/self/同级硬边界 → 目标可见性 → 动作能力 → baseline+override，拒绝优先，unknown 和生产 `users.quota.adjust` always deny。旧管理入口也必须经过同一服务，不能仅保护新 v2 路径。

## T01 管理员创建和动作票据

创建 admin 必须先通过 `POST /admin/v2/action-verifications`，以 `action=users.create_admin`、完整规范化意图和 actor password 建立 intent，返回 reserved GUID 与五分钟、单次、绑定 actor/session/action/target/authversion 的高熵不透明 ticket；客户端只在内存持有 ticket，服务端只保存 digest。普通 user 创建不需要该票据，但仍需 `users.create` 以及非默认 plan/group 能力，不能携带 admin override。intent 不创建用户、不占用户名，过期没有账户副作用。

规范化用户名、昵称、角色、分组、套餐、三态覆盖和原样密码由 server HMAC 覆盖。密码不 trim、不存明文或普通无盐 hash。缺省值/空值 canonical 排序固定，unknown field 和 duplicate JSON key 拒绝。随后 `POST /admin/v2/users` 在一个事务内消费既有 intent/ticket（仅 admin 创建），创建账户、初始化权益/权限、写审计、消费幂等键并写 outbox。intent 建立不与账户创建共事务。同 key+同请求成功重查只返回既有结果，不能再次执行或复用票据。

## T02 公共价格可见性切换

采用 Vue 预渲染 + Go 统一门禁。`switching` 和跨实例协调状态必须持久化，不能使用单机锁。切换前阻止旧策略下的新响应，排空/中止已登记响应；节点、源站、HEAD、Range、304、历史快照和 CDN 路径均验证当前策略。禁止 CDN 缓存绕过门禁，报价必须 `no-store`；保护模式匿名壳不含报价元信息并 `noindex`，登录后以现有 Bearer 取数，不触发匿名 Refresh、不修改 Refresh Cookie Path。

证明旧缓存失效后才原子提交 policy。不能在 DB 事务内等待 CDN；失败安全阻断并返回可查询/恢复状态，不能报告成功。普通内容发布的 60 秒可见性目标与安全价格切换分开。切换成功后只承诺受控服务不再向匿名新请求交付报价，已发字节和客户端内容无法收回。

## 首批独立设计：B1 管理底座

B1 是可单独 review 和实施的首批管理底座，不与公共页面或金额 Mock 绑成一个发布：共享 authz、目标可见性、动作票据、AuthVersion 失效、幂等和审计接口设计。账户列表、详情和创建实现归 B2；B1 结束条件是管理读取与账户安全动作的 DTO/错误/事务证据冻结，公共内容和价格页面仍留在后续 B4/B5。

提交后的未知状态必须有专门的操作查询才能判定结果。PM 已接受的候选为 `GET /admin/v2/operations?scope=users.delete`，使用原 `Idempotency-Key` header 和 Bearer；scope 必须来自有限危险 action 注册表（`users.create`、`users.delete`、`public_content.publish` 仅为示例），禁止任意 path/target GUID 查询。查询需校验当前发起 session 和最新 actor 管理资格；资源详情才重新校验目标可见性；Access/Refresh 轮换不改变逻辑 session。返回 `processing/succeeded/failed/pending_recovery`、finished_at 和不含目标信息的 opaque 关联号，不泄露 input hash、ticket、密码、target GUID、username、role 或 before/after。查无记录是无法确认，不等于未执行；过期、在途和未登记均禁止自动重放，503 也不能保证可恢复。普通 detail/audit/session 只表示当前状态或历史，不能冒充动作结果。跨会话恢复、保留期限和过期 key 由 B0 冻结。

能力目录三态固定映射为 `inherit`、`allow`、`deny`，未知值不渲染为允许；显示同时包含 baseline、override、effective 和 authz version。权限读取复用既定 `users.permissions.write` 或 Root-only 资格，最终注册待冻结，不新增 `users.permissions.read`。时间字段按每个 DTO 单独声明 RFC3339/Unix 毫秒文本等序列化类型，不能把数据库 Unix 毫秒强制套用到所有 API。

## 金额 Mock 与业务分组

金额 Mock 仅在 dev/test 合成入口，单位为分，范围 `0..99999999999` 分，即 CNY `0..999999999.99`，不透支；增加、扣减、覆盖、冲突、超时和重复提交均为模拟状态。已用只代表模拟消费，不能与每日调用次数、Token 用量、套餐或真实账单联动。生产构建和 `deploy.sh` 必须硬拒绝 Mock 配置，产物不含演示入口或合成数据；不能套用现有 `VITE_USE_MOCK` warning 开关。生产不允许 query/storage 开关，不使用真实 GUID、API、动作票据或审计。

业务分组是真实目录，和套餐、模型 ACL、价格倍率独立；`default` 不可停用，有用户引用时拒绝停用，不自动迁移。软删除只保留必要墓碑，用户名永久占用，不提供恢复入口。

## 公共页面和 SEO

原型的蓝色主色、浅色卡片、等宽数据、220px/64px 管理侧栏、260px 价格筛选栏、Hero 点阵渐变、表格和弹窗可作为视觉参考。原型的示例价格、40+、100%、MIT、Root 账号和 `href=#` 不是生产事实。

公共首页、关于、协议、隐私和已发布价格页预渲染真实 HTML，带 title、description、canonical、Open Graph 和 sitemap。Go 门禁统一验证匿名/登录策略及所有节点、HEAD、Range、304、历史快照和 CDN 路径。草稿、预览、管理、登录和受保护价格不进 sitemap；受保护价格匿名壳无报价元信息并 `noindex`，报价响应 `no-store`。缺少已审核法律文本是公共上线依赖，但不阻塞管理底座编码。模型用稳定无斜杠 `modelKey`；原始模型名可含 slash，不直接拆分路由。已下架详情返回 410，未知返回 404。

安全 `returnTo` 只允许站内注册路由；拒绝 absolute、protocol-relative、控制字符、反斜杠及编码绕过，解析 origin/path/query 后再次校验，非法值回退 `/chat`。

发布要求完整不可变 snapshot、pointer、audit、idempotency 原子完成，artifact 齐备后才切换；preview 必须 auth/no-store/noindex，冲突返回 409，保留 20 个可恢复版本，restore 生成新发布版。富文本净化危险 URL 与事件属性，禁止任意远端抓取。

## 错误与安全交互

真实管理动作不乐观成功。400 显示字段错误，401 走现有认证状态机，403 不注销且不泄露目标，404 统一隐藏不可见目标，409 要求刷新/重查，410 表示已下架或已失效资源。429/503 只报告限流/依赖失败或结果待确认，不保证可恢复；结果未知时不自动重放，使用专门 operation 查询确认。

权限、角色、plan、group、model ACL 或密码 reset 成功后，服务端递增 AuthVersion、撤销目标会话并清理授权缓存；Gateway 每次以最新用户 ACL 与当前请求交集判断。认证读 DB 最新状态，无法确认时 fail closed；outbox 只负责传播，不是唯一安全边界。Redis/MySQL/审计失败关闭，不返回伪成功。服务端仅存 ticket 摘要；客户端只在内存持有 opaque 原值，前端不持久化密码、token、Cookie、ticket 或敏感正文。

## 测试与证据设计

新 26 项 A01-A14、P01-P08、V01-V02、R01-R02 在本分支全部 `NOT_RUN`。A 为账户/授权/金额/安全，P 为公共页面/发布/真实性，V 为视觉/响应式，R 为兼容/发布。A08 必须证明权限更新和旧入口均受新 capability；A11 必须证明生产构建/发布硬拒绝 Mock；R02 必须纳入该硬门禁、完整快照和回滚证据。每项必须记录 FE/BE revision、契约 revision、步骤、预期/实际、请求/响应摘要、持久化/缓存事实、脱敏日志、退出码和清理结果；视觉通过不能代替真实接口通过，Mock 通过不能代替真实金额。

历史 web-009 的 M3 `PARTIAL` 和 4/4 生成预算不扩大为新需求证据。当前不调用模型；任何真实生成、生产写入或部署都需新的明确授权。性能硬指标沿 PRD：10 万用户测试集、并发 10、每页 20，列表查询 P95 ≤500ms；设备、网络、冷热缓存和样本口径另行记录，不能据缺少口径宣称通过。

## 范围和风险

本期排除真实余额账本/支付/扣费、Passkey/OAuth/2FA/PAT、物理删除/恢复、Root 账户在线创建/迁移、全量系统设置、渠道调度、自定义角色、无限制批量危险操作和 React 重写。主要风险是管理 DTO/旧入口尚未完全冻结、User 无 email、价格切换跨 CDN/历史快照的门禁复杂度，以及 legal text/内容审核责任未指定。风险由 FE 负责人报协调者，再由两协调者对齐，不由前端单方面改契约。
