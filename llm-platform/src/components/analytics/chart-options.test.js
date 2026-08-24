import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAnalyticsChartOption, isAnalyticsChartEmpty } from './chart-options.js'

const theme = { text: '#666', border: '#ddd' }
const t = (key) => key

test('call distribution keeps every backend ranking entry including other and shows value with percentage', () => {
  const option = buildAnalyticsChartOption(
    'call_distribution',
    {
      ranking: [
        { key: 'model-a', label: 'Model A', calls: 75, ratio: 0.75 },
        { key: 'other', label: 'Other', calls: 25, ratio: 0.25 },
      ],
    },
    theme,
    t,
    960,
  )

  assert.deepEqual(option.series[0].data, [
    { name: 'Model A', value: 75 },
    { name: 'Other', value: 25 },
  ])
  assert.equal(option.tooltip.formatter({ name: 'Other', value: 25, percent: 25 }), 'Other: 25 (25.00%)')
  assert.equal(option.legend.orient, 'vertical')
})

test('empty ranking is an empty chart state instead of a zero-percent pie', () => {
  assert.equal(isAnalyticsChartEmpty('call_distribution', { ranking: [] }), true)
  assert.equal(buildAnalyticsChartOption('call_distribution', { ranking: [] }, theme, t, 960), null)
})

test('ranking views use their distinct backend measures and long labels retain the full tooltip text', () => {
  const longName = 'A very long user or model name that should be truncated in the axis label'
  const data = { ranking: [{ key: 'one', label: longName, calls: 8, cost: 12.5 }] }

  const callOption = buildAnalyticsChartOption('call_ranking', data, theme, t, 960)
  const userOption = buildAnalyticsChartOption('user_consumption_ranking', data, theme, t, 960)

  assert.deepEqual(callOption.series[0].data, [8])
  assert.deepEqual(userOption.series[0].data, [12.5])
  assert.match(callOption.yAxis.axisLabel.formatter(longName), /…$/)
  assert.match(callOption.tooltip.formatter([{ name: longName, value: 8 }]), new RegExp(longName))
})

test('time series map exactly to their labels for calls and user consumption', () => {
  const data = {
    time_labels: ['10:00', '11:00'],
    series: [{ name: 'Model A', data: [{ tokens: 4, calls: 2, cost: 1.5 }, { tokens: 5, calls: 3, cost: 2.5 }] }],
  }

  const calls = buildAnalyticsChartOption('call_trend', data, theme, t, 960)
  const userCost = buildAnalyticsChartOption('user_consumption_trend', data, theme, t, 960)

  assert.deepEqual(calls.xAxis.data, ['10:00', '11:00'])
  assert.deepEqual(calls.series[0].data, [2, 3])
  assert.deepEqual(userCost.xAxis.data, ['10:00', '11:00'])
  assert.deepEqual(userCost.series[0].data, [1.5, 2.5])
})

test('pie chart uses a bottom legend and smaller centered radius on narrow containers', () => {
  const option = buildAnalyticsChartOption(
    'call_distribution',
    { ranking: [{ key: 'model-a', label: 'Model A', calls: 1 }] },
    theme,
    t,
    360,
  )

  assert.equal(option.legend.orient, 'horizontal')
  assert.equal(option.legend.bottom, 0)
  assert.deepEqual(option.series[0].radius, ['32%', '56%'])
  assert.deepEqual(option.series[0].center, ['50%', '42%'])
})

test('all-zero trend aggregates are empty while any recorded metric keeps the trend visible', () => {
  const emptyTrend = {
    time_labels: ['10:00'],
    series: [{ data: [{ calls: 0, cost: 0, tokens: 0 }] }],
  }
  const recordedTrend = {
    time_labels: ['10:00'],
    series: [{ data: [{ calls: 0, cost: 1, tokens: 0 }] }],
  }

  assert.equal(isAnalyticsChartEmpty('call_trend', emptyTrend), true)
  assert.equal(isAnalyticsChartEmpty('user_consumption_trend', emptyTrend), true)
  assert.equal(isAnalyticsChartEmpty('call_trend', recordedTrend), false)
  assert.equal(isAnalyticsChartEmpty('user_consumption_trend', recordedTrend), false)
})

test('tooltip formatters escape untrusted ranking labels before returning HTML', () => {
  const unsafeName = '<img src=x onerror=alert(1)>'
  const data = { ranking: [{ key: 'unsafe', label: unsafeName, calls: 1, cost: 2 }] }
  const pie = buildAnalyticsChartOption('call_distribution', data, theme, t, 960)
  const ranking = buildAnalyticsChartOption('call_ranking', data, theme, t, 960)

  for (const output of [
    pie.tooltip.formatter({ name: unsafeName, value: 1, percent: 100 }),
    ranking.tooltip.formatter([{ name: unsafeName, value: 1 }]),
  ]) {
    assert.doesNotMatch(output, /<img|onerror/i)
    assert.match(output, /&lt;img src=x on&#101;rror=alert\(1\)&gt;/)
  }
})
