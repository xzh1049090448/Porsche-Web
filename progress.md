# 当前验证进度

## 2026-09-14：Home/Pricing 原型复用与全站紧凑字级本地验收

- 按 `landing-prototype.html` 与 `pricing.html` 的已确认方向重构 Home/Pricing 展示结构，同时保留真实发布读取、Root 管理权限、价格缺失/隐藏、稳定 `modelKey`、危险 URL/富文本净化和既有路由行为。实现 revision 为 `032a8828fa617405834884510f212f6363777ba0`，浏览器报告提交为 `c760dbc3b14341212a929eebce747b4712c84317`。
- 浏览器回归期间按 RED→GREEN 修复 Pricing 标题 30px、路由进入抢焦点、Console 壳层高度漂移、公共内容输入框 40px、Chat 折叠按钮 28px 以及桌面模型编辑对话框超出视口。普通页标题保持 20px，Home Hero 为 44/34px，正文/控件/辅助信息为 11–14px；移动 Chat 输入框保留 16px 防自动缩放特例，触控目标至少 44px。
- 显式绑定 A03/A05/A06/A08/A14/PublicPricing 六份权威后端合同，在允许本机回环和浏览器的环境运行完整 `npm test`：1023/1023 PASS，0 fail、0 skip。`VITE_USE_MOCK=false npm run build`、production bundle checker、公共模块图（8 chunks、158113 JS bytes、20362 CSS bytes）与 `git diff --check` 通过；保留第三方 PURE 注释、静态/动态重复导入和大于 500kB chunk 警告。
- 可见 Chromium production preview：Home/Pricing 14/14、public/console/guest 路由动效与焦点 6/6、13 类功能页 × 3 视口 × 2 主题 78/78，共 98/98；意外 console/page error 均为 0。另在功能矩阵内完成 Element Plus 模型编辑和原生内容恢复对话框共 12 次边界/Escape 检查。原始 JSON/截图位于 `/private/tmp/porsche-web-home-pricing-browser-20260914`，仓库报告为 `docs/agents/validation/2026-09-13-home-pricing-motion-typography-browser.md`。
- 状态边界不变：`web-012` 继续 `in_progress`；P08 生产内容真实性与法务/品牌文案仍 `BLOCKED_PRODUCT`，email push 仍为 TODO。真实公开 empty/ready/published 数据、真实 Root/普通用户、后端/上游、公开 HTTPS、数据库迁移、部署和生产验收均未运行；合成 published/loading/503 不作为线上通过。

## 2026-09-12：全站视觉统一本地前端候选与 production mock 隔离修复

- 实现序列 `91d7202..d65216e` 完成 public、auth、console、chat、用户管理、公共模型/定价/内容管理与 Root 通知的统一视觉；Task12 以 `f90d1ec` 同步开发 demo 绝对路径测试，以 `3ad62df` 修复 production mock leakage。生产 router 与 API 的调用签名、时序和行为不变。
- 初次 bundle checker 仅覆盖 A09 markers，遗漏了由 API/store 静态 import 带入的通用 `mock.js`、演示凭据与 fixture；此前“dist scan通过”声明已失效。增强 checker 对 manifest 通用 mock 模块和四类代表 marker 先取得 5项 RED；生产构建现以条件 alias 替换为无副作用 sentinel，`VITE_USE_MOCK=true` development build仍加载真实 mock。
- 修复后显式提供 A03/A05/A06/A08/A14/PublicPricing 六份权威后端合同并允许测试所需 loopback，完整 `npm test` 为 993/993 PASS、0 fail、0 skip。`VITE_USE_MOCK=false npm run build`、增强 production bundle checker、公共模块图（8 chunks、154847 JS bytes、18464 CSS bytes，预算 200000）、全 dist mock/fixture scan及全分支 `git diff --check` 通过。构建保留第三方 PURE 注释、静态/动态重复导入和大于 500 kB chunk 警告。
- 可见 Chromium 严格矩阵为 21 routes × 3 viewports（375×812、768×1024、1440×900）× 2 themes = 126/126；public/guest 使用匿名 refresh 401 上下文，console/admin 使用 synthetic Root 上下文，每例断言最终 pathname/query 与 route-specific landmark。mock 隔离修复后的 production preview 在精确代码 revision `b2ad9f228b82dc031aa8e2625e8a499af7dd1ba3` 另对匿名 Login、synthetic Root Chat、Root 公共模型管理 smoke 3/3；final URL 与 route landmark 正确，console/page errors 为空。报告见 `docs/agents/validation/2026-09-12-full-site-visual-browser-matrix.md`，修复 smoke 外部证据见 `/private/tmp/porsche-web-visual-mock-leak-fix-smoke-current-20260912/browser-smoke.json`；其后的提交仅更新本证据引用。
- 状态边界不变：`web-012` 继续 `in_progress`。P08 生产内容仍 `BLOCKED_PRODUCT`，email push 仍为 TODO；`/pricing/:modelKey` 只验证 loading，不标 ready/published，public pricing empty 明确为 SKIP。未 push、merge、deploy，未做真实生产/live acceptance，写状态仅使用 synthetic/mock fixture。

## 2026-09-12：BE06 合并进入 main

- BE06 前端在最新 `origin/main` 上完成无冲突合并；配对后端也在吸收其最新远端提交后完成兼容合并。
- 合并后六份后端合同显式注入的全量测试 `926/926`、0 skip，`VITE_USE_MOCK=false` production build 通过。
- `web-013` 保持 `passing` / `local_cross_repository_pass_pending_release_acceptance`；生产 migration/deploy、公开 HTTPS、真实账号及付费或真实上游仍未执行。

## 2026-09-12：BE06 platform-chat-sse.v2 本地跨仓库验收通过

- 前端候选 `db5e25f27e879d5697fe758e5f40048105312b6d` 绑定后端 `4680c549bd28f8be57a438061cf9161914c046a0`；`interface-contract.json` 为 `v1.0.0-p0` / `agreed_for_implementation`，`platform-chat-sse.v2` 为 `closed`，SHA-256 为 `47cfbc485c4df0f5d2c12539f389f466c97bb8318adf04966757420287d10a2f`。
- 前端六份后端合同显式注入的全量 Node 测试 `926/926`、0 skip，`VITE_USE_MOCK=false` 生产构建与 `init.sh` PASS。后端 fresh `go test ./...`、build、vet、affected race PASS；隔离 loopback-only MySQL 8.4 / Redis 7.4 的八个 BE06 compare integration 在 normal 与 `race -p 1` 均为 `8/8` PASS、0 skip。
- 真实本地浏览器在 production build + synthetic backend/upstream 上完成全矩阵：standard 为实际 RAF 每帧一个字符簇，25ms 目标浏览器实测约 33ms且标点无额外停顿；reduced-motion send/recovery 共观测 29 次增长、单次最多 8 字符簇并核对 modeReason；手动上滚不被新内容抢走，Back to latest 可键盘恢复。单模型生命周期、非法 meta fail-closed、权威取消及 view-only 前缀、三模型与兄弟失败、断流 `1 POST + 3 GET`、重复抑制、畸形敏感值不渲染、IME、焦点、375/390 和 unmount 也全部 PASS；独立最终 verdict 为 PASS。
- 隔离 fixture 已精确清理 2 个容器、2 个卷、1 个网络及 loopback listener。`web-013` 仅标记 BE06 本地跨仓库范围为 `passing`；真实账号、付费或真实上游、生产 migration/deploy、公开 HTTPS 均未运行。证据见 `docs/agents/validation/2026-09-12-be06-cross-repo/manifest.json`。

