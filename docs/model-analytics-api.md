# 模型数据分析模块 API 契约（V1）

前后端对齐版本，前缀：`/api/v1/billing/analytics`  
鉴权：JWT Bearer（与现有 billing 一致）  
权限：仅 `analytics_admin_phones` 配置中的手机号可访问，否则 403

## 通用 Query 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `range` | string | 预设：`1h` \| `6h` \| `24h`（默认）\| `yesterday` \| `7d` |
| `start_at` | ISO8601 | 自定义开始（与 `end_at` 成对，优先于 range） |
| `end_at` | ISO8601 | 自定义结束 |
| `granularity` | string | `1h` \| `2h`（默认）\| `4h` \| `1d` |
| `models` | string | 逗号分隔模型名，空=全部 |
| `top_n` | int | 排行类默认 10 |
| `user_id` | int | 用户消耗趋势专用 |

## 1. GET `/access`

检查当前用户是否有分析权限。

**Response 200**
```json
{ "allowed": true }
```

## 2. GET `/summary`

概览卡片数据。

**Response 200**
```json
{
  "total_tokens": 1285600,
  "total_cost": 543438.79,
  "total_calls": 128560,
  "range_label": "近24小时",
  "start_at": "2026-06-05T13:00:00+00:00",
  "end_at": "2026-06-06T13:00:00+00:00",
  "updated_at": "2026-06-06T13:00:00+00:00"
}
```

## 3. GET `/models`

模型筛选列表（含 Top5 热门标记）。

**Response 200**
```json
{
  "items": [
    { "model": "glm-5.1", "total_tokens": 50000, "total_calls": 1200, "is_top5": true }
  ]
}
```

## 4. GET `/charts/{view}`

`view` 枚举：
- `consumption_distribution` — 堆叠柱状（tokens/cost 按时间桶+模型）
- `call_trend` — 折线（总调用次数随时间）
- `call_distribution` — 饼图（各模型调用占比）
- `call_ranking` — 横向柱状（模型调用 Top N）
- `user_consumption_ranking` — 横向柱状（用户消耗 Top N，手机号脱敏）
- `user_consumption_trend` — 折线（指定 user_id 消耗趋势，需 `user_id`）

**Response 200**
```json
{
  "view": "consumption_distribution",
  "metric": "cost",
  "granularity": "2h",
  "start_at": "...",
  "end_at": "...",
  "time_labels": ["06-05 23:00", "06-06 01:00"],
  "series": [
    {
      "name": "glm-5.1",
      "data": [
        { "time": "2026-06-05T23:00:00+00:00", "tokens": 1200, "cost": 1.2, "calls": 45, "ratio": 0.15 }
      ]
    }
  ],
  "ranking": [
    { "key": "glm-5.1", "label": "glm-5.1", "tokens": 50000, "cost": 500.0, "calls": 1200, "ratio": 0.23 }
  ]
}
```

说明：
- `series` 用于时序/堆叠类图表；`ranking` 用于排行/饼图类
- `cost = tokens * token_price_per_1k / 1000`（后端 settings 配置）
- 用户排行 `label` 为脱敏手机号如 `138****8000`

## 5. GET `/export`

导出 Excel 明细。Query 同 charts + `view`（必填）。

**Response 200** `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`  
文件名：`model-analytics-{view}-{timestamp}.xlsx`  
列：`time_bucket`, `model`, `tokens`, `cost`, `calls`, `ratio`

## 错误码

- 401 未登录
- 403 无分析权限
- 400 参数无效

## 前端模块结构（最小化）

```
src/
  api/modelAnalytics.js
  components/analytics/
    ModelAnalyticsPanel.vue   # 主面板（嵌入 Billing 页 Tab）
    AnalyticsFilters.vue      # 时间/粒度/模型筛选
    AnalyticsChart.vue          # ECharts 封装
  views/Billing.vue             # 增加 el-tabs
```

PNG 导出：前端 ECharts `getDataURL()`，不调后端。
