# Porsche-Web Agent 编排规范

## 单一 Controller

- 前端执行链唯一 Controller 是 `front_end_project_coordinator`；外层会话只提供用户目标和跨仓库协调，不在其内部再启动第二套 Controller。
- `front_end_project_coordinator` 保持只读，只汇总独立角色证据，不代替实现、规格或质量角色。

## SDD 角色映射与顺序

完整流程严格按以下顺序执行：

1. `front_end_project_coordinator`：执行只读 Explorer，输出需求、影响面、契约差异、可行性和交接包。
2. `front_end_developer`：在授权 worktree 实现、自测、自审并返回明确状态。
3. `front_end_spec_compliance_reviewer`：针对确定的 review snapshot、最终实现和 `interface-contract.json` 逐项核对规格；失败经协调者退回原 Developer，修复后重新生成 snapshot 并审查。
4. `front_end_quality_gate`：仅在收到绑定同一 review snapshot ID、最终 revision 和契约版本/状态的可追溯 `SPEC_PASS` 后，审查该 snapshot 的最终差异和验证证据。
5. `front_end_project_coordinator`：仅汇总独立证据，不代替 Reviewer 或 Quality Gate。

任何被审范围的新 diff 或 review snapshot 组成内容变化，包括实现、测试、配置、文档或契约变更，都会使 Spec Review 及所有下游结论失效。Quality Gate 发现需要修改的问题时，必须由 `front_end_project_coordinator` 退回原 `front_end_developer`；原 Developer 产生新差异后，先生成新 snapshot 并执行 fresh Spec Review，通过后再重新执行 final Quality Gate，不得从修复直达 Quality Gate。

## 任务包与状态

每次委派必须给出完整任务正文、验收标准与非目标；并分列仓库、worktree、branch、base revision、current revision，以及现有修改、必读 `AGENTS.md`/领域文档/`docs/agents/orchestration.md`/任务规范、允许写入路径、禁止操作、提交授权、已核验前置证据、明确验证命令、预期结果和证据格式。审查委派还必须附 review snapshot ID 及其规范化清单。执行者返回 `DONE`、`DONE_WITH_CONCERNS`、`NEEDS_CONTEXT` 或 `BLOCKED`；不得用未经核验的完成声明推进门禁。

## Review snapshot ID

唯一规范生成器是 [review_snapshot.py](review_snapshot.py)，使用 Python 3.9 标准库。Coordinator、Spec Reviewer 和 Quality Gate 必须调用该 helper，不得手工生成、改写或用自行实现的算法替代其输出；helper 不可调用时返回阻塞状态。在仓库根目录运行。授权 writer 负责把 scope、baseline 和 snapshot 持久化到任务约定证据路径；只读角色不得被要求写文件，只能使用 `--output -` 将 canonical JSON 输出到 stdout，或运行全程无写的 `verify`：

```sh
python3 docs/agents/review_snapshot.py baseline --scope <scope.json> --contract interface-contract.json --output -
python3 docs/agents/review_snapshot.py snapshot --scope <scope.json> --baseline <private-task-dir>/baseline.json --contract interface-contract.json --output -
python3 docs/agents/review_snapshot.py verify --scope <scope.json> --baseline <private-task-dir>/baseline.json --snapshot <private-task-dir>/snapshot.json --contract interface-contract.json
```

Scope JSON 可事先准备，只包含明确的仓库相对 `paths` 和以 `/` 结尾的 `prefixes`；helper 负责校验和排序，并拒绝重复、重叠或其他歧义。Scope、baseline、snapshot 与 contract 的 JSON 都经过同一严格 loader：任意层重复键及 `NaN`、`Infinity`、`-Infinity` 均以 exit 2 拒绝。Contract 仍是受 confinement 保护的仓内 `interface-contract.json`；baseline/snapshot 必须保存到实际 Git worktree 外的私有任务目录。Helper 的 `baseline`/`snapshot --output` 只接受精确的 `-` 并输出 canonical JSON；任何路径值（包括绝对、相对、existing regular/symlink/hardlink 或并发目标）都以 exit 2 拒绝且不写文件。授权 writer 必须把原始 stdout 字节保存到外置私有目录中的全新 exclusive 文件；目标不得已存在，不得为或链接到 regular/symlink/hardlink，且不得覆盖或链接任何既有文件。Snapshot/verify 继续以 resolved path 检查 baseline/snapshot 输入，拒绝 worktree 内位置以及相对路径、父目录和 symlink 绕过。