## 2026-09-11：公共内容与定价分支同步主分支

- `feature/public-content-pricing` 已语义合并最新 `origin/main`，公共页面路由与 Root 定价管理保留，并兼容主分支新增的开发环境金额演示路由。
- 冻结接口契约已按合并后的 `interface-contract.json` 更新校验摘要；`VITE_USE_MOCK=false` 全量测试 681/681 通过，生产构建完成。
- P08 仍为 `BLOCKED_PRODUCT`，真实价格、声明、条款、隐私及品牌文案尚未发布；本次未部署生产环境。

## 2026-09-11：公共内容与定价前端 Task 11 本地集成证据

- 前端候选 `8001346bcfcaf16889a967f53b2042993e11fddf` 绑定后端 `7d7d1dd8d141e2847c431d9c58e07fb53238eb72`；公开内容/定价冻结契约 SHA-256 为 `89e94d93939876a62baeaba0ca0bfcc94dcdc2ee111a4aad4ce8a31db28dfe7e`，A03/A14 契约也通过显式路径注入测试进程。
- `VITE_USE_MOCK=false` 且三份契约显式设置时，全量 Node 测试 511/511、0 fail、0 skip；首次沙箱运行仅因真实 Vite Preview 测试禁止监听 `127.0.0.1` 而为 510/511，允许回环监听后同一完整命令通过。生产构建完成 2387 modules，公共模块图校验通过（8 chunks、194574 JS bytes、5421 CSS bytes），`git diff --check` 通过。
- P01/P03–P07 仅记为 `PASS_FRONTEND_LOCAL`。本轮没有可变隔离账号/数据且明确不改 fixture，375/768/1440、Root/匿名、CRUD/发布/通知等浏览器矩阵为 `BLOCKED_FIXTURE`；外部 HTTPS、CDN、生产迁移/部署/回滚与跨栈联合验收为 `PENDING_LIVE_ACCEPTANCE`。
- P08 继续 `BLOCKED_PRODUCT`：代码已对 40+/100%/MIT 等原型断言及法律元数据 fail closed，但真实价格、claims、terms、privacy、品牌文案与最终生产内容仍未获产品/法务批准。未 push、merge、deploy，也未创建、修改或清理任何账号、数据库、Redis 或线上资源。完整报告见 `docs/agents/validation/2026-09-09-public-content-pricing/frontend-report.md`；`web-012` 保持 `in_progress`。

## 2026-09-08：用户软删除成功提示修复

- 测试环境 `https://aiportcloud.com/users` 以 `root_admin` 完成列表、搜索、详情、刷新、创建与软删除验收；临时用户 `accept_260908_0942`（GUID `355650202352226304`）创建成功并已软删除，按 GUID 查询为 0 条。
- 线上验收发现软删除完成后仍显示旧的“已创建用户”页面公告。根因是 `onCreateSucceeded` 写入公告并提示成功，而 `onDeleteSucceeded` 只协调列表，未覆盖公告或发送删除成功提示。
- TDD 回归先因中英文删除成功文案及列表回调缺失而 RED；修复后定向测试 10/10、携带后端 A03/A14 冻结契约的全量测试 287/287、`VITE_USE_MOCK=false npm run build` 与 `git diff --check` 通过。构建保留既有 Rollup 动态导入和大 chunk 警告。
- 修复仅在隔离分支 `fix/user-delete-success-message`，尚未 push、合并或发布；测试环境仍运行前端 `43122191b0400db9d5e8042c8367b15711da6b6c`。


## 2026-09-09：A08 managed-user roles and permissions 本地联合切片限定通过

- A08 从 `BLOCKED_FIXTURE` 提升为 `PASS_LIMITED_SCOPE`。前端代码候选 `25b073164dc3fccecbf3b74309f12dd7589c024b`，配对后端 `f2f976005c2331c0409c1b27da79e3a43d25bcb0`，共享合同 SHA-256 为 `dd202cb5019b10a891e10f03f77629b5f54e993110f148f417e05d089df35698`。
- 修复了 Vue 代理对象导致 Root 普通用户详情不加载权限目录、提升按钮永久隐藏的问题；新增回归测试。A08 focused 41/41、前端 full 446/446、生产构建和 diff-check 通过。
- 真实 Chromium 完成提升、`users.read` 显式拒绝、降级；每步只有一次 201 verification 和一次 200 execute。真实 409 冲突执行一次详情刷新且不重放。375/390 弹窗边界、首焦点和 Esc 关闭通过，无相关 console/page error。
- 后端真实 MySQL 8.0.46 / Redis 7.4.11、ledger 0001–0012、migration 0012 down/up、事务/回滚/并发、Access/Refresh、Gateway Key policy reload、损坏策略闭锁和 HTTP 测试 11/11 通过；独立安全复审 PASS；两个精确命名容器及端口完成清理。
- 26 项现为 15 `PASS_LIMITED_SCOPE`、9 `BLOCKED_NOT_IMPLEMENTED`、1 `BLOCKED_PRODUCT`、1 `BLOCKED_ENV`，共 11 项阻塞；`web-012` 继续 `in_progress`，phase 更新为 `joint_acceptance_partial_15_limited_11_blocked`。生产 migration/deploy/acceptance、真实业务账号和外部 backend project_manager 书面确认仍未运行。证据见 `docs/agents/validation/a08-managed-user-roles-permissions-20260909/`。

## 2026-09-09：A07 managed-user credentials and entitlements 本地联合切片限定通过

- A07 从 `BLOCKED_NOT_IMPLEMENTED` 提升为 `PASS_LIMITED_SCOPE`。代码候选后端 `a600a0815b5eab5203333755a2466788fe67d61a`、前端 `41648181ab42fb46fe7d45663e746121956b50b8`；canonical evidence commits 后端 `5d5a1e9ee230bcc42fe9fde8d3f9f7badf34b658`、前端 `39b79582110347ae11b95e58217b3afe3236b4f7`；合同 SHA-256 `9e1969b238911b6eee5b6aa85ed364e795a6854f0a026daac5d15e2ab78851be`。
- 真实 MySQL 8.0.46 / Redis 7.4.11 的密码登录、旧 Access/Refresh、三会话审计、Key 保持、Bearer 套餐额度、并发及 Redis/SQL 回滚，后端全仓/build/vet，前端 395/395、生产构建、375/390 Chrome 与后端/前端/文档独立复审均通过。
- 26 项当前为 14 `PASS_LIMITED_SCOPE`、10 `BLOCKED_NOT_IMPLEMENTED`、1 `BLOCKED_PRODUCT`、1 `BLOCKED_ENV`，共 12 项阻塞；`web-012` 继续 `in_progress`，phase 为 `joint_acceptance_partial_14_limited_12_blocked`。
- Gateway Key owner plan/quota 原子重载与消费仍为 `BLOCKED_NOT_IMPLEMENTED`。生产 migration、deploy、production acceptance、真实 business accounts 均 `NOT_RUN`；未获得外部后端 project_manager 书面确认。

## 2026-09-08：A06 managed-user status 本地联合切片限定通过

