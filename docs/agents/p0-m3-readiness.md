# P0 M3 真实联调准入与执行清单

2026-09-03，用户确认验收域名为 https://aiportcloud.com。用户随后明确授权发布候选并创建两个专用测试账号；以下最新执行记录取代原准入检查状态。

## 当前结论

前端158a00e和后端ad3f5b4已发布。第四次真实SSE正常终态限定PASS，M3-11整体PARTIAL（error/取消等仍未测）。预算总4、已用4、剩0。先前object失败未复现，不能认定根因已修复；整体M3未联合签收，web-009保持in_progress。当前证据见[本次发布复测报告](2026-09-03-m3-object-release-and-retest.md)。下方旧部署、预算和失败状态均为历史快照。

后端 project_manager 已基于第一轮脱敏证据书面接受 M3-02 注册已测子项、M3-03、M3-06、M3-07、M3-08 正常注销、M3-10 会话隔离子项与 0bab2b7 合同一致。该结论是证据复核，后端未独立运行，也未签整体 M3；本次新增边界、多标签及403/SSE401证据仍待前端质量复核。后端另已书面接受新增3个注册400样本、真实admin403/转发profile、跨标签串行/关闭以及无效Bearer的SSE 1POST/0refresh限定子项；仅为证据复核，未独立运行或签整体M3。

### 发布前准入历史快照（不是当前部署/账号状态）

| 项目 | 实际证据 | 状态 |
| --- | --- | --- |
| HTTPS 首页 | curl 首页 HTTP 200 | 可达，不证明版本 |
| 健康检查 | curl /health HTTP 200 | 可达，不证明后端 SHA |
| 公开入口包 | /assets/index-Be22Ci25.js，SHA256 922bc138f4184dd85acd6fe91bfbc13d8c7c057ddfde77c0c2f9672feb6b60eb | 未匹配候选 |
| 候选入口包 | /assets/index-D6qDWanU.js，SHA256 e74446da35c687f6422f20c6adf8fd397423c722f8aabc3087f6b9e90f0788a1 | 已本地验证 |
| 认证协调标记 | 公开入口未含 porsche_auth_coordination_v1 / porsche_auth_cookie_v1；候选入口均包含 | 不能以当前站点替代候选验收 |
| 前端候选 | 3eeca2bb1d01800f8f7e723a225d810d38e2cad7，已包含 origin/main@7fbf616 | M2 规格、质量通过 |
| 后端代码合同 | 0bab2b7，后端协调者书面复核公开合同兼容 | 部署 SHA 待确认 |
| 专用账号 | 两个普通测试账号 A/B，另需独立浏览器上下文 | 尚未创建/提供 |

以上哈希与账号状态是发布前快照；后续发布已消除入口包不匹配，两个专用账号已创建，见最新发布记录。静态哈希不能单独证明运行后端源码的精确 SHA。

## 已发布候选的构建与历史准入要求

- 文件：`/tmp/porsche-web-3eeca2b-m3.tar.gz`，仅包含已验证 dist 静态文件。
- SHA256：`00de336a121afa6742a86534e73d49611fb165255a79137ae099e841c59eeb78`。
- 构建证据：M2 最终 113/113 测试、build、浏览器 flow 8 项与独立质量复核；详见 p0-m2-verification.md。
- 发布前由负责人确认前端候选 SHA、后端实际 SHA、静态文件备份及回滚入口。不得自动运行会拉取/reset main 的部署脚本来发布本分支。
- 域名确认不等同于已发布候选，也不等同于账号已就绪。仓库 AGENTS/角色规范要求部署另行明确授权。

## 执行顺序与判定

以下为原始验收清单；实际状态以末尾执行结果为准，不得沿用 M2 Mock 结果标记通过。

