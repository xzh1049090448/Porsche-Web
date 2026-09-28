# 前端技术方案初稿与自测计划

任务：FE-PREP-20260903-02；来源：front_end_project_coordinator；接收角色：front_end_developer（本次子任务frontend_alignment_preparation）。开发者已明确接受只读准备指令并返回方案，协调者整理归档。2026-09-03。本文件是准备方案，**本轮没有执行下面的测试、代码实现或线上操作**。

## 1. 委派范围与确认

- 输入：AGENTS.md、docs/agents/domain.md、三份工程/API/数据规范、interface-contract.json、P0实施计划、p0-m3-readiness.md及最新object发布复测报告。
- 产出：复用方案、API/store/组件拆分、自测步骤和预期、证据要求、联调准入及阶段计划。仅准备，不创建新功能、不安装依赖、不部署、不读取凭据、不调用模型；后端交流只经前端协调者。
- 基线：前端发布158a00e、后端发布ad3f5b4（既有证据），契约v1.0.0-p0，补充文档修订ALIGN-20260903-02-r2。核心10端点有后端确认，新增依赖以本轮A2最终回复为准。
- 当前正常SSE一次PASS，整体M3 PARTIAL；生成预算4/4耗尽。下一次真实测试仍需核验当时运行版本，不能把归档版本当永久实时状态。
- 前端开发者不代签后端或整体质量门禁。以下前端方案由开发者提出、协调者接受；后端只确认契约和协作依赖，不表示后端审查过每条前端代码。

## 2. 已实现架构与复用职责

| 层 | 现有文件/组件 | 本次准备采用的职责 |
| --- | --- | --- |
| 认证核心 | src/api/auth-session.js | 内存Access/AuthUser，状态机、epoch/generation、单飞refresh、Web Locks、Cookie pending/未知结果关闭 |
| 认证接口 | src/api/auth.js | 用户名注册/登录、刷新、注销、撤销和改密；注册不自动登录 |
| 通信入口 | src/api/request.js | Axios JSON与authenticatedFetch，保留Response/text/Blob/stream形态；错误分流和身份校验 |
| 资料 | src/api/users.js、src/api/profile-state.js、src/stores/user.js | AuthUser与业务profile分离；资料失败不抹掉认证；身份变化清空资料和用量 |
| 模型 | src/api/platform.js、src/stores/settings.js | 授权模型目录、详情与参数；身份epoch保护缓存 |
| 历史 | src/api/conversations.js、src/stores/chat.js | 列表/详情/pending、当前选择、发送等待、重命名/删除/导出；身份变化清空 |
| 流 | src/api/stream-scope.js、src/utils/sse.js | AbortController、epoch门控、解帧、不可逆终态；旧回调/finally不覆盖新身份 |
| 页面组件 | Chat.vue、ChatInput.vue、ChatMessageList.vue、ChatSidebar.vue、ModelPanel.vue | 页面组装、输入、展示、历史操作及模型面板，不复制鉴权或服务端ACL |
| 偏好 | src/stores/theme.js、src/stores/locale.js | 非敏感偏好可保留，不混入身份凭据 |

约束：Vue3/JavaScript/Vite6/npm不变；GUID字符串；Refresh仅HttpOnly/Secure/SameSite=Lax Cookie；Access只在内存；共享存储只放非敏感epoch/pending/suppressed。安全GET是否可恢复取决于auth-session.js:isSafeAuthRead()的真实allowlist，不能一概按HTTP GET判安全。allowlist包含部分Markdown export GET；**非幂等POST、认证写请求和SSE零自动重放**。403不自动注销，迟到响应读取body后仍校验身份。

开发者初稿将“导出不重放”泛化，并将后端来源证明列为未完成；协调者指出后开发者已书面修正：导出按GET allowlist，ad3f5b4来源已证明但复测时重新核验。相关API文件路径已由开发者只读核验。

## 3. 自测矩阵草稿

所有“本地fixture”结果只能证明本地行为；不能替代服务端持久化或真实上游验收。已有通过项保留原版本证据，无需为补文档机械重跑。下表是下一执行任务的输入，非本轮测试报告。