- A06 从 `BLOCKED_NOT_IMPLEMENTED` 提升为 `PASS_LIMITED_SCOPE`。代码候选后端 `08617d400228c224fa2312583fde14f54f7a7686`、前端 `07c7b9e3caa5fe18bd69be74e71f577577943840`；canonical evidence commits 后端 `1677bc5384aa5968a213d6cae2efe62198b92964`、前端 `b62055245e2dc6d954a545caab2c02ee45fa3d3a`；合同 SHA-256 `c3662b25500879d67c6811fa270d4a6a39a44db812c7c493d6f02e535940b415`。
- 真实 MySQL/Redis 凭据失效链、focused race、no-fixture full、前端 364/364、真实挂载 13/13、生产构建、375/390 Chrome 布局及双端独立复审均通过。`web-012` 继续 `in_progress`，phase 为 `joint_acceptance_partial_13_limited_13_blocked`。
- 26 项当前为 13 `PASS_LIMITED_SCOPE`、11 `BLOCKED_NOT_IMPLEMENTED`、1 `BLOCKED_PRODUCT`、1 `BLOCKED_ENV`，共 13 项阻塞。仅 A06 本次更新，其他 25 行不变。
- 生产 migration、deploy、production acceptance、真实 business accounts 均 `NOT_RUN`；拒绝管理动作审计仍为后续 PRD 残留，未获得外部后端 project_manager 书面确认。

## 2026-09-08：A05 managed-user nickname edit 本地联合切片限定通过

- A05 从 `BLOCKED_NOT_IMPLEMENTED` 提升为 `PASS_LIMITED_SCOPE`。代码候选后端 `6bb54007879adeb16a532d792ab471f16ee9100a`、前端 `5a41f5679c1c35e5c2850665db54ae83e58db436`；canonical evidence commits 后端 `76e0d2f650989ffecd7519b0d042ec2696cd60a8`、前端 `34b23fc8d00771cd03b9072e00ceda40b421c6bd`；紧急合并头后端 `bf53c6a98452f624a6061e9be7317f9f596ea908`、前端 `a93893bc4a8739ba158cf45c6f32779873d9b028`。
- r5 backend service/DTO/handler/router/HTTP 与 r10 visible browser、409 ownership、拒绝路径、22 项 adversarial HTTP、privacy 和 exact cleanup 均通过。`web-012` 继续 `in_progress`，phase 为 `joint_acceptance_partial_12_limited_14_blocked`。
- 26 项当前为 12 `PASS_LIMITED_SCOPE`、12 `BLOCKED_NOT_IMPLEMENTED`、1 `BLOCKED_PRODUCT`、1 `BLOCKED_ENV`，共 14 项阻塞。仅 A05 本次更新，其他 25 行不变；本地联合验收证据已确认，未记录后端 project_manager 书面确认。
- 金额余额仍仅为 Mock；A14 与 `ACTION_SECURITY_HMAC_KEY` 轮换限制保留。生产 migration、deploy、production acceptance 和真实 business accounts 均 `NOT_RUN`。

## 2026-09-08：生产发布 Mock 门禁 hotfix 本地候选

- 生产构建使用 Vite 的 production 环境解析，要求最终 `VITE_USE_MOCK` 精确为 `false`；缺失、空值、`true`、大小写变体和 `0` 均在 Vite 启动前失败。依赖按已提交的 `package-lock.json` 通过 `npm ci` 安装。
- 全栈发布在统一锁内只追加 `.env.example` 新增且 `.env` 不存在的 key，不覆盖已有前端配置；构建后的静态树在同一文件系统原子切换，Nginx reload 失败时恢复旧目录。后端候选同时绑定不可变 image ID、source revision 与同一环境快照。
- 本 hotfix 仅在隔离工作树形成候选并执行本地测试/构建；未读取生产 `.env`，未 push、部署、迁移、替换后端容器、发布生产静态文件或 reload Nginx。`web-012` 仍为 `in_progress`，R02 仍为 `BLOCKED_ENV`，真实生产 HTTPS/浏览器验收须待两端合并部署后完成。

## 2026-09-08：A03 创建用户/管理员本地联合切片限定通过

- 联合矩阵仅将 A03 从 `BLOCKED_NOT_IMPLEMENTED` 提升为 `PASS_LIMITED_SCOPE`；代码候选为前端 `9f660a9ca26f5738dd661652596a1e450ff34335`、后端 `3a50144e53268f6ef3ae704699ef9fa851e4a5ee`。A14 及其余 25 行状态不变，当前为 11 `PASS_LIMITED_SCOPE`、0 `FAIL_LOCAL_DEV_ROUTE`、13 `BLOCKED_NOT_IMPLEMENTED`、1 `BLOCKED_PRODUCT`、1 `BLOCKED_ENV`，合计 15 项阻塞。
- Admin 默认普通用户创建、Root 普通用户/管理员及 allow/deny 覆盖、重复提交单 POST、墓碑冲突脱敏、模糊响应 operation Query 恢复、default 分组刷新/列表/详情、删除后重放 410 无 PII、groups 目录 pending/error/empty 零写均通过。前端测试 275/275；可见 Chrome 13/13。后端 MySQL 8.4.11、Redis 7.4、迁移 `0001`–`0010`，focused 673/610、race 476/427、serial full 1912 PASS/1 SKIP（leaf 1739/1）；唯一 skip 为显式 opt-in 的 100k 性能夹具。
- `ACTION_SECURITY_HMAC_KEY` v1 尚无 key ID/多 key verifier；仍有可重放的 post-0010 active snapshot 时禁止轮换，除非先交付单独批准的多 key 验证或原子全量 re-HMAC migration。
- A03 专用 fixture、标签、监听、PID、命名卷及私有临时文件已 exact cleanup 为零，无关容器、镜像和卷不变。`web-012` 继续 `in_progress`；金额余额仍只允许 Mock，真实 ledger/billing/recharge/refund/deduction、生产迁移、部署、生产验收及真实业务账号均 `NOT_RUN`。

## 2026-09-06：A12/A14 users.delete 本地联合切片验收通过

- 前端 `bace6d167b94b693abd6be4c720152dc0eb905bb` 与后端 `811213d557eea7b6b9523a584245252ba4dd7d80` 的 `users.delete` 切片获得三项独立复审 PASS，并将联合矩阵 A12/A14 更新为 `PASS_LIMITED_SCOPE`。A12 仅覆盖软删除、重复删除、用户名不可复用、默认列表遗漏及旧凭据拒绝；恢复写链不在本切片。A14 仅覆盖该动作的 ticket/idempotency/operation Query、commit unknown 与依赖失败关闭。
- 可见真实 UI 的 Root→User、Root→Admin、授权 Admin→User 三条路径，以及 eligibility、敏感 verifying/submitting/querying 清理和浏览器边界恢复矩阵均通过；生产 adapter 与 Pinia 被实际使用。真实 API-context、数据库终态与服务层证据由后端验证目录绑定。
- 联合矩阵当前仅由 8 增至 10 个 `PASS_LIMITED_SCOPE`，仍有 16 项阻塞；其余 24 行及历史时间线语义保持不变。其他 7 个管理动作继续 inactive，通用 outbox delivery/recovery worker、公共页面、金额 Mock、完整回归和发布仍不在本切片。本结论不代表完整 PRD 或 release 通过，`web-012` 继续 `in_progress`。
- 生产迁移、部署、push 与真实业务数据操作未获授权，也未执行。更新前 acceptance matrix SHA-256 为 `6925173b045e77362b8fc096d68727d602cd261545b24e8f38d60e991f93a241`，本文件更新前 SHA-256 为 `21eeb06bc3608554c3bf1ba595897a98c26e4e26b964d6cf2fdd4d66577605cb`。

## 2026-09-04：Vite API 路由补救通过本地限定验收，18项仍阻塞

