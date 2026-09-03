# P0 M3 真实联调准入与执行清单

2026-09-03，用户确认验收域名为 https://aiportcloud.com。用户随后明确授权发布候选并创建两个专用测试账号；以下最新执行记录取代原准入检查状态。

## 当前结论

M2 已完成，前端候选已发布。M3 已完成下列具体认证、故障与隔离子项，整体仍未通过，web-009 保持 in_progress。真实 Access 到期测试正在运行；无效Bearer的SSE401零重放子项已通过，不能代表有效SSE终态；模型目录可见或剩余额度不代表获准发起付费模型调用。

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
- 后端 project_manager：提供运行镜像来源/源码对应证明；第一轮及新增限定子项已书面确认，最终到期证据仍需逐项复核。
- 用户/协调者：继续使用已创建专用账号，不在报告保管凭据；付费SSE须另有明确模型和调用预算授权。
- 前端质量角色：待当前到期测试及新增证据齐备后复核实际子项，不签整体M3。

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
| M3-11 | NOT_RUN | 未调用收费模型；需指定可用测试模型及额度后验证真实SSE |
| M3-12 | PENDING（部分书面确认） | 前端质量角色确认第一轮部分验收；后端project_manager已基于第一轮证据接受所列认证/正常注销/会话隔离子项，未独立运行、不签整体。后端亦接受新增限定边界/403/多标签/SSE401子项；前端质量与后端角色亦书面接受最终自然到期子项；仍未签整体M3 |

M3-02 仅所列创建、重复与3个非法输入样本通过，不能据此认定全部注册验收完成。主测试结束时 A 当前会话撤销、A其他会话撤销，B已注销。额外注销故障测试通过主动refresh后logout清理该专用会话。测试账号保留供复测，没有账号删除操作。清理范围仅本轮测试会话。

下一步：发布并线上回归已完成本地验证的菜单修复候选（待新候选发布确认）；协调者请后端补运行镜像来源证明。最终自然到期证据已获双方角色限定签收。M3-05/09/10只通过所列子项，仍有组合与资源范围未测；真实成功/错误/取消SSE需明确测试模型和调用预算授权。web-009保持in_progress，不声称M3整体通过。

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
