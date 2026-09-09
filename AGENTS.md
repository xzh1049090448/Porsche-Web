# AGENTS.md

这个仓库面向长时运行的 coding agent 工作流。目标不是尽可能快地产出代码，而是让每一轮会话结束后，下一个会话仍然能无猜测地继续工作。

## 开工流程

写代码前先做这些事：

1. 用 `pwd` 确认当前目录。
2. 读取 `progress.md`，了解最新已验证状态和下一步。
3. 读取 `feature_list.json`，选择优先级最高的未完成功能。
4. 用 `git log --oneline -5` 看最近提交。
5. 运行 `./init.sh`。
6. 在开始新功能前，先跑必需的 smoke test 或端到端验证。

如果基础验证一开始就失败，先修基础状态，不要在坏的起点上继续叠新功能。

## 工作规则

- 一次只做一个功能。
- 不要因为“代码已经写了”就把功能标记为完成。
- 除非为了消除当前 blocker 的窄范围修复，否则不要扩大到其他功能。
- 实现过程中不要悄悄改弱验证规则。
- 优先依赖仓库里的持久化文件，而不是聊天记录。
- 不再区分子项目，仓库为单一前端项目。

## 必需文件

- `feature_list.json`：功能状态的唯一事实来源
- `progress.md`：会话进度和当前已验证状态
- `init.sh`：统一的启动与验证入口
- `session-handoff.md`：较长会话可选的交接摘要

## 完成定义

一个功能只有在以下条件都满足时才算完成：

- 目标行为已经实现
- 要求的验证真的跑过
- 证据记录在 `feature_list.json` 或 `progress.md`
- 仓库仍然能按标准启动路径重新开始工作

## 收尾

结束会话前：

1. 更新 `progress.md`
2. 更新 `feature_list.json`
3. 记录仍未解决的风险或 blocker
4. 在工作处于安全状态后，用清晰的提交信息提交
5. 保证下一轮会话可以直接运行 `./init.sh`

## 前端 Agent 体系（2026-09-02 增补）

保留以上业务开发流程。本次仅新增 Agent/规范文档无需运行会安装依赖和生产构建的 init.sh；后续代码任务仍遵循原验证流程。只读角色不能自行执行会写入文件的初始化、测试或进度更新，须由授权 writer 执行。

- 协调层：front_end_project_coordinator，与后端 project_manager 唯一对口；Explorer 为协调者的只读探索阶段。
- 执行层：front_end_developer，接受协调者委派（用户直接指令优先）。
- 规格层：front_end_spec_compliance_reviewer，独立核对完整任务和版本化接口契约，不修改实现。
- 质量层：front_end_quality_gate，仅在规格通过后独立进行安全、质量和验收核验。
- 配置维护源：.agents 下四个角色 TOML；Codex 发现副本位于 .codex/agents，同名文件须逐字节一致。
- 编排规则：执行或审查任务必须读取 docs/agents/orchestration.md，按风险选择流程并保持单一 Controller。
- 必读：docs/agents/domain.md；接口任务另读 docs/conventions/frontend-standards.md、docs/conventions/api-contract-standards.md、docs/conventions/database-standards.md。
- 接口、联调计划、范围变更及签收须双方协调者针对明确版本书面确认。执行/规格/质量角色不直接跨团队收发任务，所有修复经协调层流转。
- 交付附最终代码和实际验证证据；草案、模板、Mock、跳过测试均不是联合验收通过。
- 启动与权限限制见 [启动说明](docs/agents/README.md)，流转记录见 [协同模板](docs/agents/collaboration-templates.md)。