- P02/R01已由`FAIL_LOCAL_DEV_ROUTE`提升为本地`PASS_LIMITED_SCOPE`：登录后的`/api-keys`初次导航和硬刷新均返回SPA文档并渲染；`/users`、`/profile`硬刷新回归通过；退出后3条私有路由均落到`/login`且无私有DOM。
- 认证撤销行为未变：UI logout 204、浏览器Cookie清空、显式refresh 401。`/api?health=1`与`/api/public/**`仍到达后端并返回非HTML 404；`/api-keys`不再被API代理截获。
- PM `SPEC_PASS`与独立QA `PASS`已归档；目标测试2/2、全量134/134、build、diff-check通过。运行候选`c788e788`，writer证据`20ea497`，Task6评审证据`37ae384`。
- 当前26项为8 `PASS_LIMITED_SCOPE`、0 `FAIL_LOCAL_DEV_ROUTE`、16 `BLOCKED_NOT_IMPLEMENTED`、1 `BLOCKED_PRODUCT`、1 `BLOCKED_ENV`，合计18项阻塞。历史26/26 `NOT_RUN`及6/2/18失败证据原样保留。
- 本轮未运行模型、chat、SSE、生产HTTPS、生产反向代理、部署或后端改动。结果不是完整PRD或生产验收通过；`web-012`保持`in_progress`，phase为`joint_acceptance_partial_8_limited_18_blocked`。一次性资源继续保留，等待精确cleanup。

## 2026-09-04：PRD-260903 真实本地联合验收最终FAIL，等待修复与清理

- PM最终签字状态为`FINAL_ACCEPTANCE_FAIL_PENDING_FIX_AND_CLEANUP`。26项当前权威结果：6 `PASS_LIMITED_SCOPE`（A01/A02/A04/A13/V01/V02）、2 `FAIL_LOCAL_DEV_ROUTE`（P02/R01）、16 `BLOCKED_NOT_IMPLEMENTED`、1 `BLOCKED_PRODUCT`（P08）、1 `BLOCKED_ENV`（R02）；合计18项阻塞。
- logout本身通过：204、浏览器上下文Cookie清空、显式refresh 401，且无私有API Key DOM。失败根因是本地Vite `/api`前缀代理同时截获浏览器文档路由`/api-keys`，硬刷新在Vue路由守卫执行前由后端返回404。该结论不证明生产HTTPS存在同样问题，也不是后端会话撤销失败。
- `SECOND-PHASE-REPORT.md`仅在早期logout/direct-route解释上supersede `CORE-PHASE-REPORT.md`；CORE、SECOND、raw JSON和截图全部原样保留。最终报告与机器矩阵见`docs/agents/validation/joint-acceptance-20260904/FINAL-ACCEPTANCE-REPORT.md`及`acceptance-matrix.json`。
- A05–A08读取/拒绝子集有局部证据，但完整写能力未实现，整项仍`BLOCKED_NOT_IMPLEMENTED`。此前“26/26 NOT_RUN”保留为执行前历史时间线，不能覆盖当前结果。
- `web-012`继续为唯一`in_progress`，联合验收为FAIL，不标passing。业务代码、生产、部署均未变；一次性fixture和前后端进程保持运行，等待精确cleanup。

## 2026-09-04：B1-D FE 只读用户候选通过独立质量与 Chrome 复验

- B1-D r1 `/users`、`/users/:guid`、认证投影和 F1/F2 修复均已闭合为实现候选；PM `b1d_cross_team_spec` 已给候选 CODE SPEC PASS。无写按钮、Mock、金额或分组操作。
- writer 的合成 API Chrome smoke 通过，包含 F1 重试撤权、F2 详情 401/403/404/503、投影恢复、Root 权限、分页回退、硬刷新与移动布局；`pageErrors` 为空。独立 Chrome 最终复验也通过：5177 上验证分页 delta=2/UI1、详情重试、F1 rows=0、权限恢复24行以及5个预期合成 console errors，独立质量为本地 FE 候选 `VERDICT PASS`；offline audit 新鲜性仍 `NOT_VERIFIED`。证据见 `docs/agents/validation/b1d-20260904/`。
- 本轮 fresh `npm test` 132/132、`npm run build`、JSON parse 和 `git diff --check` 通过。真实 BE/DB/Redis/100k/联合验证仍 `SKIPPED`，PM 真实联合验收 `NOT_RUN`。`web-009` 保持 blocked（M3 PARTIAL 4/4），`web-012` 是唯一 in_progress，整体 PRD 仍未完成。

## 2026-09-03：前端基线 guard 命名窄修复

- 历史 M3 guard 因 `*.test.cjs` 被 `node --test` 默认发现，且该命令行脚本需要 `argv[2]`，导致基线出现非业务失败。仅改名为 `docs/agents/validation/m3-sse-attempt4-guard.cjs`，原文件字节 SHA-256 `c076cd78baddbfaab9b01ef8c8ccdcc259bd606e8dcfc1b5357810487443259b`、Git blob SHA `0f88f4434de378055deb2404472557e76f8ff03e` 保持一致；三场景 guard 均通过。
- 修复后 `npm test` `113/113`、`npm run build`（约6.2秒）及 `git diff --check` 均通过；构建仅保留既有 Rollup 注释警告。详见 `docs/agents/validation/2026-09-03-frontend-baseline.md`。
- 本次仅基线闭环，B1-D 管理只读页面仍等待正式 r1 合同；不改变 web-009 M3 的 blocked/PARTIAL 事实，也不将 web-012 验收标为通过。
- 按授权执行离线 `init.sh`，安装阶段因工作树缺少 lock/node_modules 且缓存缺少 `@element-plus/icons-vue` registry 响应而以 `ENOTCACHED` 退出码1，未进入 build/启动；`package.json` SHA-256 未变且未生成 lock。详见同目录前端基线报告。
- 随后临时 npm cache 联网安装在沙箱内因 registry `ENOTFOUND` 阻塞；提升权限重试后工作树仍无 `node_modules`/`package-lock.json`，init 不能记为成功，未伪称锁文件一致。
- 后续复用根 checkout 同 SHA 的 `package.json` 对应本地依赖完成离线 `init.sh`；当前 lock 为生成产物（SHA-256 `3bd2416355eec0ded6f0346d96f5f8ee5b1ae29fb46b4f541c1429f31eb266b6`），根 lock 为 `4c2415cf83eed94c6222f9dd013860ac28ec095e849b2b2b92ce1f879ee3100c`，原工作树无 lock，故不称锁一致。`npm test` `113/113`、build 及 diff-check 通过；npm 提示4个包的 install scripts 尚未批准。进程清单受权限限制，未设置启动变量，未启动 dev server。
- 已将上述升级版依赖保存至 `/private/tmp/porsche-admin-generated-lock-working-20260904.json` 与 `/private/tmp/porsche-admin-generated-node_modules-20260904`，再复制根 checkout 的 lock/node_modules 精确重建；当前/root lock SHA 均为 `4c2415cf...3100`，164 个 packages 条目逐项匹配。离线 `init.sh`、`npm test` `113/113`、build、diff-check 均通过；4 个 install scripts 仍为 npm 未批准提示。

## 2026-09-03：B1-C 双只读接口限定通过，隔离fixture已清理