| 编号 | 操作与预期 | 数据边界 |
| --- | --- | --- |
| M3-01 | 核对发布 SHA/资源，HTTPS 同源；浏览器具备 Web Locks/BroadcastChannel、可写协调存储 | 不放宽 Cookie/CORS/Origin |
| M3-02 | A 注册成功后仍需登录；重复用户名/不合法输入按合同拒绝 | 仅专用账号 |
| M3-03 | 登录、self/profile、刷新页面恢复；核对 HttpOnly/Secure/SameSite=Lax/Path Cookie 属性 | 不导出 Cookie/Token 值 |
| M3-04 | Access 过期时并发安全 GET 只恢复一次；写操作/SSE 401 零自动重放 | 不以请求失败推定零计费 |
| M3-05 | A 多标签刷新/登录/注销串行；换至 B 后旧资料、模型、历史、下载和流式回调不回写 | A/B 均测试账号 |
| M3-06 | 查看会话、撤销其他会话、撤销当前会话；被撤销 Access/Refresh 拒绝 | 不操作其他真实用户会话 |
| M3-07 | 错误旧密码不刷新重放；正确改密后会话失效，重新登录 | 仅测试密码，安全渠道保管 |
| M3-08 | 注销成功清理本地身份；故障场景结果未知时保持抑制，reload 不自动恢复 | 故障须可控，不中断生产服务 |
| M3-09 | 延迟请求、标签关闭、通知丢失时 pending/epoch 防护有效；Abort 不作为服务端已取消证明 | 先确定可处置故障环境 |
| M3-10 | A/B 资源越权被后端拒绝；403 与认证失效分流 | 不枚举真实用户资源 |
| M3-11 | 若获准使用有额度测试模型，确认 [DONE] 后 done/error 与取消边界 | 明确调用额度及清理范围 |
| M3-12 | 双方汇总脱敏证据、遗留项与各自书面结论 | 核心 SKIP 不算联合通过 |

## 后续责任与剩余确认

- 发布负责人：保留当前静态备份与回滚入口；候选已发布，不重复部署。
- 后端 project_manager：运行源码ad3f5b4已证明；跟进先前object拒绝的契约证据，正常流通过不代表根因闭环。
- 用户/协调者：预算4/4已用完，新增真实生成需新增预算；不保存凭据到报告，不自动重放。
- 前端质量角色：到期及新增证据已按限定范围复核；后续复核诊断与SSE复测，不签整体M3。

## 2026-09-03 最新发布及实测记录

用户明确确认“发布该前端候选到 aiportcloud.com，并创建两个专用测试账号执行 M3”。已执行静态资源发布和两个普通专用账号 A/B 的认证测试，无模型生成调用。

- 发布代码候选：3eeca2bb1d01800f8f7e723a225d810d38e2cad7；发布包 SHA256 00de336a121afa6742a86534e73d49611fb165255a79137ae099e841c59eeb78。
- 源站与公开普通 URL、真实 Chrome 均已加载 index-D6qDWanU.js。候选 JS SHA256 e74446da35c687f6422f20c6adf8fd397423c722f8aabc3087f6b9e90f0788a1。
- 静态目录 /var/www/porsche-web；备份 /var/backups/porsche-web/m3-3eeca2b-20260902T171331Z。资源增量上传，入口原子替换，旧资源保留。Nginx 配置检查、源站入口/JS 校验和 health 检查成功；后端容器未修改。
- 服务器前端 checkout 仍为7fbf616，不能拿它代表已发布静态版本。后端 checkout 0bab2b7；运行镜像 sha256:31abaeb16799f1bfad6501cf7d765ea443d5682561bbeed3f74255c8d8733b9a，无 revision 标签，二进制精确 SHA 尚未证明。
- 实测脚本 /tmp/playwright-test-m3-live.cjs，脱敏结果 /private/tmp/porsche-m3-live-results.json。密码仅保存在本机私有临时文件（0600），未写入仓库、聊天或报告；未持久化 Token/Cookie。

