# 模型数据分析图表比例修复设计

## 目标

修复计费页“模型数据分析”中的六个图表，使其使用与名称一致、可筛选且可审计的统计数据：消耗分布、调用趋势、调用次数分布、调用次数排行、用户消耗排行和用户消耗趋势。图表中的百分比必须以当前筛选结果的完整总量为分母；Top N 场景必须将未展示项聚合为“其他”，避免把 Top N 误表示为 100%。

本设计不新增渠道、账务、租户、配额或原始请求日志能力；成本继续使用现有 `ANALYTICS_TOKEN_PRICE_PER_1K` 统一单价计算。

## 已确认根因

现有前端在 `ModelAnalyticsPanel.vue` 为六个 tab 构建了不同 ECharts option，但后端 `AnalyticsChart` 对所有 view 都返回空 `time_labels`、空 `series`，仅返回按模型 Token 排序的 `ranking`。这导致：时间序列图无数据；按调用数的图却按 Token 排序；两项用户图实际显示模型数据；`models`、`user_id`、自定义时间和 `yesterday` 也未被解析或应用。图表容器高度与饼图半径只影响显示面积，不能修复统计比例。

## 设计边界与数据约定

### 统一筛选

后端只接受并实际应用以下筛选项：

- `range`: `1h`、`6h`、`24h`、`yesterday`、`7d`；`yesterday` 是完整的前一 UTC 日。
- `start_at` 与 `end_at`: 成对 RFC3339 时间；两者优先于 `range`，开始必须早于结束，区间最长 90 天。
- `granularity`: `1h`、`2h`、`4h`、`1d`；无效值返回 400，不静默回退。
- `models`: 逗号分隔的逻辑模型 ID；为空表示全部模型。
- `top_n`: 5–50 的整数；无效值返回 400。
- `user_id`: 仅用于 `user_consumption_trend`，必须为正整数。

所有分桶和标签使用 UTC；后端在 Go 中生成连续桶标签并将每条 `UsageRecord` 归入对应桶。这一方式兼容现有 SQLite 测试数据库与生产 MySQL，避免数据库方言时间格式差异。

### 图表响应契约

所有 `GET /api/v1/billing/analytics/charts/:view` 成功响应包含 `view`、`metric`、`granularity`、`start_at`、`end_at`、`time_labels`、`series`、`ranking`。

`series` 元素为 `{ name, data }`；`data` 与 `time_labels` 一一对应，数据点为 `{ tokens, calls, cost }`。缺失桶必须以零值补齐。

`ranking` 元素为 `{ key, label, tokens, calls, cost, ratio }`，`ratio` 是 0–1 的未四舍五入计算值，分母始终是当前筛选后的所有合格记录。若存在 Top N 截断，追加 `{ key: "other", label: "其他", ... }`，其值为其余项目的聚合值；没有其余项目时不追加。用户标签优先采用非空昵称，否则为 `用户 #<id>`，不返回电话号码。

### 六种视图

| view | 主维度 | 排序/指标 | 前端呈现 |
| --- | --- | --- | --- |
| `consumption_distribution` | 时间桶 × 模型 | `cost`（同时返回 tokens） | 模型堆叠柱图 |
| `call_trend` | 时间桶 | 所有筛选后模型调用次数 | 单折线 |
| `call_distribution` | 模型 | `calls DESC`，Top N + 其他 | 环形图，百分比以完整调用量为分母 |
| `call_ranking` | 模型 | `calls DESC`，Top N + 其他 | 横向柱图 |
| `user_consumption_ranking` | 用户 | `cost DESC`，Top N + 其他 | 横向柱图 |
| `user_consumption_trend` | 指定用户的时间桶 | `cost`，可叠加模型筛选 | 单折线 |

未知 `view` 返回结构化 400 错误；空结果仍返回上述完整结构和空数组，使前端可明确渲染空态。

## 前端设计

前端保留既有筛选控件和 API adapter。将图表 option 构建函数抽离为可在 Node 原生测试运行的纯模块；组件只负责请求、状态、ECharts 实例和布局。

- 饼图使用后端的完整 `ranking`（包括“其他”），tooltip 同时显示数值与百分比；不得重新以 Top N 作为百分比总量。
- 排行图使用与其视图匹配的 `calls` 或 `cost`；长标签截断，完整内容在 tooltip 显示。
- 各时间序列使用返回的全量 `time_labels` 和零值补齐后的 `series`。
- 容器采用既有响应式高度；饼图根据容器宽度设置半径和中心，给右侧图例保留空间；使用 `ResizeObserver` 监听容器，而不是只监听 window resize。
- 没有数据时展示明确空态，不渲染误导性的 0% 饼图。

## 权限、安全与兼容性

- 所有统计接口继续使用 `RequireUser` 和 `RequireAnalyticsAdmin`；前端仅依赖后端 `access` 结果显示 tab，不能承担授权判断。
- 查询值使用 GORM 参数绑定；模型集合、用户 ID、时间范围和分页上限在 handler 验证后再传入 service。
- 不返回用户手机号、JWT、Gateway Token、上游密钥或原始对话内容；导出使用同一筛选和权限逻辑。
- 不改变现有 `/v1/*` 网关协议、API Key 或普通计费页面行为。

## 验收标准

1. 固定测试数据覆盖 2 名用户、3 个模型和至少 2 个时间桶；六种 view 的总量、排序、标签、时间点和筛选结果均正确。
2. 调用次数分布的 `ratio` 之和为 1（允许浮点误差），Top N 截断后仍由“其他”补齐完整分母。
3. 用户排行按用户成本而非模型 Token 返回；用户趋势只返回选择用户的数据。
4. `yesterday`、自定义范围、模型筛选、粒度、Top N 和用户筛选均被验证；无效参数和未知 view 返回 400。
5. 桌面与窄屏下切换六个 tab，无裁切、重叠或空白误导；筛选后的图、PNG 与 CSV 导出一致。
6. `go test ./...`、`npm test`、`npm run build` 和 `git diff --check` 均通过；安全审查无高危问题。

## 明确延期

按真实上游计价的多币种成本、渠道级统计、请求级审计详情、项目/租户维度、预算/限流及账务对账不在本次范围内。