- 后端 `PASS_LIMITED_SCOPE`：PM最终SPEC PASS与独立真实质量VERDICT PASS，四级安全问题均0、8生产hash二次匹配。独立focused96叶子PASS（service72/handler24）、race96叶子PASS、真实HTTP边界overlay1PASS，均0fail/0skip；writer full627/focused83/race107PASS及build/vet/diffPASS。
- 用户授权的本批测试生命周期已完成，任务MySQL/Redis exact ID/name/label/image复核后stop/AutoRemove，复查均不存在；本批fixture.env、随机凭据与私密目录已删除。报告、迁移ledger、日志及cleanup证据在BE `docs/superpowers/reports/validation/2026-09-03-b1c-admin-authz-read/real-fixture/`。
- 仅两项GET展示接口获得本地限定通过，合同entry仍AGREED_FOR_IMPLEMENTATION、implementation_status=PASS_LIMITED_SCOPE；overall DRAFT、其他25entry与根合同不变。不开放FE页面或旧权限写入，`web-012`不变，26项联合验收保持NOT_RUN，不涉及生产发布。
- 下方B1-C无fixture、待授权和待复核段落均已标记历史，不能作为当前阶段状态。


## 历史阶段 2026-09-03：B1-C 已完成真实fixture writer验证，待最终复核

- 用户对本批fixture生命周期已授权。后端实际完成MySQL8.0.46/Redis7.4.11、现有0001–0003迁移及隔离验证：focused83、race107、fresh full627 test PASS，0fail/0skip，15 package PASS/4 no-test；build/vet/diff PASS，8生产hash不变。
- 初次full只因归档.go被扫描和runner迁移APP_ENV外泄失败，证据更名.go.txt保留bytes并限定migration环境后fresh复跑；生产/断言/迁移未变，初次失败历史保留。
- PM DOCS ALIGNED无代码gap；独立真实fixture与PM最终结果复核待完成，任务fixture保留，go-015仍in_progress。下方静态/无fixture NOT_RUN与awaiting授权记录是历史；当前DB测试已执行，但不代表全PRD联合验收。
- FE仍仅两项只读合同AGREED，overallDRAFT、其他25entry与根合同不变，web-012不变，26项联合验收NOT_RUN；无业务页面或旧权限写入开放。


## 历史阶段 2026-09-03：B1-C r1 两个权限展示只读合同与本地候选

- 仅 `GET /admin/v2/authz/catalog` 与 `GET /admin/v2/users/{guid}/permissions` 达到 `AGREED_FOR_IMPLEMENTATION`；草案版本 `v0.2-draft-r3-b1c-r1`，overall 仍 `DRAFT`，其他25项接口及根 `interface-contract.json` 不变。
- 后端候选已实现 fresh actor/target/session SHARE 事务、Redis barrier、严格策略读取和 disabled Admin 展示投影。目录仅 active Admin/Root；详情仅 Root 查询非删除 Admin。认证失效401、角色不足403、隐藏目标404、不可用/腐败503，匹配路由参数不规范400；错误body只含 `detail`，请求ID在 `X-Request-ID` header，保留旧middleware401文案。
- 本轮无 fixture HTTP 验证为1 pass/5 skip/0 fail；纯投影与认证分类测试通过，真实 MySQL/Redis锁/提交/会话/策略测试尚未运行，等待本批隔离fixture生命周期授权。PM conditional SPEC CODE ALIGNED（条件为文档一致及真实fixture）；独立最终静态/无fixture复核已完成，VERDICT PARTIAL：四级安全问题均0、8生产hash匹配、纯JSON叶子18 PASS/34 fixture SKIP/0 FAIL，focused race、HTTP overlay probe及gofmt/diff/build/vet PASS；真实DB严格NOT_RUN，不能写成全批或联合验收通过。最终后端无fixture全量356 test pass/229 skip/0 fail、15 package pass/4 no-test，build/vet/race通过。
- FE只同步协调文档，不开放页面或旧权限写操作；`web-012` 保持 `not_started/awaiting_backend_integration`，26项联合验收均 `NOT_RUN`。


## 2026-09-03：PRD-260903 B1-B3 Gateway Key owner ACL 协调中

- B1-B3 为 `PASS_LIMITED_SCOPE`：PM final SPEC PASS 与独立 VERDICT PASS，fresh JSON 544 pass/0 fail/0 skip；Gateway Key 后续每请求同时满足 Key ACL 与最新 owner 用户 ACL，固定 unavailable 503 生效。用户 `allowed_models: []` 仍是 **unrestricted**。
- FE 无业务变更。`web-012` 保持 `not_started/awaiting_backend_integration`，26项联合验收保持 `NOT_RUN`，不影响 B1-B2 的 `PASS_LIMITED_SCOPE`。

## 2026-09-03：PRD-260903 B1-B2 后端限定通过同步

- B1-B2 为 `PASS_LIMITED_SCOPE`：PM SPEC PASS，独立 `permission_snapshot_verify` VERDICT PASS（无Critical/High/Medium/Low）；fresh fixture JSON 512 pass、0 fail、0 skip，15 package pass、4 no-test。严格旧 PUT/update 安全收紧不构成 FE 功能交付。
- 用户 `allowed_models: []` ACL 明确为 **unrestricted**，不等同 Gateway Key ACL；daily limit 0 既有计算不变。旧角色授权、ticket/idempotency/outbox、Key ACL repair、FE 接线和26项联合验收仍未完成；`web-012` 与26项状态保持原状/NOT_RUN。

## 2026-09-03：首次跨团队对齐材料补齐

- ALIGN-20260903-02：正式请求及后端A1–A8回复已归档；原10端点+11个既有依赖的r2 JSON与完整纪要获后端及前端明确确认。未修改业务代码、运行初始化/业务测试、部署或发模型请求。
- 前端开发者已接受FE-PREP-20260903-02并返回技术方案/自测矩阵；来源证明及导出GET重放表述经纠正后确认。完整交付见docs/agents/2026-09-03-first-cross-team-alignment.md及2026-09-03-frontend-preparation.md。
- 原四步：正式对接、备忘录/契约和内部准备交付已补齐；双向核对仍保留具体日期/资源/P1语义等待定，不声称所有问题关闭。M3 PARTIAL、预算4/4、object根因未闭环、98项集成SKIP及剩余矩阵待执行，web-009仍唯一in_progress。
- 运行版本引用先前ad3f5b4/158a00e证据，不是本轮实时检查。预存package-lock.json保持未跟踪，根checkout和后端仓库无本轮改动。


## 2026-09-03 15:48：ad3f5b4发布及正常SSE复测通过

本节为最新状态，后续旧记录的“未发布/剩余1次/有效流FAIL”仅适用于当时。

- ad3f5b4已授权发布；第4次正常SSE子项PASS：200、meta→4 delta→[DONE]→done，1 POST/0 refresh，唯一请求哈希与运行日志匹配、全部保存阶段成功、tokens0→1。清理200/logout204，预算4/4耗尽。object拒绝本次未复现，根因未闭环；流内错误/取消等未测，整体M3 PARTIAL。go-004保持blocked、web-009保持in_progress，诊断功能passing不代表整体签收。
- 新容器1665e111、镜像2bc6b866，源站/公网200；旧13ada4aa及另两个更早容器停止保留，前端158a00e不变，私密快照删除。
- 后端PM已书面确认发布及正常终态限定PASS；独立质量亦确认成功流限定PASS、整体M3 PARTIAL；详见2026-09-03-m3-object-release-and-retest.md。没有产生object_detail；提取器unknown/unknown是缺字段默认值，不是拒绝。


## 2026-09-03：object有限分类候选ad3f5b4已准备