| 用例 | 实际状态 | 证据及边界 |
| --- | --- | --- |
| M3-01 | PARTIAL | 真实 Chrome 加载候选；HTTPS、Web Locks、BroadcastChannel可用；后端二进制 SHA 未获证明 |
| M3-02 | PARTIAL（已测API子项PASS） | A/B首次创建201、注册后无refresh Cookie、重复用户名409；新增empty_username_and_password、username_length_1、password_length_1样本依序均400（auth_invalid_request一次、auth_request_failed两次）。不能据结果JSON推定所有注册边界穷尽 |
| M3-03 | PASS | A真实UI登录/个人中心/reload恢复；Cookie HttpOnly/Secure/SameSite=Lax/Path=/api/v1/auth |
| M3-04 | PASS（所测范围） | v2自然到期后真实self401；过期POST401仅1次/零refresh，三个并发安全GET各401→200且共用1次refresh，迟到usage401不产生第二次refresh。有效SSE终态仍属M3-11未测 |
| M3-05 | PARTIAL | 丢失Broadcast通知且真实profile响应延迟时跨身份防护PASS；跨标签refresh/logout锁顺序PASS（refresh结算前logout 0次、之后1次）。未覆盖全部资料/模型/历史/下载/流回调组合 |
| M3-06 | PASS（API） | 撤销其他/当前会话204，被撤销Access和Refresh均401 |
| M3-07 | PASS（UI+API） | UI错误旧密码401且零refresh；API正确改密204、旧Access401、新密码重新登录200 |
| M3-08 | PASS（限定故障） | 正常API注销204，随后refresh401；客户端阻断注销后UI保持uncertain，reload零自动refresh；故障仅为请求未抵达服务端，不代表服务器已处理但响应丢失 |
| M3-09 | PARTIAL | 丢通知/延迟profile跨身份子项PASS；关闭refresh标签后pending导致reload自动认证请求0次，清理logout204。关闭/Abort不证明服务端已取消，未覆盖所有未知结果故障 |
| M3-10 | PARTIAL | A删除B专属会话404。新增真实/admin/users返回403，将该403转发给profile作客户端故障注入后身份保留、refresh 0次、profile重试PASS。早期错误admin前缀404不算403；未覆盖其他资源完整ACL |
| M3-11 | FAIL / BLOCKED | 已授权预算3次×32，gpt-5.4-nano首试503 gateway_upstream_unavailable、0帧；已用1次，余2次。成功终态、流内错误与取消均未验收 |
| M3-12 | PENDING（部分书面确认） | 前端质量角色确认第一轮部分验收；后端project_manager已基于第一轮证据接受所列认证/正常注销/会话隔离子项，未独立运行、不签整体。后端亦接受新增限定边界/403/多标签/SSE401子项；前端质量与后端角色亦书面接受最终自然到期子项；仍未签整体M3 |

M3-02 仅所列创建、重复与3个非法输入样本通过，不能据此认定全部注册验收完成。主测试结束时 A 当前会话撤销、A其他会话撤销，B已注销。额外注销故障测试通过主动refresh后logout清理该专用会话。测试账号保留供复测，没有账号删除操作。清理范围仅本轮测试会话。

下一步：后端project_manager牵头定位首帧前503，并补运行镜像来源证明；前端保留剩余2次预算，待可诊断且具备复测条件后执行。M3-05/09/10仍有组合与资源范围未测，历史详情完整矩阵亦未完成。最终自然到期及菜单回归仅按证据范围签收，web-009保持in_progress。

独立质量角色已只读复核两份脚本及脱敏结果，书面同意“部分验收通过”，明确不签整体M3。其指出主脚本复跑时会跳过已注册账号但仍记录PASS：本轮为首次执行新建两个fixture且201断言通过，后续复跑必须将复用状态标为REUSED，避免误记创建证据。持久脱敏证据：docs/agents/validation/m3-live-results.json；其中主脚本remaining是当时快照，注销故障已由后续独立结果覆盖。

## 新增证据索引与失败重跑边界（2026-09-03）

- [注册/目录边界结果](validation/m3-boundaries-results.json)：empty_username_and_password / username_length_1 / password_length_1依序400；目录200、40项及用量200仅说明可读状态，不证明模型调用授权。admin 404来自错误前缀，不用作403验收；selfAfter200、cleanup204。
- [真实403与前端故障注入](validation/m3-403-results.json)：真实/admin/users403被转发给profile，验证前端分流保留身份、零refresh与重试恢复；不是声称真实profile端点自然返回403。cleanup204。
- [首次多标签执行](validation/m3-tabs-results.json)：仅lost-broadcast-delayed-profile-cross-identity子项PASS。之后执行FAIL，日志显示登录按钮disabled、等待点击超时；未记录该fresh context的初始响应，根因未定，不能认定网络故障或业务缺陷；整份不得记PASS。
- [多标签补跑](validation/m3-tabs-additional-results.json)：refresh-logout-cross-tab-web-lock及closed-refresh-tab-pending-reload-suppression两项分别PASS。补跑结果只覆盖这两项，不抹去首次FAIL或扩展为所有多标签组合通过。

- [SSE401零重放结果](validation/m3-sse401-results.json)：UI发起真实POST，测试路由替换为固定无效Bearer，真实后端中间件拒绝；脚本`/tmp/playwright-test-m3-sse401.cjs`的`assert.equal(response.status(),401)`执行通过（JSON未保存独立HTTP状态字段，不补造网络日志）。结果1POST、0refresh，用量calls/tokens均0→0，创建会话计数0。仅证明这个无效认证拒绝子项，不证明有效SSE成功/error/done/取消或一般计费规则。