Exact path 始终进入 manifest，不存在时为 absent；prefix 展开所有命中范围的 cached tracked path（包括设置 `assume-unchanged` 或 `skip-worktree` 的路径），并合并命中范围的 dirty/untracked Git 候选。Scope 内 exact/prefix 还从不应用 exclude 的全量 untracked 集合补入候选，因此 `.gitignore`、`.git/info/exclude` 与 global excludes 都不能隐藏待审文件，规则切换也不能令既有 scope 内文件消失。Scope 外持续 ignored 的 untracked 内容不进入 baseline且内容变化不影响 snapshot；若其 ignored/visible 状态在 baseline 后切换，visible-untracked baseline 比较会将新增或消失视为 drift 并阻塞。`baseline` 冻结当时 scope 外全部 cached tracked path（同样包括 index flags 路径），再 union 所有 scope 外 worktree/cached diff 与 visible untracked 候选的工作树及 index 指纹；`snapshot` 以同一规则重算并比较。Tracked、staged、unstaged、deleted 及 worktree/cached rename/copy 两端候选均以 baseline HEAD 为 diff base；每个路径同时按工作树实际 `lstat`/读取生成指纹，并用 `git ls-files --stage -z` 绑定 index mode/blob OID/stage/absent。任何非 0 stage 的未合并 index 或 mode `160000` gitlink 均不支持并阻塞。Manifest 中的 HEAD 仍记录当前 HEAD。任一 scope 外 tracked 或候选的新增、删除、内容、mode、类型、index OID/stage 漂移均阻塞；这包括并行修改，必须由 Coordinator 核验并生成新 baseline 后才能继续。Out-of-scope 指纹只保存在 baseline，不进入 snapshot ID。

Helper 使用 `json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"` 的 UTF-8 结果作为 canonical manifest，schema 为通用 `review-*-v2`；branded schema 与旧 v1 evidence 必须拒绝。Manifest 字段覆盖确切 repository/worktree/branch/HEAD、契约内容 SHA-256/version/status、规范化 scope，以及按 UTF-8 路径字节排序的工作树 type/mode/内容 SHA-256 和 index 指纹。Regular mode 是 `100644` 或 `100755`，symlink 是 `120000`，absent 为 `null`；任一执行位或 index 变化都会改变 ID。Helper 对 relative path 的所有中间组件逐级 `lstat`，遇 symlink 或最终位置越出 worktree 即阻塞；最终组件本身可为 symlink，仅哈希其 UTF-8 链接目标字节而不跟随。Snapshot ID 是 manifest 完整字节的小写 SHA-256。`baseline`/`snapshot --output -` 只在 stdout 输出 canonical JSON；`verify` 成功时在 stdout 打印 ID。输出 JSON 保存非自引用的 `id`、`manifest` 及 baseline 内容哈希。不得只用 `git diff`、commit 或 HEAD 表示 snapshot。

该 helper 是可复制到其他仓库使用的通用实现：`--contract` 可省略，省略时 manifest 的 `contract` 为 `null`；提供时必须是受 confinement 保护的仓库相对有效 JSON，且 `version`、`status` 均为非空字符串。Porsche-Web 的前端流程不得省略契约门禁，`baseline`、`snapshot` 和 `verify` 均必须显式传入 `--contract interface-contract.json`。

Coordinator 在实施前运行 `baseline --output -`，并在每次 Spec Review 及 Quality Gate 前运行 `snapshot --output -`；授权 writer 按上述全新 exclusive 文件规则原样持久化 stdout 到 worktree 外私有任务目录并记录哈希。Spec Reviewer 和 Quality Gate 各自用相同 scope/外置 baseline/外置 snapshot 运行无写 `verify`，不仅信任上游输出，也不得把证据复制回仓库。Spec verdict 必须记录 helper 输出 ID、final revision 和契约内容哈希/版本/状态；Quality Gate 只接受绑定同一 helper ID 的可追溯 `SPEC_PASS`。Manifest 任一组成项或当前文件内容变化会产生新 ID，旧 Spec 及下游结论立即失效。

## 风险分级

- 完整流程：最高优先级；认证、RBAC、路由、状态管理、API/JSON/SSE、接口联调、依赖或构建配置、安全、浏览器/E2E、性能、跨仓库或多模块改动命中任一项即使用完整流程。
- 标准流程：仅适用于未命中任何完整流程触发项的单仓库、中等风险、边界明确的行为修改；Explorer 可由 Controller 完成，但保留独立 Implementer、Spec Review 和 Quality/Test Gate。
- 精简流程：仅适用于未命中完整流程或标准流程，且无行为、契约、权限、依赖、构建或生产影响的文案、注释、无行为格式调整和纯文档小改；由授权 writer 修改并运行 `git diff --check` 与适用静态检查。Controller 必须根据影响和不确定性决定是否增加一次独立只读审阅，并记录选择理由；无法确定时必须升档。

若无法确定风险档位，选择更高档流程。

## 故障降级

Role TOML 存在不证明角色可调用。先核对实际工具、角色、模型、权限和工作目录。具名角色不可用但允许通用子 Agent 时，完整注入角色指令和任务包；无法保证只读权限时不得用宽权限 Agent 冒充 Reviewer。子 Agent 不可用时输出 Explorer → Implementer → Spec Review → Quality/Test 的人工交接包，未运行、跳过或仅由实现者自证的步骤不得标记通过。
