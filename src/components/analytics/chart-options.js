const CHART_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4']
const RANKING_VIEWS = new Set(['call_distribution', 'call_ranking', 'user_consumption_ranking'])
const TIME_SERIES_VIEWS = new Set(['consumption_distribution', 'call_trend', 'user_consumption_trend'])

/** Escapes untrusted text before it is returned by an ECharts HTML tooltip formatter. */
function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/onerror/gi, 'on&#101;rror')
}

function valueOf(point, field) {
  const value = Number(point?.[field])
  return Number.isFinite(value) ? value : 0
}

function labelOf(item) {
  return item?.label || String(item?.key ?? '')
}

function truncateLabel(label, limit = 18) {
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label
}

function chartTheme(theme = {}) {
  return {
    text: theme.text || '#909399',
    border: theme.border || '#dcdfe6',
  }
}

function baseOption(theme) {
  return {
    color: CHART_COLORS,
    textStyle: { color: theme.text },
  }
}

function timeSeries(data, field) {
  const labels = Array.isArray(data?.time_labels) ? data.time_labels : []
  return (data?.series || []).map((series) => ({
    name: series.name || '',
    data: labels.map((_, index) => valueOf(series.data?.[index], field)),
  }))
}

function hasRecordedMetric(data) {
  return data.series?.some((series) =>
    series.data?.some((point) => ['tokens', 'calls', 'cost'].some((field) => valueOf(point, field) !== 0)),
  )
}

function axis(theme, labels) {
  return {
    type: 'category',
    data: labels,
    axisLabel: { color: theme.text },
    axisLine: { lineStyle: { color: theme.border } },
  }
}

function valueAxis(theme, name) {
  return {
    type: 'value',
    name,
    axisLabel: { color: theme.text },
    splitLine: { lineStyle: { color: theme.border, opacity: 0.3 } },
  }
}

function buildConsumptionDistribution(data, theme, t) {
  const metric = data.metric === 'tokens' ? 'tokens' : 'cost'
  const labels = data.time_labels || []
  return {
    ...baseOption(theme),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { type: 'scroll', bottom: 0, textStyle: { color: theme.text } },
    grid: { left: 60, right: 20, top: 40, bottom: 60 },
    xAxis: axis(theme, labels),
    yAxis: valueAxis(theme, metric === 'cost' ? t('analytics.metricCost') : t('analytics.metricTokens')),
    series: timeSeries(data, metric).map((series) => ({
      ...series,
      type: 'bar',
      stack: 'total',
      emphasis: { focus: 'series' },
    })),
  }
}

function buildTrend(data, theme, t, field, titleKey) {
  const labels = data.time_labels || []
  return {
    ...baseOption(theme),
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', bottom: 0, textStyle: { color: theme.text } },
    grid: { left: 60, right: 20, top: 40, bottom: 60 },
    xAxis: axis(theme, labels),
    yAxis: valueAxis(theme, field === 'calls' ? t('analytics.totalCalls') : t('analytics.metricCost')),
    series: timeSeries(data, field).map((series) => ({
      ...series,
      name: series.name || t(titleKey),
      type: 'line',
      smooth: true,
    })),
  }
}

function buildPie(data, theme, containerWidth) {
  const ranking = data.ranking || []
  const mobile = containerWidth < 640
  return {
    ...baseOption(theme),
    tooltip: {
      trigger: 'item',
      formatter: (params) => `${escapeHTML(params.name)}: ${params.value} (${Number(params.percent || 0).toFixed(2)}%)`,
    },
    legend: mobile
      ? { type: 'scroll', orient: 'horizontal', bottom: 0, textStyle: { color: theme.text } }
      : { type: 'scroll', orient: 'vertical', right: 10, top: 'center', textStyle: { color: theme.text } },
    series: [{
      type: 'pie',
      radius: mobile ? ['32%', '56%'] : ['40%', '70%'],
      center: mobile ? ['50%', '42%'] : ['40%', '50%'],
      data: ranking.map((item) => ({ name: labelOf(item), value: valueOf(item, 'calls') })),
      emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' } },
    }],
  }
}

function buildRanking(data, theme, field) {
  const ranking = [...(data.ranking || [])].reverse()
  const labels = ranking.map(labelOf)
  return {
    ...baseOption(theme),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params
        return `${escapeHTML(item?.name)}: ${item?.value ?? 0}`
      },
    },
    grid: { left: 140, right: 40, top: 20, bottom: 30 },
    xAxis: valueAxis(theme),
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: theme.text, formatter: truncateLabel },
      axisLine: { lineStyle: { color: theme.border } },
    },
    series: [{ type: 'bar', data: ranking.map((item) => valueOf(item, field)) }],
  }
}

/** Returns whether a view has no backend data to render. */
export function isAnalyticsChartEmpty(view, data) {
  if (!data) return true
  if (RANKING_VIEWS.has(view)) return !(data.ranking?.length)
  if (TIME_SERIES_VIEWS.has(view)) {
    if (!(data.time_labels?.length) || !(data.series?.some((series) => series.data?.length))) return true
    if (view === 'call_trend' || view === 'user_consumption_trend') return !hasRecordedMetric(data)
    return false
  }
  return true
}

/** Builds a serializable ECharts option from the analytics API response. */
export function buildAnalyticsChartOption(view, data, theme, t = (key) => key, containerWidth = 0) {
  if (isAnalyticsChartEmpty(view, data)) return null
  const resolvedTheme = chartTheme(theme)
  switch (view) {
    case 'consumption_distribution':
      return buildConsumptionDistribution(data, resolvedTheme, t)
    case 'call_trend':
      return buildTrend(data, resolvedTheme, t, 'calls', 'analytics.views.callTrend')
    case 'call_distribution':
      return buildPie(data, resolvedTheme, containerWidth)
    case 'call_ranking':
      return buildRanking(data, resolvedTheme, 'calls')
    case 'user_consumption_ranking':
      return buildRanking(data, resolvedTheme, 'cost')
    case 'user_consumption_trend':
      return buildTrend(data, resolvedTheme, t, 'cost', 'analytics.views.userConsumptionTrend')
    default:
      return null
  }
}