以上JSON仅含脱敏状态、计数、目录标识及失败日志，不含账号凭据、Token或Cookie值。尚未纳入正在运行的真实到期测试结果；本次文档更新没有修改业务代码、重跑业务接口或产生新的收费调用授权。

## 运行对象来源复核

只读复制当前容器的`/app/server`并执行`go version -m`：Go1.22.12、linux/amd64，未包含vcs.revision。二进制SHA256为1e7b71229813caaf4ad00f7100f167ad0f0ef5b5f812f598ba4e39d0a46b3cd5。容器及镜像对应信息见[运行对象证据](validation/m3-runtime-results.json)。这绑定了本次检查对象，但不能证明源码精确为0bab2b7；未重建、修改或重启后端。

新增边界/403/多标签补跑/SSE401已获前端独立质量角色只读复核认可（限定子项），后端角色亦已部分书面接受；均不签整体M3。


## 第二批实测补充与发现的问题

- 同时登录/注销：[竞态结果](validation/m3-cookie-races-results.json)记录每轮仅1个Cookie变更请求，过时epoch操作在网络前被拒绝；竞争登录的另一页维持anonymous，不能说所有页均已登录。
- 双标签刷新：[串行结果](validation/m3-two-refreshes-results.json)记录两个真实refresh各200，第一响应交付后才发第二请求。首次夹具没有指定排队先后，错误地假设被暂停标签先执行；修正版先确认第一个标签已排队，再加入第二个，不能把夹具错误记成服务端并发故障。
- 跨账号会话内容/Markdown导出/删除分别404；均仅操作专用账号自己创建的空会话，没有模型生成。[资源结果](validation/m3-resource-results.json)。
- 丢弃通知后，真实模型目录和历史列表的迟到响应没有重新显示旧身份：[历史结果](validation/m3-history-results.json)有该限定子项PASS。但后续route回调收到401后抛出未捕获断言，进程退出；该文件不代表整段测试完成，历史详情子项未签收，临时资源须在最终清理中补删。
- [键盘激活下载结果](validation/m3-download-keyboard-results.json)：真实Markdown正文在消费后延迟，切换身份后释放，下载事件0；这里只验证键盘激活路径及该body延迟保护，不替代鼠标UI验收。
- 导出菜单鼠标点击在1280/1600均失败。真实几何[布局证据](validation/m3-export-layout.json)显示`.el-dropdown`包装层宽高0，内部绝对定位图标x=-19/right=-1，位于视口左侧外。规格角色确认定位包含块问题，已委派仅本地最小wrapper/CSS修复，当前线上3eeca2b尚未改变。
- 首次自然到期测试[结果](validation/m3-expiry-results.json)未通过：已执行并通过至少2个401、1次refresh、sessions200的前置断言，随后users/me200断言失败。原脚本未等待该响应完成、也没持久化时间线，故不能确认产品缺陷或记PASS。v2已改为等待全部三个最终200及response finished，并持久化脱敏时间线；当前正在重新自然等待，另补真实过期POST401和迟到401。


## 本轮最终状态（2026-09-03 11:34后）

- 线上被测版本仍为3eeca2b。自然到期v2已PASS：[完整时间线](validation/m3-expiry-v2-results.json)，03:34:01Z过期POST401，03:34:02Z三个GET分别401→200，仅一次refresh200，usage401受控延迟至refresh响应后交付，logout204。前端独立质量和后端project_manager均书面接受所测子项；后端角色基于证据复核，未独立执行。
- 本地修复提交158a00e2ff3c70d302c748d0e62f419a155835ae仅改ChatSidebar.vue菜单包装层定位。修前1280/1600普通鼠标click均RED，修后均GREEN；无force/dispatchEvent、无外部API、errors/unexpected为空。独立质量审查PASS，npm test113/113、build6.53s、diff-check PASS。[修前](validation/m3-menu-red.json) / [修后](validation/m3-menu-green.json)。
- 新候选尚未部署。[候选清单](validation/m3-menu-candidate.json)绑定代码、发布包与JS哈希；发布包/private/tmp/porsche-web-158a00e-m3.tar.gz，入口index-i7ZWPv9J.js。之前授权已执行的部署对应旧候选3eeca2b，新候选发布待明确确认。
- [最终清理](validation/m3-final-cleanup-results.json)：两个专用账号均删除剩余本轮命名fixture（A补删1条，B无），重新查询fixture为0；各撤销其他会话204，确认仅剩当前1会话，logout204且随后refresh401。没有删除账号，没有改动其他用户资源。
- 未完成：修复候选线上鼠标回归、历史详情迟到响应完整实测、有效SSE成功/错误/取消及用量边界、精确后端源码来源证明。专用账号目录含gpt-5.4-nano且应用快照剩余100次，但不代表付费授权；已询问最多3次短请求、每次最多32输出tokens，尚未得到回复，未执行有效生成。
- web-009保持in_progress。不能将第一次expiry失败、导出pointer失败或未捕获route断言退出抹去；最终通过仅限各自成功复跑与明确证据范围。本轮没有将旧M2 Mock当作真实验收，也没有为补版本证明重启后端。

