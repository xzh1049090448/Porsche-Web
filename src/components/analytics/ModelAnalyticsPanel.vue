<template>
  <div v-loading="loading" class="analytics-panel">
    <div class="analytics-header">
      <h2 class="section-title">{{ t('analytics.title') }}</h2>
      <div class="header-controls">
        <el-select v-model="rangePreset" size="small" class="range-select" @change="onRangePresetChange">
          <el-option
            v-for="opt in rangeOptions"
            :key="opt.value"
            :label="t(opt.labelKey)"
            :value="opt.value"
          />
        </el-select>
        <el-date-picker
          v-if="rangePreset === 'custom'"
          v-model="customRange"
          type="datetimerange"
          size="small"
          :start-placeholder="t('analytics.customStart')"
          :end-placeholder="t('analytics.customEnd')"
          class="custom-range"
          @change="refreshData"
        />
        <el-dropdown trigger="click" @command="handleExport">
          <el-button size="small">
            {{ t('analytics.export') }}
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="png">{{ t('analytics.exportPng') }}</el-dropdown-item>
              <el-dropdown-item command="excel">{{ t('analytics.exportExcel') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <el-row :gutter="16" class="overview-cards">
      <el-col :xs="12" :sm="6">
        <el-statistic :title="t('analytics.totalCost')" :value="summary.total_cost ?? 0" :precision="2" prefix="¥" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-statistic :title="t('analytics.totalTokens')" :value="summary.total_tokens ?? 0" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-statistic :title="t('analytics.totalCalls')" :value="summary.total_calls ?? 0" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="range-label-card">
          <div class="range-label-title">{{ t('analytics.timeRange') }}</div>
          <div class="range-label-value">{{ summary.range_label || '—' }}</div>
        </div>
      </el-col>
    </el-row>

    <el-tabs v-model="activeView" class="chart-tabs" @tab-change="onViewChange">
      <el-tab-pane
        v-for="view in viewTabs"
        :key="view.key"
        :label="t(view.labelKey)"
        :name="view.key"
      />
    </el-tabs>

    <div v-if="isChartEmpty" class="chart-empty">
      <el-empty :description="t('analytics.noChart')" />
    </div>
    <div v-else ref="chartRef" class="chart-container" />

    <div class="analytics-footer">
      <el-select
        v-model="selectedModels"
        multiple
        collapse-tags
        collapse-tags-tooltip
        size="small"
        :placeholder="t('analytics.modelFilter')"
        class="model-select"
        @change="refreshData"
      >
        <el-option v-for="m in allModels" :key="m.model" :label="m.model" :value="m.model" />
      </el-select>
      <el-button size="small" @click="selectTop5">{{ t('analytics.top5Shortcut') }}</el-button>
      <el-select
        v-model="granularity"
        size="small"
        class="granularity-select"
        @change="refreshData"
      >
        <el-option v-for="g in granularityOptions" :key="g" :label="g" :value="g" />
      </el-select>
      <el-select
        v-if="isRankingView"
        v-model="topN"
        size="small"
        class="topn-select"
        @change="refreshData"
      >
        <el-option v-for="n in topNOptions" :key="n" :label="t('analytics.topN', { n })" :value="n" />
      </el-select>
      <el-select
        v-if="activeView === 'user_consumption_trend'"
        v-model="selectedUserId"
        size="small"
        class="user-select"
        :placeholder="t('analytics.selectUser')"
        @change="refreshChart"
      >
        <el-option
          v-for="u in userOptions"
          :key="u.userId"
          :label="u.label"
          :value="u.userId"
        />
      </el-select>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import * as echarts from 'echarts'
import { getSummary, getModels, getChart, exportExcel } from '@/api/modelAnalytics'
import { buildAnalyticsChartOption, isAnalyticsChartEmpty } from './chart-options'
import { useI18n } from '@/composables/useI18n'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

const loading = ref(false)
const summary = ref({})
const allModels = ref([])
const selectedModels = ref([])
const chartData = ref(null)
const userOptions = ref([])
const selectedUserId = ref(null)

const rangePreset = ref('24h')
const customRange = ref(null)
const granularity = ref('2h')
const topN = ref(10)
const activeView = ref('consumption_distribution')

const chartRef = ref(null)
let chartInstance = null
let resizeObserver = null
let resizeFrame = null

const rangeOptions = [
  { value: '1h', labelKey: 'analytics.ranges.1h' },
  { value: '6h', labelKey: 'analytics.ranges.6h' },
  { value: '24h', labelKey: 'analytics.ranges.24h' },
  { value: 'yesterday', labelKey: 'analytics.ranges.yesterday' },
  { value: '7d', labelKey: 'analytics.ranges.7d' },
  { value: 'custom', labelKey: 'analytics.ranges.custom' },
]

const granularityOptions = ['1h', '2h', '4h', '1d']
const topNOptions = [5, 10, 20, 50]

const viewTabs = [
  { key: 'consumption_distribution', labelKey: 'analytics.views.consumptionDistribution' },
  { key: 'call_trend', labelKey: 'analytics.views.callTrend' },
  { key: 'call_distribution', labelKey: 'analytics.views.callDistribution' },
  { key: 'call_ranking', labelKey: 'analytics.views.callRanking' },
  { key: 'user_consumption_ranking', labelKey: 'analytics.views.userConsumptionRanking' },
  { key: 'user_consumption_trend', labelKey: 'analytics.views.userConsumptionTrend' },
]

const rankingViews = new Set(['call_ranking', 'user_consumption_ranking'])
const isRankingView = computed(() => rankingViews.has(activeView.value))

const isChartEmpty = computed(() => isAnalyticsChartEmpty(activeView.value, chartData.value))

function getThemeStyle() {
  const style = getComputedStyle(document.documentElement)
  return {
    text: style.getPropertyValue('--text-secondary').trim() || '#909399',
    border: style.getPropertyValue('--border-color').trim() || '#dcdfe6',
  }
}

function queryParams() {
  const p = { granularity: granularity.value, top_n: topN.value }
  if (rangePreset.value === 'custom' && customRange.value?.length === 2) {
    p.start_at = customRange.value[0].toISOString()
    p.end_at = customRange.value[1].toISOString()
  } else if (rangePreset.value !== 'custom') {
    p.range = rangePreset.value
  }
  const allSelected =
    allModels.value.length > 0 && selectedModels.value.length === allModels.value.length
  if (!allSelected && selectedModels.value.length > 0) {
    p.models = selectedModels.value.join(',')
  }
  if (activeView.value === 'user_consumption_trend' && selectedUserId.value != null) {
    p.user_id = selectedUserId.value
  }
  return p
}

function initChart() {
  if (!chartRef.value) return
  if (chartInstance?.getDom() !== chartRef.value) {
    chartInstance?.dispose()
    chartInstance = echarts.init(chartRef.value)
  }
}

function renderChart() {
  if (isChartEmpty.value) {
    chartInstance?.dispose()
    chartInstance = null
    resizeObserver?.disconnect()
    return
  }
  initChart()
  if (!chartInstance || !chartData.value) return
  const theme = getThemeStyle()
  const option = buildAnalyticsChartOption(
    activeView.value,
    chartData.value,
    theme,
    t,
    chartRef.value?.clientWidth ?? 0,
  )
  if (!option) return
  chartInstance.setOption(option, true)
  resizeObserver?.disconnect()
  if (chartRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        renderChart()
        chartInstance?.resize()
      })
    })
    resizeObserver.observe(chartRef.value)
  }
}