- 本地实现固定decoded_kind/field_shape/key_match；保持原SSE接受/拒绝，原值不进入日志。相关包及race各175pass；默认全量304pass/0fail/98个DB或Redis fixture缺失SKIP，不能算完整DB验收。50组公开响应与17正常摘要对照一致，独立规格/质量限定PASS。
- linux/amd64候选ad3f5b4、镜像2bc6b866、归档SHA8154e46b已核验；尚未上传或部署。发布脚本7项mock/绑定检查、第四次脚本3项预检通过。详细发布单2026-09-03-m3-object-release.md与m3-object-diagnostic-candidate.json已准备。
- 线上07:34:15Z只读确认仍6e70784/13ada4aa/cb42，健康200、两个更早回滚对象保留。本轮0真实生成；预算总4、已用3、剩1次gpt-5.4-nano/max_tokens32。
- 待准确新候选部署授权后再核验运行来源并复测。go-010仅本地诊断passing，go-004 blocked、web-009 in_progress；M3-11仍FAIL。


## 2026-09-03 15:22：追加1次诊断调用预算

- 用户明确“增加调用预算”；未指定数量，按最小增量增加1次，总上限3→4，已用3、剩余1。模型仍为gpt-5.4-nano，每次max_tokens=32；原三次记录完整保留。
- 新额度用于补充可区分object原因的诊断复测，先准备并验证具体采证方案，不盲目重跑旧请求、不自动重放。历史attempt3脚本仍是一次性记录，不为增加预算而直接修改重跑。
- 本次仅更新预算和交接记录，未执行第4次生成、未部署新候选。增加调用额度不代表已授权任何尚未确定的新候选部署。M3-11仍FAIL。
- 当前预算以validation/m3-sse-budget.json及本节为准；此前“预算0/3次耗尽”是当时事实。


## 2026-09-03：object契约离线调查完成

- 当前6e70784解析器25项合成object假设均符合断言；调用实际投影/SSE路径，无业务代码变更或真实生成。缺失/null/空/其他字符串仍不可由既有invalid_value/object日志区分；重复键、大小写与转义键行为已验证。
- 官方通用chat.completion响应说明不足以放宽流chunk校验。后端PM书面确认维持原合同，优先取得既有脱敏样例；缺证据时再设计有限分类诊断，当前未实施或准备新发布候选。
- 预算3/3耗尽、M3-11 FAIL保持。详见2026-09-03-m3-object-investigation.md；含协议澄清草稿（未向供应商发送）、25项离线证据及下一步准入。


## 2026-09-03 14:19：6e70784已发布，第三次SSE定位object校验失败

本节为当前状态；下方“未发布/字段未知/剩余预算”等均为历史快照。

- 用户明确“授权”后已上传并部署6e70784；镜像cb42daed、容器13ada4aa，源站/公网health均200，前端158a00e资源哈希未变。旧9425ea及更早d2de587容器均停止保留，私密运行配置快照已删除；未执行生产回滚。
- 第3次真实请求1 POST/0 refresh，HTTP503/0帧。浏览器请求哈希与运行版本日志精确匹配；上游200，sse_stream失败malformed_chunk，固定详情invalid_value/object。仅能确认解码后object不等于chat.completion.chunk，实际值、缺失/null/空值及后续字段有效性仍未知。
- 应用daily_calls_used 2→3、remaining 98→97、tokens仍0，不代表上游零计费；本次测试会话删除200、注销204。
- 预算3/3已耗尽，每次gpt-5.4-nano/max_tokens32；不得重置台账或继续生成。下一步由后端PM核对object契约与既有脱敏样例，先离线验证假设再决定兼容方案；任何新增真实生成需新的明确预算授权。
- 后端project_manager书面确认发布子项通过、M3-11 FAIL；独立质量PARTIAL。两者仅复核证据、未独立执行线上操作。go-009诊断范围passing、go-004 blocked、web-009 in_progress，整体M3不签收。


## 2026-09-03：chunk细分候选6e70784已完成本地验证，待新候选发布授权

- 固定malformed_chunk_detail.reason/field已实现，原公开503、大类和SSE接受/拒绝行为保持；没有记录原始帧或字段值。完整345/race113个测试pass，0fail/skip，vet/build及独立规格/质量PASS；独立22组新旧输出一致。
- linux/amd64镜像cb42daed已本机构建，归档SHA195a6f38，来源/二进制/CA验证通过；尚未上传/部署。具体清单m3-chunk-diagnostic-candidate.json与后端发布单2026-09-03-m3-chunk-release.md已准备，后端PM材料复核通过。
- 线上仍04ed728（容器9425ea/镜像a69），M3-11仍FAIL，具体首帧校验字段尚未知；最后1次gpt-5.4-nano×max_tokens32预算未使用。新候选需单独完成发布授权及运行核验后才能安排最后一次复测。
- 本轮测试fixture和凭据已清理；不能复用其旧TEST_*地址。go-009仅本地passing，go-004保持blocked，前端web-009保持in_progress。


## 2026-09-03：后端诊断已发布，SSE第二次仍失败并定位解析阶段

- 用户明确确认上传及后端替换后完成发布：源码04ed728，镜像sha256:a69cfdab1cc8e18056286ae3991669d37515994041664b3fed5b6290ac602316；新容器9425ea244ad71944ef78474cc405208fbbbe7eb22fdffd2b81e269d328d85b0c于05:50:09Z启动，源站/公网health严格200。旧d2de587容器以ai-gateway-go-acceptance-rollback-1788414605780771454保留，未执行生产回滚；前端158a00e哈希保持。
- 首次预检因OomKillDisable的null/false表示差异安全停止，未停旧服务。公开基础镜像两版本API探针证实创建规范化，限定兼容该默认值后重新预检；true仍拒绝。三锁、私有运行配置JSON快照、候选create后逐字段比对均执行，成功后私有快照删除。脚本已归档，仅适用本次精确对象，不是可直接复用的常规发布入口。
- 真实SSE第2次于05:51:52Z发送：gpt-5.4-nano/max_tokens32，1POST/0refresh，HTTP503、gateway_upstream_unavailable、0帧。请求ID哈希与候选日志匹配，源码revision也匹配；上游返回200，sse_stream failed/malformed_chunk，首帧未发出，auth/catalog/前置quota及消息写入均success，assistant/usage/final_write未运行。尚不确定具体哪个字段或数据类型不兼容，不能宣称修复或归责供应商。
- 应用日调用1→2、剩余99→98、token计数0；这不是供应商零费用证明。测试会话删除200、注销204。预算累计2/3，剩1次×32，不重置、不盲目重放。
- M3-11仍FAIL、go-004仍blocked、web-009仍in_progress。后续先核对解析器拒绝条件与脱敏结构证据，再决定是否使用最后一次预算；不放宽白名单投影、不透传上游正文、不把health通过当M3签收。


## 2026-09-03：镜像已完成，私有上传与后端发布待授权

- 代码04ed728的linux/amd64诊断镜像已在本机离线组装、导出和重新加载；精确ID sha256:a69cfdab1cc8e18056286ae3991669d37515994041664b3fed5b6290ac602316，归档SHA256 af8a122d1fa5018a981d4757aff03b0b204ef8048c38f2632eb47e343ad0c580。
- 来源标签、两个二进制哈希、架构、入口、CA均核验；无凭据/无网络启动按预期缺JIEKOU_API_KEY拒绝，不能当作真实服务健康。
- 原私有源码/二进制构建包上传被自动审批拒绝，未执行。远端仅构建公开基础层并下载，本机加入私有二进制；私有镜像尚未上传，生产后端未替换。
- 具体上传、三锁、运行态配置快照、切换及失败回滚准备见后端docs/superpowers/plans/2026-09-03-m3-backend-release.md；待用户明确授权，计划尚未在生产执行或演练。此前镜像构建超时为已解除的历史阻塞。
- 后端PM书面确认发布准备要求，不代表用户上线授权或线上M3签收。M3-11仍FAIL，剩余2次gpt-5.4-nano×max_tokens32预算保留。