## 158a00e用户发布后的核验（2026-09-03，取代此前“尚未发布”状态）

用户已运行专用脚本并报告成功。公开HTML入口index-i7ZWPv9J.js、公开JS的SHA256 7c133cb1197c701cc6288d2718384c92f8b4b24a15fd13d821f3930d8bf09033均匹配候选。只读核实备份目录/var/backups/porsche-web/m3-158a00e-20260903T042341Z。部署记录见validation/m3-menu-candidate.json。

已使用原A/B专用账号进行真实Chrome回归：普通鼠标点击在1280/1600均打开菜单，图标x180、width18；真实Markdown正文消费后延迟，再切换身份，释放后下载事件为0。脚本没有force/dispatchEvent，也没有有效模型生成。证据：validation/m3-published-menu-v2-results.json。

首轮只完成1280，随后Escape在当时焦点下未关闭菜单导致夹具等待超时；清理成功，原始记录保留validation/m3-published-menu-results.json。补跑改为普通点击会话标题关闭菜单，两个宽度及下载保护通过。不能据此声称Escape交互已通过。

本次解决了新候选发布与鼠标菜单线上回归事项；历史上3eeca2b的真实认证结果仍绑定原版本，不将其改写为158a00e全面复跑。M3整体仍未签收，保留有效SSE、历史详情其余矩阵及后端源码来源证据缺口。

独立前端质量角色已书面接受158a00e已发布菜单普通点击及下载身份隔离子项；不覆盖Escape、有效SSE或整体M3。发布后最终清理见validation/m3-postpublish-cleanup-results.json：A/B fixture均0，撤销遗留会话204，各注销204且refresh401。


## 有效SSE首试失败与诊断交接（2026-09-03 12:30后）

用户“继续”承接此前具体模型与预算询问，授权最多3次gpt-5.4-nano生成，每次max_tokens=32。复用专用B账号，在已发布158a00e页面普通UI发送“只回复 OK。”；测试路由仅把真实出站请求限制为已批准model、stream=true、max_tokens=32，不伪造响应。保留UI默认temperature=0.3、context_window=8。

- [首试结果](validation/m3-sse-normal-results.json)：HTTP503，application/json; charset=utf-8，gateway_upstream_unavailable，SSE事件数组为空。脚本在503处失败，后续正常终态、可见回复、用量同步及成功路径零重放断言未执行；不能据此宣称这些行为通过。注销204。
- [预算台账](validation/m3-sse-budget.json)：发送前记录第1次请求，时间2026-09-03T04:30:49.890Z。已用1/3，余2/3；不清空台账、不换模型、不自动重放。首试脚本拒绝在非零预算记录下原样重跑。
- [无生成诊断及清理](validation/m3-sse-diagnose-results.json)：模型详情200，目录200、stale=false、40项；应用日调用数0→1，剩余100→99，total_tokens_used仍0。只证明应用计数，不证明供应商费用为0。失败请求产生的测试会话已删除200，诊断登录注销204。
- [访问日志摘要](validation/m3-sse-access-log-summary.json)：04:30:45Z至04:31:10Z窗口内唯一匹配POST /api/v1/platform/chat/completions为503，耗时1.853502894s。仅保留脱敏摘要；没有保存本次request_id或内部失败阶段，不能补造关联字段。
- [脚本来源哈希](validation/m3-sse-script-provenance.json)：对应本机临时脚本，账号文件、Token、Cookie值未进入证据仓库。

