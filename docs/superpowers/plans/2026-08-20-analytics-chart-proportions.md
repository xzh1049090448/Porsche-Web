# 模型数据分析图表比例修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让六个模型分析图表使用正确、完整且可筛选的统计数据，并在任何视口下正确呈现比例与布局。

**Architecture:** 后端将经校验的筛选条件转换为统一的 UTC 时间桶，并从 `usage_records` 聚合模型和用户指标，返回稳定的时间序列与排行契约。前端把 ECharts option 生成拆为纯函数，以同一响应契约渲染图表、空态、百分比和响应式尺寸。

**Tech Stack:** Go 1.22、Gin、GORM（MySQL/SQLite）、Vue 3、ECharts 5、Element Plus、Node built-in test runner、Vite。

---

## File structure

- Modify `/Users/xuzhihao/code/Porsche/.worktrees/analytics-chart-proportions/internal/handler/analytics.go`: 严格解析并验证查询筛选与 view。
- Modify `/Users/xuzhihao/code/Porsche/.worktrees/analytics-chart-proportions/internal/service/analytics.go`: 定义响应类型，按 view 聚合时间序列、模型和用户排行。
- Create `/Users/xuzhihao/code/Porsche/.worktrees/analytics-chart-proportions/internal/service/analytics_test.go`: SQLite 固定夹具下的 service 契约测试。
- Modify `/Users/xuzhihao/code/Porsche/.worktrees/analytics-chart-proportions/internal/router/router_test.go`: 认证路由、非法查询与 JSON 契约回归测试。
- Create `llm-platform/src/components/analytics/chart-options.js`: 不依赖 Vue/ECharts 实例的 option 与空态数据转换。
- Create `llm-platform/src/components/analytics/chart-options.test.js`: Node 原生 option/比例测试。
- Modify `llm-platform/src/components/analytics/ModelAnalyticsPanel.vue`: 使用纯 option 模块，空态和 `ResizeObserver` 响应式渲染。
- Modify `llm-platform/src/api/modelAnalytics.js`: 仅在必要时显式传递已有字段，不改变认证方式。
- Modify `Porsche-Web/feature_list.json` 与 `Porsche-Web/progress.md`: 记录真实验证证据。

### Task 1: 为后端筛选与图表契约建立失败测试

**Files:** Create `internal/service/analytics_test.go`; modify `internal/router/router_test.go`.

- [ ] **Step 1: 写 SQLite 夹具与消费分布的失败测试**

在 `analytics_test.go` 创建两个用户、三条模型名和四条跨两个 UTC 小时桶的 `models.UsageRecord`。用 `AnalyticsChart(..., "consumption_distribution", AnalyticsFilters{StartAt: ..., EndAt: ..., Granularity: "1h", Metric: "cost", TopN: 2})` 断言：两个连续标签、每个模型序列与标签等长、缺失桶为 0、成本为 `tokens * price / 1000`。

- [ ] **Step 2: 写调用数与用户维度的失败测试**

增加 `call_distribution`、`call_ranking`、`user_consumption_ranking` 和 `user_consumption_trend` 断言：调用视图按 `calls DESC` 而非 Token 排序；Top 2 后有 `other`；所有 `ratio` 相加为 1；用户排行 key 为用户 ID、label 为昵称或 `用户 #ID`；用户趋势只含筛选 `UserID` 的记录。

- [ ] **Step 3: 写 handler 参数失败测试**

在 `router_test.go` 创建 analytics 管理员 JWT，请求未知 view、`granularity=15m`、只有 `start_at`、结束早于开始、超过 90 天、`top_n=2` 和 `user_id=0`，分别断言 `400` 与不含敏感字段的 JSON error。请求 `range=yesterday` 与 `models=qwen-turbo`，断言 `200` 和结果被筛选。

- [ ] **Step 4: 验证 Red**

运行：