## 2026-09-03：后端诊断候选已完成本地验证，镜像构建受阻

- 后端代码04ed728：隔离全量293/race46个pass事件，0fail/skip，vet/build及独立规格/质量PASS；二进制嵌入来源已核对。
- Docker Hub基础镜像拉取超时，amd64镜像尚未生成，未部署。候选清单docs/agents/validation/m3-backend-diagnostic-candidate.json。
- M3-11仍FAIL，线上预算余2次×32；后续完成镜像、后端发布授权及带日志复测，不能把本地诊断PASS当作线上恢复。

## 2026-09-03：当前状态——有效SSE首试503阻塞

- 线上158a00e已发布且菜单回归通过，自然到期限定子项已双方复核；下方旧状态仅为历史。
- 用户继续授权既定gpt-5.4-nano最多3次×max_tokens32。首试503 gateway_upstream_unavailable、0帧；预算1/3已用，余2/3，不盲目重试。
- 模型目录/详情200；应用日调用0→1、剩余99、token计数0，不据此判断上游费用。失败请求会话删除200，logout204。
- 后端project_manager与独立质量书面复核限定FAIL，不签完整M3。访问日志仅503/1.853502894s，未保存request_id，无内部阶段原因。下一步后端准备脱敏诊断与运行来源证明；本轮不改后端代码/配置、不部署。
- web-009保持in_progress。详见docs/agents/p0-m3-readiness.md及validation/m3-sse-*.json。

## 2026-09-03：M3最新子项进展（等待最终到期证据与质量复核）

- 已发布前端3eeca2b并复用两个专用账号；M2完成，web-009仍in_progress。下方M2/准入阶段“未部署/未运行”等均是当时快照，不能覆盖本节最新状态。
- 新增empty_username_and_password、username_length_1、password_length_1三个非法注册样本均400；错误admin前缀404不算403。另以真实/admin/users403转发profile作故障注入，前端保持身份、refresh0次、重试恢复PASS。
- 丢Broadcast通知且延迟真实profile响应的跨身份子项PASS；首次多标签整轮随后FAIL（fresh-context登录按钮disabled等待超时，初始响应未记录、根因未定），不标整轮PASS。补跑的refresh/logout跨标签锁顺序、关闭refresh标签后pending/reload零自动认证两项分别PASS。
- 后端project_manager已根据第一轮证据书面接受02注册/03/06/07/08正常注销/10会话隔离已测子项与0bab2b7合同一致；未独立运行、未签整体M3。新增证据仍待前端质量复核。后端另已书面接受新增3个注册400样本、真实admin403/转发profile、跨标签串行/关闭以及无效Bearer的SSE 1POST/0refresh限定子项；仅为证据复核，未独立运行或签整体M3。
- 真实Access到期并发测试仍运行；SSE无效Bearer测试已通过真实中间件401断言、1POST/0refresh，用量calls/tokens0→0，仅是拒绝零重放子项，不是有效SSE终态；成功付费SSE未获本记录授权。目录40项及剩余额度100只代表当时查询状态。持久脱敏JSON及边界见docs/agents/p0-m3-readiness.md。

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

## 2026-09-02：P0 M2 实施开始

- 用户已确认 https://aiportcloud.com 运行90abbdc，并批准M1后实施前端P0，不含部署。
- 在feature/auth-p0-harden隔离工作树复用session-auth-frontend@6f8fbca，主工作树和既有未提交内容保持不动。
- init.sh离线安装因缓存缺失失败；随后按已有package-lock执行npm ci --ignore-scripts --no-audit --no-fund（独立临时缓存）成功。锁文件与原工作树字节一致，未改package.json。基线npm test 54/54、npm run build通过；保留既有大chunk和动态导入警告。
- 契约与用户/双方协调者/M1评审确认已落盘interface-contract.json；web-009为唯一in_progress。
- 本轮本地浏览器将拦截所有API使用fixture，不以Mock结果替代真实Cookie或联合验收。

## 2026-09-03：P0 M2 本地验证

- src实施与本地回归已完成：82/82单测、build通过。浏览器完整fixture和Mock零API登录通过，资料昵称保存、注销失败重挂载循环及窄屏问题已修复。
- 可复跑脚本和实际输出见docs/agents/p0-m2-verification.md。规格/质量审查结论待补；web-009保持in_progress，不将本地验证当作M3联合验收。
- 依赖声明和构建配置无diff；已有锁文件按字节保持不变。所有线上业务写操作未执行。

## 2026-09-03：按用户要求同步最新分支

- 已fetch前端origin/main@7fbf616、后端origin/main@0bab2b7。前端本轮修改先保存为checkpoint 3a10d6e，再合入最新main；主工作树未提交文件保持原状。
- 后端最新代码在独立只读工作树Porsche/.worktrees/frontend-alignment-latest；不将新代码SHA当作已部署证据，旧90abbdc部署确认保留为历史。
- 功能清单冲突已保留上游Issue #3/#5完成记录以及本轮P0，web-009保持唯一in_progress。重点整合历史详情pending与身份epoch隔离。合并前82/82及审查结论不自动继承，需重新验证。

- 后端project_manager已书面复核0bab2b7：公开认证/DTO/Cookie/SSE不变；刷新窗口外重放改为提交撤销+审计后401 auth_request_failed且无Set-Cookie，前端应终止恢复。新代码基线已记录contract；未声称新SHA已部署，后端本轮仅只读核对。

- 2026-09-03 post-merge: 111/111 tests and build (5.54s) PASS; 8 browser flow checks and zero-network Mock login PASS. Upstream 13 history cases retained, 2 identity race cases added. Final independent review and M3 remain pending.

## 2026-09-03：M2本地收尾

- 合并最新main后的规格与独立质量复核均PASS；修复初始化期间无身份登录明确失败后的状态边界，独立探针确认后续ensureSession零refresh且已有身份不受影响。
- 最终npm test113/113、build5.64s及完整本地browser flow8项PASS。Mock零API登录在合并后验证通过；具体命令见docs/agents/p0-m2-verification.md。
- M2本地实现完成；web-009仍待M3真实同源HTTPS/多标签/权限及后端联合验收，保持in_progress，不标整体passing。未推送、部署或操作线上账号。原主目录修改保留；本轮工作保留在feature/auth-p0-harden。

## 2026-09-03：M3准入准备（发布前历史快照）

- 用户确认aiportcloud.com为验收环境；公开首页和health均200。公开入口index-Be22Ci25.js与候选index-D6qDWanU.js不一致，公开入口未含本轮认证协调标记；尚不能在当前站点签收本轮代码。
- 已准备仅dist的候选包/tmp/porsche-web-3eeca2b-m3.tar.gz、校验值与12项M3执行清单，见docs/agents/p0-m3-readiness.md。
- 本轮未登录/注册/部署或修改线上数据；等待候选发布授权、实际后端版本及专用账号安排。M3全部NOT_RUN。

## 2026-09-03：M3发布及真实认证部分验收