后端project_manager只读核对0bab2b7代码：platformStreamPreError统一转换多种失败；流准备在上游前消耗应用日调用额度并写会话/用户消息；Chat的网络错误与非2xx响应、首帧解析失败等均可能落入相同503。现有访问日志不能还原已丢弃的上游状态/原因。目录与详情200不证明Chat端点可用。后端运行二进制与此源码的精确对应仍未证明，不能把源码分析当作已证实运行根因。

双方结论：前端协调者、独立质量角色及后端project_manager均确认本次仅能判定M3-11首试FAIL、首帧前失败，未签整体M3。后端及质量角色基于脱敏结果/脚本与代码只读复核，没有独立执行线上生成。质量复核中的token表述以实际应用计数为限。

后续任务由后端project_manager牵头：准备最小脱敏诊断方案，记录失败阶段、服务端request_id、安全的上游状态或网络错误类别、耗时和运行版本；不记录密钥、认证头、完整提示词/响应正文。具体诊断实现与部署须单独形成可审查变更，不在本次只读分析中执行。先用本地可控上游验证诊断覆盖且公开错误合同不变，再确定获授权的诊断版本、发布与回滚步骤，满足条件后复用剩余2次预算。前端负责保存响应状态/事件顺序、取消边界及调用前后应用用量，独立质量复核后再提交双方签收。责任清单见[诊断任务准备记录](m3-sse-diagnostic-handoff.md)。


## 后端诊断本地候选（用户继续后，2026-09-03）

已按双方诊断方案实施本地后端候选04ed728（基于0bab2b7），独立worktree Porsche/.worktrees/m3-sse-diagnostics。固定阶段/原因、request_id_sha256及独立trace_id、上游状态和保存确认标记已完成；保留公开503/SSE及扣次/保存顺序。隔离MySQL/Redis最终全量293、race46个pass事件，0fail/skip；vet/build通过，后端PM与独立质量限定本地PASS，实际socket脱敏探针通过。新边界redirect response+error漏记先RED后修复。临时测试容器和凭据已清理。

二进制从独立clone构建，确认嵌入源码04ed72806f5ca139d219d166452e0473ba5bf1a1、vcs.modified=false；嵌套worktree最初错误VCS元数据产物未采用。包与哈希见[候选清单](validation/m3-backend-diagnostic-candidate.json)。本地Docker镜像构建因Docker Hub基础镜像metadata拉取超时未完成，因此没有候选镜像ID、未上传/部署。需在可用构建环境完成amd64镜像，核对二进制与标签并准备后端回滚，再取得明确后端发布授权。

本地诊断完成不证明线上503已修复。M3-11继续FAIL，线上模型预算仍已用1/3、余2/3，每次max_tokens32；本轮本地测试没有生成上游调用。有效正常/取消SSE及其余矩阵仍未联合签收。后端详细报告位于Porsche提交e7de256的docs/superpowers/reports/2026-09-03-m3-sse-diagnostics.md。

## 2026-09-03：镜像已完成，私有上传与后端发布待授权

- 代码04ed728的linux/amd64诊断镜像已在本机离线组装、导出和重新加载；精确ID sha256:a69cfdab1cc8e18056286ae3991669d37515994041664b3fed5b6290ac602316，归档SHA256 af8a122d1fa5018a981d4757aff03b0b204ef8048c38f2632eb47e343ad0c580。
- 来源标签、两个二进制哈希、架构、入口、CA均核验；无凭据/无网络启动按预期缺JIEKOU_API_KEY拒绝，不能当作真实服务健康。
- 原私有源码/二进制构建包上传被自动审批拒绝，未执行。远端仅构建公开基础层并下载，本机加入私有二进制；私有镜像尚未上传，生产后端未替换。
- 具体上传、三锁、运行态配置快照、切换及失败回滚准备见后端docs/superpowers/plans/2026-09-03-m3-backend-release.md；待用户明确授权，计划尚未在生产执行或演练。此前镜像构建超时为已解除的历史阻塞。
- 后端PM书面确认发布准备要求，不代表用户上线授权或线上M3签收。M3-11仍FAIL，剩余2次gpt-5.4-nano×max_tokens32预算保留。

后端PM随后只读复核最终发布计划和两份JSON，书面确认材料足够提交用户授权申请、摘要一致且无阻塞申请的问题；不独立验证镜像内容、不授权部署、不签M3。协调者复核归档SHA、两仓清单一致及JSON/diff检查通过。

