# 前端 Agent 启动与维护

## 配置与权限

维护源在 .agents，Codex 发现副本在 .codex/agents；修改时同步同名文件，保持逐字节一致。四个角色都使用 gpt-5.6-luna；协调者、规格审查者和质量门禁为 high/read-only，开发者为 medium/workspace-write。字段集合和多行 developer_instructions 风格与后端 project_manager 一致。

官方项目级目录是 [.codex/agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)，不是 .agents。本次仅新增或修改项目级 Agent 角色配置与协作文档，不修改全局配置、业务运行配置、业务代码或依赖。文件存在和语法通过不证明本会话已经加载角色，模型/权限/角色可用性以当前宿主为准。

## 激活

1. 在 Codex 中打开 Porsche-Web 仓库根目录并开始任务，使其读取项目配置；每次委派前核对当前环境的实际工具、四个具名角色、模型、权限和工作目录是否可用。
2. 使用下面的首次对齐指令。若支持具名调度，请求启动 front_end_project_coordinator，并核对实际返回的角色、模型和只读权限。
3. 后端在 Porsche 根目录由 project_manager 执行对应核对。跨仓库不共享加载假设；已有后端任务可通过可用任务通信机制交接，不能仅凭目录猜测任务 ID 或声称已建立连接。
4. 若当前环境只提供通用子 Agent，则将该 TOML 的完整 developer_instructions 作为任务指令，显式设置支持的模型/推理参数；必须确认实际只读沙箱。不得用实际沙箱更宽的通用 Agent 冒充只读 Spec Reviewer 或 Quality Gate；无法保证权限或禁止调度时，输出人工交接包，不启动宽权限替代角色。
5. 主 Agent 加载文件内容不等于自动改变自身模型或沙箱。协作受用户授权和当前工具能力约束。

## 首次跨团队需求对齐指令

```text
请在 Porsche-Web 工作树中启动 front_end_project_coordinator，使用其项目级配置并确认实际角色、gpt-5.6-luna/high 和 read-only 权限；不可调用时说明限制。
读取 AGENTS.md、docs/agents/domain.md、README.md、progress.md、feature_list.json、interface-contract.json 及最近提交。先输出 Explorer 需求拆解与可行性结论，不修改业务代码。
通过可用且获授权的任务交接机制，与 Porsche 工作树中的 project_manager 对齐双方 revision、接口契约、联调计划及验收标准。只进行本次需求对齐，不启动实施或部署。
优先核对 AUTH-ALIGN-001：前端旧手机号认证/localStorage 与后端用户名认证/可撤销会话的差异。按 docs/agents/collaboration-templates.md 输出契约差异、待决策项、责任人、验收用例和双方确认记录。没有收到对方确认时保持 draft，不代签。
若没有已知且可用的后端任务，输出可供用户转交的完整对齐请求；不要自行创建新任务或向外部聊天工具发消息。
```

## 后端接收指令

```text
请由 Porsche 的 project_manager 只读核对前端协调者提供的需求对齐包。确认后端实际工作树和 revision，按本仓库规范核对用户名登录、会话、GUID、JSON、SSE、错误与分页契约。逐项回复同意、差异或缺少证据项，引用具体实现与版本，不代替前端签收，不开始实现/部署。将结果交回 front_end_project_coordinator；工具不可用则提供人工转交包。
```

## 工作闭环

协调者 Explorer → 契约/计划双向确认 → Developer → Spec Reviewer → 最终 Quality Gate → 问题经协调者返给原 Developer 并重新规格/质量审查 → 双方签收。质量门禁合并后端 Security/Test 的职责，因只读而由授权 writer 执行会写入产物的测试和保存报告。

## SDD 映射与风险档

[Agent 编排规范](orchestration.md) 映射 Controller/Explorer、Implementer、Spec Reviewer、Quality/Test Gate 和 Final Gate，并定义完整、标准、精简三档互斥流程。协调者须在委派前记录风险档位及适用事实；无法确定时选更高档。认证、RBAC、路由、状态管理、API/JSON/SSE、接口联调、依赖/构建、安全、浏览器/E2E、性能、跨仓库或多模块任一项必须使用完整流程，不得降级为精简流程。

协同模板见 [collaboration-templates.md](collaboration-templates.md)，数据与接口的已知差异见 [domain.md](domain.md)。初始契约为空且为 draft，不代表接口已对齐；日常同步不会自动创建计划任务。