- 用户明确授权前端发布及两个专用测试账号。3eeca2b候选已发布，源站和公开/Chrome入口均匹配；静态备份已保留，后端未改动。
- 真实注册、登录/恢复、安全Cookie、会话隔离、撤销、改密、正常注销通过所列子项；客户端阻断注销后的reload抑制通过。详见docs/agents/p0-m3-readiness.md。
- 第一轮结束时尚缺真实到期并发、多标签故障、部分ACL/SSE与后端联合签收；新增子项进展见文首，web-009仍in_progress。后端checkout为0bab2b7，镜像无revision标签，不能宣称运行二进制已证明该SHA。

## 2026-09-03：M3真实到期完成及导出菜单本地修复

- 线上3eeca2b自然到期v2：真实过期POST401零刷新重放；三个并发安全GET各401→200，仅一次refresh，迟到401复用新token。双方角色基于证据确认所测范围，整体M3仍未签收。
- 额外Cookie竞态、双刷新串行、历史/导出归属拒绝及键盘下载跨身份保护通过对应子项；失败/未测边界保留于p0-m3-readiness.md。
- 发现并本地修复菜单图标屏外布局：158a00e，1280/1600普通click红→绿，独立质量PASS、113/113和build6.53秒PASS。仅本地，已准备新发布包，线上未替换。
- A/B剩余fixture清零，撤销遗留会话并确认注销后refresh401。有效SSE预算与新修复候选发布待确认；运行二进制无Git revision，精确源码来源仍未证明。

## 2026-09-03：158a00e已由用户发布并完成菜单线上回归

- 已核实公开入口和JS哈希匹配158a00e，确认服务器新备份目录。
- 真实Chrome1280/1600普通鼠标菜单及下载跨身份保护PASS；第一次Escape关闭夹具失败与补跑边界已保留。无有效模型生成。详见p0-m3-readiness.md最新节。
- web-009仍in_progress，完整M3、有效SSE及后端运行源码证明仍未完成。

## web-012：PRD-260903 管理员用户管理与公共页面体系设计协调（2026-09-03）

- 新 FE 工作树 `feature/admin-public-260903` 基线 `25a66a4ad546a481941dfc6e0cc9bc75da2e631b`，BE 同名工作树基线 `aec1619ee710c80cd71dbe529660e2d12b3fda7b`；输入 PRD v0.2 SHA256 `58ab6fa63c9e5bcc9704ecc2167c1dfe75b77ff9ca0c8117f834fe88333eb31a`。
- 已只读完整核对主 PRD、设计 PRD 与 landing/pricing/users 原型，并形成 `docs/agents/2026-09-03-prd-260903-kickoff.md`、`docs/superpowers/specs/2026-09-03-admin-public-design.md`、独立 `docs/agents/contracts/prd-260903-interface-draft.json` 和角色确认 `docs/agents/validation/prd-260903-confirmations.json`。
- 设计推荐 B0→B6：契约/设计、授权审计失效底座、账户闭环、管理 UI 联调、公共数据发布快照、公共 SEO/可见性、联合回归。真实管理 API 与金额 Mock 独立入口隔离；金额固定 CNY 合成演示，不触发真实余额/账单/调用。
- 后端 PM 已书面接受设计方向（非最终契约/实现批准）：共享账户动作服务+独立 authz、拒绝优先和 unknown/生产 quota.adjust always deny；T01 action-verification intent 与 POST users 消费既有 intent/ticket、T02 Vue 预渲染+Go 门禁及跨实例安全切换方向已纳入设计，精确 revision/字段仍待 B0 冻结。
- 用户已确认 D03（`/` 官网与 `/chat` 迁移）、D06（默认公开价格与受控统一开关）、能力/票据安全措辞及排除范围；D01/D02/D04/D05 已确认。User 无 email 仍为基线差异，法务正文负责人待指定，不阻塞管理底座设计；本确认不等于技术 DTO 冻结或实现验收。
- 新 26 项 A01-A14/P01-P08/V01-V02/R01-R02 全部 `NOT_RUN`；旧 web-009 保持 `in_progress`、M3 `PARTIAL`、历史生成预算 4/4，不作为本分支新测试证据。无硬日期，按准入依赖推进；本轮不改业务代码、不安装/测试/build、不迁移部署、不调用模型、不 commit/push。
- r3 用户确认已落盘；web-012 进入 `contract_planning`，仅准备后续经批准的实施，当前不开放新管理 UI/入口。
- B1-A 内部协调任务已由后端 PM 提出并获前端协调者接受：BE-only 纯 authz evaluator，24cap/immutable snapshot/四入口/默认 deny 等细节以 BE 计划为准；不改公共接口 DRAFT、不交 projection、不开放 FE 管理入口，当前无 passing，等待 BE 测试结果。
- B1-A 已完成限定 PASS：focused 8 tests/rerun、full 312（98 DB/Redis fixture SKIP、0 fail）、package 15 pass/4 no-tests SKIP、build/vet 0、独立并发 probe 与质量验证 PASS；来源为 BE plan/spec/report。仅限纯库策略，未接 DTO/HTTP/DB/旧路由/安全失效；完整 B1 未完成，web-012 等待后端整合，FE 入口保持关闭。
- B1-B1 已完成限定 PASS：PM SPEC PASS；permission_snapshot_verify fresh build/vet/diff/json 0，real fixture full 456 pass/0 skip/0 fail，15 package pass/4 no-tests，反向锁 probe PASS 1.362s，SECURITY_REPORT Critical/High/Medium/Low 均 none、VERDICT PASS。仅限内部快照库，未接 HTTP/DTO/FE，`permissions_version` 未冻结，完整 B1 未完成；web-012 保持 `not_started/awaiting_backend_integration`，26 项 PRD 验收仍 `NOT_RUN`。

## 2026-09-10：A09–A12 本地限定验收

- 前后端均先合入最新 `origin/main`。后端保留主分支 `0011`，将未发布的 A07/A08 迁移顺延为 `0012/0013`；当前前端代码候选 `8612242`，后端边界候选 `258abb4`。
- A09/A10 新增仅 Vite 开发环境注册的 `/demo/admin/balance`，使用合成用户和纯内存 CNY 整数分夹具；成功、失败、超时、冲突、重复提交、刷新重置和 Mock 标记均有自动化证据。
- A11 生产构建扫描确认 demo 路由、marker 和合成用户名未进入 `dist`；真实用户列表/详情继续显示金额未接入，后端三条代表性金额写路径保持 404。
- A12 沿用既有 `users.delete` 限定切片并在当前候选复验。前端 focused 65/65、后端 authz/dto/handler/router/service 定向测试通过。
- 前端 focused 8/8、全量 455/455、生产构建通过；可见 Chromium 七项业务检查及 390px 布局通过。Mock 登录后台 `/api/v1/auth/self` 因未启动本地后端出现两条 500 控制台噪声，金额演示本身没有真实 API/DB 调用。
- 后端全量测试、构建与路由边界通过。合并后的真实 MySQL `0011–0013` 迁移链及 A08 `0013` down 兼容通过；新的完整 A08 service fixture 复跑因 disposable MySQL host mapping 瞬断未闭环，继续单独引用原 A08 真实服务证据。三轮本次 fixture 均 exact cleanup、label 残留为零。
- 当前矩阵为 18 项 `PASS_LIMITED_SCOPE`、8 项阻塞；`web-012` 保持 `in_progress`。外部后端 `project_manager` 对本轮当前候选的书面确认尚未获得，生产迁移、部署、生产验收与真实业务账号均未运行。