## 2026-09-03：后端诊断已发布，SSE第二次仍失败并定位解析阶段

- 用户明确确认上传及后端替换后完成发布：源码04ed728，镜像sha256:a69cfdab1cc8e18056286ae3991669d37515994041664b3fed5b6290ac602316；新容器9425ea244ad71944ef78474cc405208fbbbe7eb22fdffd2b81e269d328d85b0c于05:50:09Z启动，源站/公网health严格200。旧d2de587容器以ai-gateway-go-acceptance-rollback-1788414605780771454保留，未执行生产回滚；前端158a00e哈希保持。
- 首次预检因OomKillDisable的null/false表示差异安全停止，未停旧服务。公开基础镜像两版本API探针证实创建规范化，限定兼容该默认值后重新预检；true仍拒绝。三锁、私有运行配置JSON快照、候选create后逐字段比对均执行，成功后私有快照删除。脚本已归档，仅适用本次精确对象，不是可直接复用的常规发布入口。
- 真实SSE第2次于05:51:52Z发送：gpt-5.4-nano/max_tokens32，1POST/0refresh，HTTP503、gateway_upstream_unavailable、0帧。请求ID哈希与候选日志匹配，源码revision也匹配；上游返回200，sse_stream failed/malformed_chunk，首帧未发出，auth/catalog/前置quota及消息写入均success，assistant/usage/final_write未运行。尚不确定具体哪个字段或数据类型不兼容，不能宣称修复或归责供应商。
- 应用日调用1→2、剩余99→98、token计数0；这不是供应商零费用证明。测试会话删除200、注销204。预算累计2/3，剩1次×32，不重置、不盲目重放。
- M3-11仍FAIL、go-004仍blocked、web-009仍in_progress。后续先核对解析器拒绝条件与脱敏结构证据，再决定是否使用最后一次预算；不放宽白名单投影、不透传上游正文、不把health通过当M3签收。

## 本轮双方与质量书面复核

后端project_manager只读复核release-result、浏览器结果、候选诊断及预算，确认发布记录与第2次失败记录一致，request_id_sha256完全匹配，故障位于upstream200之后、首个公开帧之前的chunk投影校验；M3-11仍FAIL。质量角色独立只读复核同组证据，给出PARTIAL：认可部署健康及诊断链路，不认可有效SSE通过或整体M3签收。两角色均未独立执行部署/线上生成。

下一步责任与准入：后端PM先对照已约定上游SSE规范和静态样例，梳理JSON/字段类型、id/object/created、usage-only、choice/delta/tool_calls各拒绝条件；需要补诊断时仅设计固定原因枚举和固定字段路径/类型类别，不记录原始帧、值、提示词、工具参数或任意字段名，不提前放宽投影白名单。执行角色先以合成fixture证明各分支分类与脱敏，质量角色复核后才能准备后续候选。待下一次能区分失败分支时，协调者再按剩余1次×32预算安排复测，不能盲目重试。此后续方案尚未实施或发布。

## 2026-09-03：chunk细分候选6e70784已完成本地验证，待新候选发布授权

- 固定malformed_chunk_detail.reason/field已实现，原公开503、大类和SSE接受/拒绝行为保持；没有记录原始帧或字段值。完整345/race113个测试pass，0fail/skip，vet/build及独立规格/质量PASS；独立22组新旧输出一致。
- linux/amd64镜像cb42daed已本机构建，归档SHA195a6f38，来源/二进制/CA验证通过；尚未上传/部署。具体清单m3-chunk-diagnostic-candidate.json与后端发布单2026-09-03-m3-chunk-release.md已准备，后端PM材料复核通过。
- 线上仍04ed728（容器9425ea/镜像a69），M3-11仍FAIL，具体首帧校验字段尚未知；最后1次gpt-5.4-nano×max_tokens32预算未使用。新候选需单独完成发布授权及运行核验后才能安排最后一次复测。
- 本轮测试fixture和凭据已清理；不能复用其旧TEST_*地址。go-009仅本地passing，go-004保持blocked，前端web-009保持in_progress。

后端PM与独立质量均仅确认本地细分诊断及候选材料，不签真实SSE或整体M3。细分方案、验证及发布步骤详见后端2026-09-03-m3-chunk-validation报告与m3-chunk-release发布单。


## 2026-09-03 14:19：6e70784已发布，第三次SSE定位object校验失败

本节为当前状态；下方“未发布/字段未知/剩余预算”等均为历史快照。

