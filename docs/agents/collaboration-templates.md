# 协同跟踪模板

模板不构成真实任务、合同或签收。使用时将方括号替换为事实；只读角色在回复中提供记录，由授权 writer 保存至任务约定路径。双方确认必须有可追溯的任务消息/文档引用与版本；不得代签。跨团队入口只有 front_end_project_coordinator ↔ project_manager。

## 任务委派

- 任务 ID / 完整任务正文 / 验收标准 / 非目标：[填写]
- 发起协调者 / 接收角色：[填写]
- Repository：[填写确切路径]
- Worktree：[填写确切路径]
- Branch：[填写]
- Base revision：[填写]
- Current revision：[填写]
- 现有修改（含 dirty / untracked）：[填写]
- Scope JSON 路径 / 内容 SHA-256 / `paths` / `prefixes`：[填写]
- Baseline JSON 引用 / 内容 SHA-256：[填写]
- 必读：AGENTS.md、docs/agents/domain.md、docs/agents/orchestration.md、docs/conventions/frontend-standards.md；接口任务加 api-contract-standards.md、database-standards.md（后二者位于 docs/conventions）。
- 适用约束复述 / 允许写入路径 / 禁止操作 / 提交授权：[填写]
- 契约内容 SHA-256 / 版本/状态 / 双方确认引用 / 已核验前置证据：[填写]
- Review snapshot ID / 规范化清单引用（审查任务必填）：[填写]
- 授权 writer / canonical stdout 持久化路径 / 内容 SHA-256：[填写]
- Helper 命令（Porsche-Web 必须显式传 `--contract interface-contract.json`；只读角色仅用 `baseline --output -` / `snapshot --output -` / `verify`）/ stdout ID 或 canonical JSON / 退出码：[填写]
- 明确验证命令 / 预期结果 / 证据格式：[填写]
- 正常、异常、边界、权限用例 / 性能阈值：[填写]
- 返回协调者的状态（`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`）、证据 / 阻塞 / 下一步：[填写]

Review snapshot 的唯一规范生成器是 [review_snapshot.py](review_snapshot.py)。按 [Agent 编排规范](orchestration.md) 记录 scope 与 baseline，调用 helper 生成 snapshot；不得手工解释或改写算法。只读角色只使用 `--output -` 或 `verify`，由授权 writer 持久化 canonical stdout。Helper 是可复制使用的通用实现，契约参数本身可选；但 Porsche-Web 的 `baseline`、`snapshot`、`verify` 必须显式传 `--contract interface-contract.json`。Helper 覆盖 dirty/untracked、exact absent、mode/`chmod`、中间 symlink confinement、全部 cached tracked path（含 `assume-unchanged`/`skip-worktree`）、Git 候选与 out-of-scope 漂移阻塞。Scope 外全部 tracked 文件也在 baseline 冻结；外部并行修改必须安全阻塞，并交由 Coordinator 核验、重建 baseline。任一 manifest 组成内容变化使旧 snapshot 及其审查结论失效。

## 契约与范围变更

- 变更 ID / 原版本 / 提议版本 / 原因：[填写]
- 方法、路径、字段、错误码、SSE、鉴权的前后差异：[填写]
- 影响页面、后端、兼容性、测试及排期：[填写]
- 前端协调者确认 / 后端协调者确认 / 时间 / 引用：[未确认]
- 授权 writer / 落盘版本 / 实施条件：[填写]

未经双方确认不实施；新变更使受影响的旧审查与测试证据失效。

## 每日同步（活跃任务内）

| 日期 | 任务与版本 | 已验证进展 | 阻塞与影响 | 下一步和负责人 | 双方确认引用 |
| --- | --- | --- | --- | --- | --- |
| [填写] | [填写] | [填写] | [填写] | [填写] | [未确认] |

不隐式建立定时任务、后台监控或发送外部消息。

## 联调计划与记录

- 双方 revision / 契约版本 / 测试环境与隔离证明：[填写]
- 账号与数据准备（不填凭据）/ 时间窗口 / 双方联系人：[填写]
- 浏览器、设备、网络与性能口径：[填写]

| 用例 | 正常/异常/边界/权限 | 期望 | 实际 | 命令或浏览器步骤 | 脱敏证据 | PASS/FAIL/SKIPPED |
| --- | --- | --- | --- | --- | --- | --- |
| [填写] | [填写] | [填写] | [未运行] | [填写] | [填写] | SKIPPED |

分别记录 Mock、真实后端、浏览器与真实上游验证。零执行、跳过、只有 health 正常不能签收。

## Quality Gate 报告与返工

- 前置 `SPEC_PASS` 引用 / final revision / `interface-contract.json` content SHA-256 / version/status / review snapshot ID：[填写]
- Scope JSON 路径/哈希 / baseline 引用/哈希 / snapshot 引用/哈希 / Quality Gate 实际无写 `verify` 命令、stdout ID 与退出码：[填写]
- Snapshot 规范化清单引用 / 当前内容重算 ID 结果 / 工作差异摘要 / 审查范围：[填写]
- 发现 ID / 严重度 / 文件位置 / 复现 / 影响 / 修复建议：[填写]
- 检查命令、退出码、实际输出 / 跳过原因：[填写]
- 返工链：Coordinator 派发修复 → 原 Developer 提供新差异 → 生成新 review snapshot ID → fresh Spec Review → final Quality Gate 复核：[填写每步状态与证据]
- 最终判断：PASS / FAIL / BLOCKED；未关闭问题清单：[填写]

## 联合签收

- 交付 ID / 双方 revision / 契约版本：[填写]
- 需求、测试与最终审查证据引用：[填写]
- 核心用例已执行数/总数、通过数、跳过数：[填写]
- 高危问题、其他未闭环问题、性能结果：[填写]
- 前端协调者结论/时间/来源：[未签收]
- 后端协调者结论/时间/来源：[未签收]
- 总结论：未签收；只有完整证据、问题闭环且双方明确确认后改为通过。

签收不自动授权生产构建、部署、灰度、迁移或回滚；上线授权另列目标、版本、备份、环境与回滚方案。