```bash
cd /Users/xuzhihao/code/Porsche/.worktrees/analytics-chart-proportions && go test ./internal/service ./internal/router
```

预期：失败，原因是当前 `AnalyticsChart` 对所有 view 返回空 `series`，且 parser 忽略大部分参数。

- [ ] **Step 5: 提交测试基线**

```bash
git add internal/service/analytics_test.go internal/router/router_test.go
git commit -m "test(analytics): define chart aggregation contract"
```

### Task 2: 实现严格的筛选解析与稳定响应类型

**Files:** Modify `internal/handler/analytics.go`; modify `internal/service/analytics.go`.

- [ ] **Step 1: 实现 service 输入/输出结构**

在 `AnalyticsFilters` 添加 `Models []string` 与 `UserID *int`。在同文件定义：

```go
type AnalyticsPoint struct { Tokens int64 `json:"tokens"`; Calls int64 `json:"calls"`; Cost float64 `json:"cost"` }
type AnalyticsSeries struct { Name string `json:"name"`; Data []AnalyticsPoint `json:"data"` }
type AnalyticsRanking struct { Key string `json:"key"`; Label string `json:"label"`; Tokens int64 `json:"tokens"`; Calls int64 `json:"calls"`; Cost float64 `json:"cost"`; Ratio float64 `json:"ratio"` }
type AnalyticsChartResponse struct { View string `json:"view"`; Metric string `json:"metric"`; Granularity string `json:"granularity"`; StartAt string `json:"start_at"`; EndAt string `json:"end_at"`; TimeLabels []string `json:"time_labels"`; Series []AnalyticsSeries `json:"series"`; Ranking []AnalyticsRanking `json:"ranking"` }
```

- [ ] **Step 2: 令 handler 明确验证每一个输入**

把 `parseAnalyticsFilters` 改为返回 `(service.AnalyticsFilters, error)`。仅接受 `1h`、`2h`、`4h`、`1d` 粒度和 5–50 的 `top_n`；解析成对 RFC3339 自定义时间，限制为 90 天；解析 `models` 时 trim、去重、删除空值；仅允许 `user_id` 用于用户趋势。`yesterday` 计算前一完整 UTC 日。添加 `validAnalyticsViews` map；错误使用 `c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "invalid_analytics_query", "message": "invalid analytics query"}})`，不要回显参数。

- [ ] **Step 3: 重新运行参数与契约测试**

运行：

```bash
cd /Users/xuzhihao/code/Porsche/.worktrees/analytics-chart-proportions && go test ./internal/service ./internal/router
```

预期：筛选错误测试转绿；聚合断言仍失败，证明下一步只剩聚合实现。

- [ ] **Step 4: 提交筛选边界**

```bash
git add internal/handler/analytics.go internal/service/analytics.go internal/service/analytics_test.go internal/router/router_test.go
git commit -m "feat(analytics): validate chart query filters"
```

### Task 3: 实现六种后端聚合视图

**Files:** Modify `internal/service/analytics.go`; modify `internal/service/analytics_test.go`.

- [ ] **Step 1: 实现共享取数与 UTC 分桶 helper**

实现 `analyticsRecords(db, f)`，以 GORM 参数化 `created_at >= ? AND created_at < ?` 查询，应用 `model IN ?` 和可选 `user_id`，且排除 `model IS NULL`。实现 `analyticsBuckets(f)` 生成 `[StartAt, EndAt)` 覆盖的连续 UTC 桶，及 `bucketIndex(t, start, duration)`；每一个生成的 `AnalyticsSeries.Data` 必须预先填充零值。

- [ ] **Step 2: 按 view 分派聚合**

实现 `AnalyticsChart` switch：

```go
case "consumption_distribution": return consumptionDistribution(records, f, price)
case "call_trend": return callTrend(records, f, price)
case "call_distribution", "call_ranking": return modelCallRanking(records, f, price)
case "user_consumption_ranking": return userCostRanking(db, records, f, price)
case "user_consumption_trend": return userCostTrend(records, f, price)
```