- 用户明确“授权”后已上传并部署6e70784；镜像cb42daed、容器13ada4aa，源站/公网health均200，前端158a00e资源哈希未变。旧9425ea及更早d2de587容器均停止保留，私密运行配置快照已删除；未执行生产回滚。
- 第3次真实请求1 POST/0 refresh，HTTP503/0帧。浏览器请求哈希与运行版本日志精确匹配；上游200，sse_stream失败malformed_chunk，固定详情invalid_value/object。仅能确认解码后object不等于chat.completion.chunk，实际值、缺失/null/空值及后续字段有效性仍未知。
- 应用daily_calls_used 2→3、remaining 98→97、tokens仍0，不代表上游零计费；本次测试会话删除200、注销204。
- 预算3/3已耗尽，每次gpt-5.4-nano/max_tokens32；不得重置台账或继续生成。下一步由后端PM核对object契约与既有脱敏样例，先离线验证假设再决定兼容方案；任何新增真实生成需新的明确预算授权。
- 后端project_manager书面确认发布子项通过、M3-11 FAIL；独立质量PARTIAL。两者仅复核证据、未独立执行线上操作。go-009诊断范围passing、go-004 blocked、web-009 in_progress，整体M3不签收。

完整发布与第三次复测证据及双方书面结论见[本轮报告](2026-09-03-m3-chunk-release-and-retest.md)。


## 2026-09-03 15:22：追加1次诊断调用预算

- 用户明确“增加调用预算”；未指定数量，按最小增量增加1次，总上限3→4，已用3、剩余1。模型仍为gpt-5.4-nano，每次max_tokens=32；原三次记录完整保留。
- 新额度用于补充可区分object原因的诊断复测，先准备并验证具体采证方案，不盲目重跑旧请求、不自动重放。历史attempt3脚本仍是一次性记录，不为增加预算而直接修改重跑。
- 本次仅更新预算和交接记录，未执行第4次生成、未部署新候选。增加调用额度不代表已授权任何尚未确定的新候选部署。M3-11仍FAIL。
- 当前预算以validation/m3-sse-budget.json及本节为准；此前“预算0/3次耗尽”是当时事实。


## 2026-09-03：object有限分类候选ad3f5b4已准备

- 本地实现固定decoded_kind/field_shape/key_match；保持原SSE接受/拒绝，原值不进入日志。相关包及race各175pass；默认全量304pass/0fail/98个DB或Redis fixture缺失SKIP，不能算完整DB验收。50组公开响应与17正常摘要对照一致，独立规格/质量限定PASS。
- linux/amd64候选ad3f5b4、镜像2bc6b866、归档SHA8154e46b已核验；尚未上传或部署。发布脚本7项mock/绑定检查、第四次脚本3项预检通过。详细发布单2026-09-03-m3-object-release.md与m3-object-diagnostic-candidate.json已准备。
- 线上07:34:15Z只读确认仍6e70784/13ada4aa/cb42，健康200、两个更早回滚对象保留。本轮0真实生成；预算总4、已用3、剩1次gpt-5.4-nano/max_tokens32。
- 待准确新候选部署授权后再核验运行来源并复测。go-010仅本地诊断passing，go-004 blocked、web-009 in_progress；M3-11仍FAIL。

详见[本轮验证](2026-09-03-m3-object-validation.md)。

## 2026-09-03 15:48：ad3f5b4发布及正常SSE复测通过

本节为最新状态，后续旧记录的“未发布/剩余1次/有效流FAIL”仅适用于当时。

- ad3f5b4已授权发布；第4次正常SSE子项PASS：200、meta→4 delta→[DONE]→done，1 POST/0 refresh，唯一请求哈希与运行日志匹配、全部保存阶段成功、tokens0→1。清理200/logout204，预算4/4耗尽。object拒绝本次未复现，根因未闭环；流内错误/取消等未测，整体M3 PARTIAL。go-004保持blocked、web-009保持in_progress，诊断功能passing不代表整体签收。
- 新容器1665e111、镜像2bc6b866，源站/公网200；旧13ada4aa及另两个更早容器停止保留，前端158a00e不变，私密快照删除。
- 后端PM已书面确认发布及正常终态限定PASS；独立质量亦确认成功流限定PASS、整体M3 PARTIAL；详见2026-09-03-m3-object-release-and-retest.md。没有产生object_detail；提取器unknown/unknown是缺字段默认值，不是拒绝。
