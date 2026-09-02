# P0 M3 真实联调准入与执行清单

2026-09-03，用户确认验收域名为 https://aiportcloud.com。用户随后明确授权发布候选并创建两个专用测试账号；以下最新执行记录取代原准入检查状态。

## 当前结论

M2 已完成。M3 已执行部分真实认证用例，整体尚未通过。前端候选已发布；具体覆盖与遗留见下方最新记录。

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

静态哈希差异本身不能证明运行源码的精确 SHA；此处仅确认当前公开入口与候选构建不一致。未读取生产凭据或配置。

## 已准备的发布候选

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

## 待确认项与责任

- 发布负责人：是否发布前端候选、通过何种已授权主机/部署入口操作，以及回滚备份。
- 后端 project_manager：实际部署 SHA、可信 Origin、专用账号/ACL/额度及可控异常场景。
- 用户/协调者：是否允许创建两个专用测试账号，或提供已准备账号的安全使用方式；不在聊天中传密码。
- 前端质量角色：执行后按实际用例和最终部署版本复核。当前只确认准备完成，不签 M3。


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
| M3-02 | PASS（API） | 仅创建 A/B 两账号，201；注册后无refresh Cookie，重复用户名409；非法输入边界未补测 |
| M3-03 | PASS | A真实UI登录/个人中心/reload恢复；Cookie HttpOnly/Secure/SameSite=Lax/Path=/api/v1/auth |
| M3-04 | NOT_RUN | 尚未真实Access到期并发验证；不能以M2模拟结果替代 |
| M3-05 | NOT_RUN | 多标签串行与跨身份旧回调仍待真实场景 |
| M3-06 | PASS（API） | 撤销其他/当前会话204，被撤销Access和Refresh均401 |
| M3-07 | PASS（UI+API） | UI错误旧密码401且零refresh；API正确改密204、旧Access401、新密码重新登录200 |
| M3-08 | PASS（限定故障） | 正常API注销204，随后refresh401；客户端阻断注销后UI保持uncertain，reload零自动refresh；故障仅为请求未抵达服务端，不代表服务器已处理但响应丢失 |
| M3-09 | NOT_RUN | pending关闭/通知丢失/延迟请求等尚待可控故障验证 |
| M3-10 | PARTIAL | A删除B专属会话返回404；未扩展到其他资源，403分流未实测 |
| M3-11 | NOT_RUN | 未调用收费模型；需指定可用测试模型及额度后验证真实SSE |
| M3-12 | PENDING | 独立质量角色书面确认部分验收通过；后端project_manager未对线上结果签收，无联合M3签收 |

M3-02 仅所列子项通过，仍缺非法输入边界，不能据此认定全部注册验收完成。主测试结束时 A 当前会话撤销、A其他会话撤销，B已注销。额外注销故障测试通过主动refresh后logout清理该专用会话。测试账号保留供复测，没有账号删除操作。清理范围仅本轮测试会话。

下一步：协调者请后端提供运行镜像来源证明、可控Access到期方案与测试模型额度；前端补 M3-04/05/09、注册边界、403 与授权资源范围；质量角色复核后由双方逐项书面签收。web-009保持in_progress，不声称M3整体通过。

独立质量角色已只读复核两份脚本及脱敏结果，书面同意“部分验收通过”，明确不签整体M3。其指出主脚本复跑时会跳过已注册账号但仍记录PASS：本轮为首次执行新建两个fixture且201断言通过，后续复跑必须将复用状态标为REUSED，避免误记创建证据。持久脱敏证据：docs/agents/validation/m3-live-results.json；其中主脚本remaining是当时快照，注销故障已由后续独立结果覆盖。
