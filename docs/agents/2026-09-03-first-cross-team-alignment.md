# 跨团队首次对齐备忘录

编号：ALIGN-20260903-02；材料修订r2；日期：2026-09-03。**本备忘录补齐首次对齐交付物；实施已推进至M3，不倒签历史，也不将一次正常流成功等同整体验收。**

前端：front_end_project_coordinator；后端：project_manager（backend_m3_alignment）。本轮只做信息对齐、文档整理、任务准备与只读审查，不修改业务代码、不安装依赖、不部署、不新增真实生成。根任务作为已获授权的文档写入者保存结果；协调和审查角色只读。

确认状态：**双方确认**＝本轮双方针对条款明确回复；**待确认**＝未形成同一版本双向回复；**已确认待定**＝双方同意当前不能承诺具体值，不能解释成该值已经确认；**已测**仅限证据中的版本、用例和环境。后端确认来源统一见[正式请求与回复](2026-09-03-alignment-confirmations.md)。

## 1. 内部自检与版本

本地输入全文已读取并以文件摘要记录，见[自检快照](validation/first-alignment-inputs.json)。快照包含双方分支、HEAD、最近5提交、feature状态及AGENTS/domain/feature/progress/规范哈希；输入以本轮写入前版本为准，可从所列Git HEAD读取原文。未拉取或切换分支，避免把文档整理变成代码整合。

- `/Users/xuzhihao/code/Porsche-Web/.worktrees/auth-p0-harden`：分支`feature/auth-p0-harden`，文档工作树HEAD `83c87fbe791204a6915ec784bfa6371475312598`。
- `/Users/xuzhihao/code/Porsche/.worktrees/m3-sse-diagnostics`：分支`fix/m3-sse-diagnostics`，文档工作树HEAD `aec1619ee710c80cd71dbe529660e2d12b3fda7b`。

前端package版本1.0.0（Vue3/JavaScript/Vite6/npm）。前端预存未跟踪package-lock.json保留，不纳入提交；后端工作树干净。业务运行证据另记：前端158a00e，后端ad3f5b4；最近只读运行快照时间2026-09-03T07:48:51Z，本轮未再访问线上，因此不是本轮实时探测。[发布与SSE报告](2026-09-03-m3-object-release-and-retest.md)绑定镜像、容器、资源SHA。文档HEAD不等于部署源码。

自检风险：原契约保留“未授权业务测试/运行来源未证明”等过时表述，本轮将其移入history并更新当前字段；原M3验收记录中历史FAIL保留。98项默认测试SKIP、object根因和4/4预算等限制仍有效。**后端确认：A8双方确认；本地输入由前端核对，非新线上验收。**

## 2. 需求边界、优先级与差异

首期P0聚焦用户名认证、可撤销会话、内存Access、Cookie刷新、多标签串行及跨用户隔离、SSE终态和零自动重放。已存在的目录、资料、历史、下载、用量作为这些流程的依赖，不能删除既有功能，也不代表完整模型面板/多模态/支付等产品功能全部验收。历史手机号登录由用户名P0取代，不恢复退役接口。**后端确认：A1双方确认；依赖的具体补充清单见A2最终复核。**

双方feature对照（仓库passing仅代表各自证据范围）：

| 仓库 | feature | 优先级 | 状态 | 含义 |
| --- | --- | --- | --- | --- |
| 前端 | web-011 | 0 | passing | Issue #4：一次性 API Key 安全复制兼容 |
| 前端 | web-009 | 0 | in_progress | P0 用户名认证与可撤销会话加固 |
| 前端 | web-010 | 0 | passing | Issue #3：首次进入加载选中对话历史 |
| 前端 | web-001 | 1 | not_started | 登录 |
| 前端 | web-002 | 2 | not_started | 模型面板 |
| 前端 | web-004 | 4 | not_started | 对话 |
| 前端 | web-005 | 5 | not_started | 个人中心 |
| 前端 | web-006 | 6 | not_started | 套餐计费 |
| 前端 | web-007 | 0 | passing | GUID 标识切换与 RAG 移除 |
| 前端 | web-008 | 0 | passing | 模型选择搜索 |
| 后端 | go-007 | 1 | passing | 修复真实 MySQL/Redis 测试基线 |
| 后端 | go-004 | 1 | blocked | PRD-260820 JieKou AI 白牌上游接入 |
| 后端 | go-006 | 1 | passing | PRD-260828 用户注册管理一期 |
| 后端 | go-005 | 5 | passing | 前后端一键更新重启 |
| 后端 | go-008 | 0 | passing | M3单模型SSE脱敏阶段诊断 |
| 后端 | go-009 | 0 | passing | M3 SSE chunk固定校验原因细分 |
| 后端 | go-010 | 0 | passing | M3 object字段有限形态诊断 |