async function loadModels() {
  const res = await getModels(queryParams())
  allModels.value = res.items || []
  if (selectedModels.value.length === 0 && allModels.value.length) {
    selectedModels.value = allModels.value.map((m) => m.model)
  }
}

async function loadUsersFromRanking() {
  const params = { ...queryParams() }
  delete params.user_id
  const res = await getChart('user_consumption_ranking', params)
  userOptions.value = (res.ranking || []).map((r) => ({
    userId: Number(r.key) || r.key,
    label: r.label || String(r.key),
  }))
  if (selectedUserId.value == null && userOptions.value.length) {
    selectedUserId.value = userOptions.value[0].userId
  }
}

async function refreshSummary() {
  summary.value = await getSummary(queryParams())
}

async function refreshChart() {
  if (activeView.value === 'user_consumption_trend') {
    if (!userOptions.value.length) await loadUsersFromRanking()
    if (selectedUserId.value == null) {
      chartData.value = { time_labels: [], series: [], ranking: [] }
      await nextTick()
      renderChart()
      return
    }
  }
  chartData.value = await getChart(activeView.value, queryParams())
  await nextTick()
  renderChart()
}

async function refreshData() {
  loading.value = true
  try {
    await loadModels()
    await Promise.all([refreshSummary(), refreshChart()])
  } finally {
    loading.value = false
  }
}

function onRangePresetChange(val) {
  if (val !== 'custom') refreshData()
}

async function onViewChange() {
  loading.value = true
  try {
    if (activeView.value === 'user_consumption_trend') {
      await loadUsersFromRanking()
    }
    await refreshChart()
  } finally {
    loading.value = false
  }
}

function selectTop5() {
  const top5 = allModels.value.filter((m) => m.is_top5).map((m) => m.model)
  selectedModels.value = top5.length ? top5 : allModels.value.slice(0, 5).map((m) => m.model)
  refreshData()
}

function handleExport(command) {
  if (command === 'png') exportPng()
  else if (command === 'excel') exportExcelFile()
}

function exportPng() {
  if (!chartInstance) {
    ElMessage.warning(t('analytics.noChart'))
    return
  }
  const url = chartInstance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
  const link = document.createElement('a')
  link.href = url
  link.download = `model-analytics-${activeView.value}.png`
  link.click()
  ElMessage.success(t('analytics.exportPngSuccess'))
}

async function exportExcelFile() {
  loading.value = true
  try {
    const { blob, filename } = await exportExcel(activeView.value, queryParams())
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
    ElMessage.success(t('analytics.exportExcelSuccess'))
  } finally {
    loading.value = false
  }
}

watch(() => themeStore.theme, () => {
  nextTick(() => renderChart())
})

onMounted(async () => {
  await refreshData()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
  chartInstance?.dispose()
  chartInstance = null
})
</script>

<style scoped lang="scss">
.analytics-panel {
  min-height: 400px;
}

.analytics-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;

  .section-title {
    margin: 0;
  }
}

.header-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.range-select {
  width: 140px;
}

.custom-range {
  max-width: 360px;
}

.overview-cards {
  margin-bottom: 20px;
}

.range-label-card {
  padding: 8px 0;

  .range-label-title {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .range-label-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
  }
}

.chart-tabs {
  margin-bottom: 8px;
}

.chart-container {
  width: 100%;
  height: clamp(480px, 62vh, 780px);
  margin-bottom: 16px;
}

.chart-empty {
  height: clamp(480px, 62vh, 780px);
  display: grid;
  place-items: center;
  margin-bottom: 16px;
}

.analytics-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

.model-select {
  min-width: 200px;
  flex: 1;
  max-width: 360px;
}

.granularity-select,
.topn-select,
.user-select {
  width: 100px;
}

.user-select {
  width: 160px;
}
</style>