模型调用排行以 calls 排序；用户排行以 cost 排序。排序相同用 key 升序，保证结果确定。

- [ ] **Step 3: 实现完整分母与“其他”**

在模型调用/用户成本排行 helper 内先计算当前筛选后全部项目总数，再保留 `TopN`，把余项聚合为 `other`。`ratio` 分母始终是全部项目总数；仅在总数大于零时除法。调用次数分布和排行共用该 helper，保证数值一致。

- [ ] **Step 4: 验证 Green 与完整后端回归**

运行：

```bash
cd /Users/xuzhihao/code/Porsche/.worktrees/analytics-chart-proportions && go test ./... && go vet ./...
```

预期：全部通过；不得新增外部依赖或跳过既有网关 Token/IP 测试。

- [ ] **Step 5: 提交聚合实现**

```bash
git add internal/service/analytics.go internal/service/analytics_test.go internal/router/router_test.go
git commit -m "feat(analytics): return complete chart aggregates"
```

### Task 4: 以纯函数锁定前端百分比和 option 行为

**Files:** Create `llm-platform/src/components/analytics/chart-options.js`; create `llm-platform/src/components/analytics/chart-options.test.js`.

- [ ] **Step 1: 写前端失败测试**

用 `node:test` 和 `assert/strict` 写入：`call_distribution` 的 `ranking` 含两个模型和 `other` 时，pie data 三项都被保留、tooltip 包含 `{d}%`；空 ranking 返回空态而非 pie series；横向调用排行使用 `calls`；用户排行使用 `cost`；时间序列的每个 data 点对应一个 label。

- [ ] **Step 2: 验证 Red**

运行：

```bash
cd /Users/xuzhihao/code/Porsche-Web/.worktrees/analytics-chart-proportions/llm-platform && node --test src/components/analytics/chart-options.test.js
```

预期：失败，因为 `chart-options.js` 尚不存在。

- [ ] **Step 3: 实现纯 option builder**

导出 `buildAnalyticsChartOption(view, data, theme, t, containerWidth)` 与 `isAnalyticsChartEmpty(data)`。函数只读取 API 契约字段，分别构造堆叠柱、折线、环形和横向柱 option；窄容器（小于 640px）将饼图 legend 放到底部，使用较小半径并居中，宽容器保持右侧 legend。所有标签使用 `axisLabel.formatter` 截断，tooltip 保留完整名称。

- [ ] **Step 4: 验证 Green**

运行：

```bash
cd /Users/xuzhihao/code/Porsche-Web/.worktrees/analytics-chart-proportions/llm-platform && node --test src/components/analytics/chart-options.test.js
```

预期：全部通过。

- [ ] **Step 5: 提交纯函数与测试**

```bash
git add llm-platform/src/components/analytics/chart-options.js llm-platform/src/components/analytics/chart-options.test.js
git commit -m "test(llm-platform): cover analytics chart options"
```

### Task 5: 接入组件并验证响应式布局

**Files:** Modify `llm-platform/src/components/analytics/ModelAnalyticsPanel.vue`; modify `llm-platform/src/api/modelAnalytics.js`; modify `llm-platform/package.json` only if test script must include the new test.

- [ ] **Step 1: 写组件源代码契约测试**

在 `chart-options.test.js` 读取 `ModelAnalyticsPanel.vue`，断言其导入 `buildAnalyticsChartOption`、在 `onMounted` 建立 `ResizeObserver`、在 `onBeforeUnmount` 调用 `disconnect`，并在空数据时渲染 Element Plus `el-empty`。该测试先失败。

- [ ] **Step 2: 修改组件到最小实现**