主要差异与处理：

- web-001仍有手机号历史标题，按其notes被web-009用户名协议取代，不作为新需求；本轮不擅改产品范围或状态。
- 前端web-009与后端go-004不是一对一功能编号，不能按单侧passing判联合通过；go-008/009/010为诊断能力，不是业务故障修复证明。
- 完整模型schema、上游created时间语义、性能阈值、compare/多模态新功能和商业计费承诺尚未冻结；既有P0需要的取消/error/用量正确性仍属M3必要门禁。
- 后端数据库通用软删建议与用户名永久占用规则有差异，以已确立的用户名业务规则为准；不借文档对齐改迁移。

首期验收标准：M1精确契约双方确认；M2本地实现/单测/构建/浏览器与独立质量通过；M3按明确版本在同源HTTPS专用账号完成约定核心矩阵，失败整改、跳过补齐、风险明确，双方协调者分别书面签收。模板和Mock不能代替真实证据，单次成功不证明稳定性。**后端确认：A1/A7双方确认。**

## 3. 接口契约清单

契约入口：[interface-contract.json](../../interface-contract.json)。API路径前缀仍/api/v1，契约版本v1.0.0-p0，文档修订ALIGN-20260903-02-r2。使用描述性字段类型，非JSON Schema；不能把类型说明字符串当实际响应样例。

原10个P0核心端点及补充11个既有依赖定义已获后端A2最终r2确认及前端明确接受。请求/响应完整字段说明、认证、Content-Type、错误、分页、DTO及源文件引用见JSON；下表为索引，不省略其空body或实际状态差异。

| 方法 | 路径 | 成功响应 | 范围 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | 201 {"user": "AuthUser"} | P0核心 |
| POST | `/api/v1/auth/login` | 200 LoginResponse | P0核心 |
| POST | `/api/v1/auth/refresh` | 200 LoginResponse | P0核心 |
| POST | `/api/v1/auth/logout` | 204 null | P0核心 |
| GET | `/api/v1/auth/self` | 200 {"user": "AuthUser"} | P0核心 |
| GET | `/api/v1/auth/sessions` | 200 {"data": "AuthSession[]"} | P0核心 |
| DELETE | `/api/v1/auth/sessions/{guid}` | 204 null | P0核心 |
| POST | `/api/v1/auth/sessions/revoke-others` | 204 null | P0核心 |
| POST | `/api/v1/auth/self/password` | 204 null | P0核心 |
| GET | `/api/v1/users/me` | 200 UserProfile | P0核心 |
| GET | `/api/v1/platform/models` | 200 {"data": "Model[]", "catalog_stale": "boolean"} | 既有依赖 |
| GET | `/api/v1/platform/models/detail` | 200 Model | 既有依赖 |
| POST | `/api/v1/platform/chat/completions` | 200 sse_events; first-frame failure instead returns HTTP error JSON | 既有依赖 |
| GET | `/api/v1/users/me/usage` | 200 Usage | 既有依赖 |
| GET | `/api/v1/conversations` | 200 {"items": "Conversation[] without messages", "total": "integer"} | 既有依赖 |
| POST | `/api/v1/conversations` | 200 Conversation without messages | 既有依赖 |
| GET | `/api/v1/conversations/{guid}` | 200 Conversation with messages | 既有依赖 |
| PUT | `/api/v1/conversations/{guid}` | 200 Conversation with messages | 既有依赖 |
| DELETE | `/api/v1/conversations/{guid}` | 200 {"message": "string"} | 既有依赖 |
| GET | `/api/v1/conversations/{guid}/export/markdown` | 200 Markdown text | 既有依赖 |
| PUT | `/api/v1/users/me` | 200 UserProfile | 既有依赖 |

接口规范双方按前端docs/conventions/api-contract-standards.md及后端实际Handler/DTO核对；未假定后端具有同名规范文件。JSON直接返回既有DTO，不统一包code/message/data/timestamp；不引入模板中的2xxx错误体系或pageNum分页。鉴权中间件detail错误和auth/platform error envelope需按端点区分。会话列表不分页、最多100；对话skip默认0、limit默认20/最大100，响应items/total；客户端使用非负分页值，但服务端Atoi不显式拒绝负数、非法字符串回退默认；目录data/catalog_stale。创建对话200、删除对话200，与注册201、撤销/注销204不同。**后端确认：A3原则双方确认，新增细节A2 r2双方确认。**