| ID | 场景与步骤 | 应观察的结果 | 证据与资源 |
| --- | --- | --- | --- |
| SSE-E1 | meta/delta后注入event:error，再投递[DONE]/done | 失败不可逆；不调用成功回调、不根据失败流增加成功用量；无POST重放 | 本地流事件、终态/回调/网络计数；真实错误注入另定专用环境和预算 |
| SSE-E2 | 生成中取消，再让旧chunk/done到达 | 旧响应不回写，取消不显示成功、不推算用量；不能推定服务端取消或零计费 | 本地Abort时间线/回调/store；真实取消需新生成额度，后端核对保存及用量 |
| SSE-E3 | meta/部分delta后EOF，无业务done | incomplete/error，不成功；保留明确未完成反馈 | 本地流序列及UI；真实中断单列授权/资源 |
| SSE-E4 | [DONE]后业务error或连接异常 | 不把上游结束当业务成功 | 本地/受控后端fixture；真实流若调用模型需预算 |
| SSE-E5 | 重复done、error/done混合、UTF8拆包/CRLF/多行data | 回调终态最多一次；解帧正确，错误不可逆 | 优先复用既有SSE001–008回归，只补缺口 |
| SSE-E6 | 合成非法object/choices/delta等上游结构 | 后端维持既定投影/拒绝与安全错误；前端不展示原始上游正文 | 后端隔离fixture、前端公开错误样本；不把模拟当真实object根因 |
| ID-E1 | A请求详情延迟，换B后放行A响应；另测迟到401 | A正文/旧选择/旧pending不污染B，旧请求不清除B状态；过时身份不恢复 | 专用会话、脱敏epoch/请求时间线、activeId与内容隔离断言；无需生成但真实读写须有范围 |
| ID-E2 | A开始流，换B后投递旧meta/chunk/done/error及finally | B消息、用量、错误及streaming状态不受A影响 | 本地合成流不需额度；真实流需新预算 |
| ID-E3 | 丢Broadcast通知、延迟profile/models/history/download body、关闭刷新标签 | epoch/pending保护仍生效；未知结果不自动恢复 | 复用已测子项，只补详情/流等缺口；客户端故障不证明服务端取消 |
| REG-E1 | 用户名长度2/3/20/21、允许ASCII/非法字符、trim、重复 | 按合同及明确HTTP错误拒绝或成功；注册不自动登录 | 本地表单/transport；真实新账号另列可清理范围，复用标REUSED，不伪造201 |
| REG-E2 | 密码7/8/20/21与Unicode/弱密码、nickname省略/null/字符串 | 以服务端注册规则和端点状态为准；未知nickname限额先澄清 | 不将密码/Token/Cookie写进结果；密码边界结合弱密码规则，不能仅凭长度预判成功 |
| ACL-E1 | A访问/更新/删除B会话及导出；A读不可见模型 | 后端资源拒绝；不污染状态、不因资源拒绝注销、写请求不重放 | 专用A/B自建资源，方法/路径/status/安全类别和本地状态；无需模型生成 |
| ACL-E2 | 普通用户访问admin403、撤销后Access/Refresh401 | 403与认证失败分流；旧凭据不可用；写请求/SSE零重放 | 优先引用已有实测，不扩大为完整ACL通过 |
| COMPAT-E1 | 本地compare一模型成功/另一失败或EOF | 保持既有模型级兼容，不误报全部成功 | 本地fixture；完整compare产品合同/真实多模型预算未冻结，不作为已测结论 |

每个实际执行用例记录：双侧版本、契约修订、正常/异常/边界/权限类别、预期与实际、命令/脚本、退出码、HTTP/事件顺序、回调/POST/refresh计数、应用用量和清理结果。只保存脱敏断言/数量/固定分类；不保存账号密码、Cookie/Token、上游原文或其他用户正文。逻辑删除遵守现有接口，不能直接物理删除数据库。

## 4. 联调准入、里程碑与责任

1. P-A：两协调者确认准确契约修订、实际运行来源、专用环境/账号范围；固定日期目前PENDING。
2. P-B：执行者在已授权本地/隔离环境运行必要缺口测试，记录实际结果并由质量复核；无需模型生成的准备可以先排。
3. P-C：列出确需真实生成的测试、模型、次数和token上限、可能错误结果及清理；用户明确新增预算后，两协调者约定具体时间。当前0剩余额度，不执行。
4. P-D：受控真实测试及后端持久化/用量证据复核；失败保留原记录，不能无预算重试。
5. P-E：质量独立审查最终版本与证据，两协调者分别签收；核心未测/跳过不得记完成。

前端开发将问题交前端协调者，后者对接后端PM；后端负责协议、错误分类、隔离依赖和保存/用量证据。日期、容量、供应商语义和新增预算未确认时，说明依赖，不编造承诺。下一执行任务须有独立的实际写入/测试范围，本文件本身不触发执行。

## 5. 已知事实与未测分开

- 菜单布局158a00e修复及1280/1600普通鼠标回归已有证据；不等于Escape也通过。
- 自然到期首次夹具未等待最终响应、某历史route回调异常退出，是证据限制，不自动认定产品缺陷；成功补跑仅覆盖自身范围。
- ad3f5b4实际运行来源已证明，正常流一次通过；原object拒绝没有真实分类原因，不宣称已修复。
- 剩余error/cancel/EOF、迟到详情/流、注册/ACL和当前候选98项隔离集成SKIP保持待验收。
- 性能和商业结算承诺未冻结；用户端token统计不等于供应商账单。

接收回执：frontend_alignment_preparation已明确“接受FE-PREP-20260903-02，只读准备”；收到协调者两项纠正后再次确认。**步骤四的准备指令和方案输出已完成，不代表步骤四之后的验证已执行。**