移除组件内重复的 `build*Option` 函数，改由纯函数生成 option。记录 `chartRef.value.clientWidth` 后传入 builder；观察图表容器并在 observer 回调中执行 `chartInstance.resize()` 后重绘。请求失败时以 `ElMessage.error` 显示通用错误、保留安全的空态。只在响应有效时更新图表状态。

- [ ] **Step 3: 统一请求参数**

在 `modelAnalytics.js` 保持现有 JWT Axios interceptor，确保 `metric` 仅在组件将来显式请求时才传递；现有 `range`、RFC3339 自定义范围、`models`、`top_n` 与 `user_id` 均原样进入 query，不在前端自行统计百分比。

- [ ] **Step 4: 验证前端 Green**

运行：

```bash
cd /Users/xuzhihao/code/Porsche-Web/.worktrees/analytics-chart-proportions/llm-platform && npm test && npm run build
```

预期：测试与生产构建通过，且没有 Vue 编译警告。

- [ ] **Step 5: 提交前端接入**

```bash
git add llm-platform/src/components/analytics/ModelAnalyticsPanel.vue llm-platform/src/api/modelAnalytics.js llm-platform/src/components/analytics/chart-options.js llm-platform/src/components/analytics/chart-options.test.js llm-platform/package.json
git commit -m "fix(llm-platform): render accurate analytics chart proportions"
```

### Task 6: 浏览器验收、审计与交接

**Files:** Modify `Porsche-Web/feature_list.json`; modify `Porsche-Web/progress.md`; no production credential files.

- [ ] **Step 1: 本地端到端浏览器验收**

启动后端与前端开发服务，使用 analytics 管理员账号进入计费页的数据分析 tab。在至少 1280px 和 390px 宽度下切换六个 tab，测试 24h、昨天、自定义范围、单模型、Top 5、Top 10 和用户选择；核对图表、PNG 及 CSV 的总数与 `/charts/:view` JSON 相同。

- [ ] **Step 2: 安全审计门**

检查 diff：analytics 路由仍在 `RequireAnalyticsAdmin` 后；所有查询使用 GORM 参数；任何响应、日志、测试夹具和导出均无密码、JWT、Gateway Token 或手机号。发现高危问题时返回对应任务修复，不进入交付。

- [ ] **Step 3: 最终命令验证**

运行：

```bash
cd /Users/xuzhihao/code/Porsche/.worktrees/analytics-chart-proportions && go test ./... && go vet ./...
cd /Users/xuzhihao/code/Porsche-Web/.worktrees/analytics-chart-proportions/llm-platform && npm test && npm run build
cd /Users/xuzhihao/code/Porsche-Web/.worktrees/analytics-chart-proportions && git diff --check
```

预期：每条命令退出码为 0。

- [ ] **Step 4: 记录证据并提交**

仅在上述命令和浏览器验收真实通过后，更新 `feature_list.json`、`progress.md` 的验证命令、日期、提交 SHA、观察到的六图结果和遗留风险；不要把未执行事项标为 passing。

```bash
git add feature_list.json progress.md
git commit -m "docs: record analytics chart verification"
```

## 安全与交付门

- 后端 router/service 测试和前端 option/component 测试必须先红后绿；不可通过修改断言、跳过测试或只做 CSS 调整来交付。
- `RequireAnalyticsAdmin`、参数化查询、90 天时间范围、Top N 上限和无 PII 用户标签为强制条件。
- 安全审查发现 SQL 注入、越权、Token/JWT/手机号泄露任一高危问题时，必须修复并重新运行完整验证。
- 只有后端测试、前端测试、生产构建、浏览器验收和安全审计都有实际证据时，才可请求合并。

## Self-review

- Tasks 1–3 覆盖已确认的后端空数据、筛选丢失、排序错误、用户维度错误及分母不完整根因。
- Tasks 4–5 覆盖前端图表比例、空态、长标签和响应式布局，不改变认证或网关协议。
- Task 6 设定跨端回归、安全审计与证据记录门；计划没有待定事项或模糊的“适当处理”步骤。