SSE：fetch POST + ReadableStream；单模型message事件中先meta{conversation_guid}，再受白名单投影的ChatCompletionChunk，再[DONE]，最后业务done{tokens,total_tokens_used}。error为失败终态，即使后续出现[DONE]也不能改为成功；[DONE]本身不代表保存完成，EOF缺业务done为incomplete。首帧前错误返回HTTP JSON，503也可能由本地额度/数据库/会话保存等错误映射而来，不能单凭503归因上游；首帧后只能流内error。既有compare兼容保留，不能用本次单模型验收替代。没有ping/event id/补发/续传/自动重连承诺；POST不自动重放；取消或Abort不能证明上游取消或零计费。**后端确认：A4双方确认；具体新增chunk DTO见A2复核。**

版本与变更：文档修订只记录补充和证据，不宣称已升级API或自动版本协商。变更申请包含ID、前后路径/字段/鉴权/SSE差异、受影响SHA、兼容和测试/排期影响；双方同稿明确回复后授权writer保存。破坏性变更须单独提API/契约版本与迁移计划，不能暗改已发布接口。**后端确认：A4/A7双方确认。**

## 4. 技术、安全及数据约束

前端沿用Vue3/JS/Vite6/npm、API层+Pinia+组件职责；不把TypeScript strict、ESLint或Lighthouse虚构为现行门禁。Access/AuthUser只在内存；共享存储仅非敏感epoch/pending/退出标志；Cookie变更Web Locks串行，未知结果停止自动恢复；403不等于注销，写请求/SSE 401零重放。输出清洗、错误脱敏、迟到响应/下载/流回调按身份隔离。后端Go网关只用固定白牌上游，授权由服务端实施。

MySQL8显式迁移，不AutoMigrate、不改写已执行迁移；业务GUID在数据库为BIGINT、对外字符串；内部id和user_id→users.id仅内部关联。审计字段/持久化时间UTC Unix毫秒BIGINT；API公开字段逐DTO，如AuthSession、UserProfile、Conversation/Message为RFC3339Nano，上游模型created不自动认定毫秒。稳定INT枚举入库、API依DTO映射；逻辑删除并校验归属，用户名永久占用规则保留。不读取生产.env、不记录Token/Cookie/连接串、不改schema或清Redis。**后端确认：A3及数据库补充双方确认；前端工程选型由前端确认，后端收到并核对契约影响。**

质量门禁：前端npm test/build与所需浏览器流程、独立质量复核；后端go test/vet/build及受影响race/隔离MySQL8/Redis集成。无fixture则列SKIP，不以退出0代替集成通过。性能“4G首屏<2s”等仅候选目标，指标/设备/网络/样本/统计口径尚未确认，不报达标分数。交付物含精确版本、差异、实际命令和退出码、脱敏证据、未测与风险；两协调者同版本签收。**后端确认：A7门禁原则双方确认，性能具体目标待确认。**

## 5. 排期、里程碑与协同

| 阶段 | 准入/产出 | 当前状态 | 日期与确认 |
| --- | --- | --- | --- |
| M1合同 | 范围、DTO、SSE、安全规则与双方回复 | 历史核心已实施确认，本轮补文档 | 2026-09-02历史启动；本轮2026-09-03补齐，A1–A8 |
| M2本地 | 技术方案、组件职责、自测、规格及独立质量 | 已有本地通过记录，保持原版本范围 | 历史2026-09-03完成；不记为本轮重跑 |
| M3首轮 | 精确运行版本、HTTPS、专用账号、测试预算与清理 | 2026-09-03已执行；正常SSE子项PASS，整体PARTIAL | 已发生事实A8确认 |
| M3剩余 | 可执行矩阵、隔离环境/资源、必要新预算、证据和风险复核 | 待准备与补测；本轮仅方案 | **具体启动/完成日期PENDING**，A5已确认待定 |
| 联合签收 | 核心必要项执行通过、失败关闭或获明确范围决策、双方签名 | 未签收 | 不承诺日期 |

两协调者在活跃协作日首次工作及阶段变化同步：日期、双方revision、契约修订、已验证结果、阻塞/影响、下一步与责任人。固定时刻未约定；不创建自动化或无人值守通知。执行/质量不越过所属协调者跨团队派单；风险按执行者→所属协调者→对口PM→需要资源/产品决定时用户。影响安全/身份/协议的风险在继续相关实施前上报，其他风险在本次阶段同步列明；此“先上报后推进”为本备忘录执行规则，非承诺供应商响应SLA。**后端确认：A5/A6/A7双方确认，日历日期及外部SLA待确认。**

## 6. 待澄清、依赖及跟进责任

| 编号 | 事项 | 状态/后端确认 | 责任人 | 下一动作与关闭条件 |
| --- | --- | --- | --- | --- |
| Q1 | 新增11端点同稿确认 | 已解决；A2 r2双方确认 | 两协调者 | 原10+新增11项同稿已确认，回复已归档 |
| Q2 | 下次联调日期/容量 | 已确认待定（A5） | 两协调者；用户资源决定 | 明确资源/用例/预算后提出时间并双方回复；不凭推测填日期 |
| Q3 | 原object拒绝原因 | 未解决；A8确认现状 | 后端PM | 先看已有证据；出现经授权新证据后解释实际异常形态，不盲目放宽解析 |
| Q4 | SSE取消/error/EOF/用量与身份隔离 | 未完整验收；A1/A8确认 | 前端开发/质量→协调者，后端配合 | 精确用例和期望→隔离验证→必要真实复测→双方复核 |
| Q5 | 历史详情/注册边界/资源ACL剩余矩阵 | 未完整验收；A8确认 | 前端开发/质量→协调者 | 按既有记录补空白，不把未测写成缺陷 |
| Q6 | 98项当前候选集成SKIP | 未补跑；后端确认限制 | 后端PM委派执行/质量 | 可处置隔离MySQL8/Redis中补跑、记录版本与实际结果 |
| Q7 | 模型时间/完整schema、性能、P1范围 | 未冻结；A1/A3确认边界 | 两协调者；必要时用户/供应商 | 独立变更/澄清，不强行套毫秒或性能阈值 |
| Q8 | 新生成预算 | 已耗尽4/4；A8确认 | 用户决定，协调者维护台账 | 先列必要调用及上限，再申请；本轮零调用 |
| Q9 | 最终M3签收 | 未签收；A7/A8确认 | 两协调者与独立质量 | 核心证据与风险齐全后分别书面确认 |

## 7. 内部委派与下一步

已向front_end_developer派发FE-PREP-20260903-02：只读准备技术方案初稿、自测矩阵、复用API/store/组件分工和门禁；不编写业务代码、不安装依赖、不部署或新增模型请求。派发时以已确认10端点+A1/A3–A8为依据；新增依赖现已获得A2 r2确认。后端沟通仍经前端协调者。开发者已明确接受并返回方案，归档到[技术方案与自测计划](2026-09-03-frontend-preparation.md)。

前端下一步清单：

- [x] 两协调者复核r2新增依赖DTO和完整纪要，记录具体确认范围。
- [x] 开发者明确接受准备指令，返回技术方案和自测矩阵，已归档；独立阅读检查另见文末。
- [ ] 后端准备98项SKIP补跑所需隔离资源说明；前端准备不消耗生成额度的剩余用例。
- [ ] 汇总确需真实生成的用例、每次模型/token上限、清理步骤，交用户决定新增预算及时间。
- [ ] 受控执行剩余验证后，双方按实际证据联合签收；本轮不执行这些未来动作。

当前原四步定位：正式对接已有本轮可追溯请求/回复；双向核对A1–A8及21接口r2已确认，日期等保留待定；备忘录和契约交付已形成；内部任务准备已完成并归档。不能宣称全部原始待定事项关闭。

## 8. 最终对齐状态

后端project_manager已对r2的A2及完整纪要回复CONFIRMED，前端明确接受；确认摘要见[回复记录](2026-09-03-alignment-confirmations.md)。本次日期以归档时间记录，不倒签原始历史。

| 原步骤 | 本轮交付 | 严格状态 |
| --- | --- | --- |
| 1 正式对接 | 正式请求、后端五类资料和A1–A8书面回复已归档 | 完成当前补齐动作 |
| 2 双向核对 | 范围、21接口、安全数据及协同门禁已双方确认 | 已确认条款完成；具体日期/资源/P1语义等仍待定 |
| 3 对齐结果 | 本备忘录、更新JSON、待办和风险责任齐全 | 文档交付完成，待定项显式保留 |
| 4 内部委派 | 已发准备指令，开发者接受并输出技术方案与自测计划 | 准备任务完成；未来测试未执行 |

本轮不追加代码、部署、真实调用或自动化，不改变web-009 in_progress/go-004 blocked，不签整体M3。后续首先明确剩余必要用例和隔离资源，涉及真实生成时再落实新增预算与具体时间。

## 9. 文档验证与独立阅读检查

独立读者alignment_document_reader只读检查备忘录、确认记录、技术方案和JSON，结论PASS：能明确区分原四步交付、后端本轮确认、首期与依赖范围、日期/预算/责任人、文档与运行版本、SKIP和实际结果、下一步门禁；未发现阻断性或实质矛盾。其提示的“文末缺少阅读检查记录”已由本节补齐。该审查不是业务测试或M3联合签收。

根任务离线验证通过：21端点唯一且均关联r2双方确认，原10端点的method/path/auth/request/response不变；可空DTO修订、4/4预算、文档与API版本分离、feature状态不变、三份文档链接/UTF-8有效；双方输入哈希与记录的Git HEAD逐一匹配，git diff --check通过。没有运行会安装依赖或构建的init.sh，采用AGENTS.md中Agent/规范文档任务的例外；未据此报告新的业务测试通过。
