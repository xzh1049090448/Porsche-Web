import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getItem, setItem } from '@/utils/storage'
import {
  ALLOWED_MODEL_IDS,
  ALL_MODEL_IDS,
  DEFAULT_MODEL_ID,
  DEFAULT_SCENARIO_ID,
  MODELS,
} from '@/constants/models'
import { SCENARIO_PRESETS, getScenarioPreset } from '@/constants/scenario-presets'
import { listModels } from '@/api/platform'
import { listDatasets } from '@/api/datasets'

function normalizeCompareIds(ids) {
  const unique = [...new Set((ids || []).filter((id) => ALLOWED_MODEL_IDS.includes(id)))]
  if (!unique.length) return [...ALL_MODEL_IDS]
  return unique
}

function readInitialModelState() {
  const storedCompareMode = getItem('compareMode', null)
  const storedCompareIds = getItem('compareModelIds', null)
  const storedMulti = getItem('selectedModels', null)
  const legacySingle = getItem('selectedModel', DEFAULT_MODEL_ID)

  let selectedModelId = ALLOWED_MODEL_IDS.includes(legacySingle) ? legacySingle : DEFAULT_MODEL_ID
  let compareMode = false
  let compareModelIds = [...ALL_MODEL_IDS]

  if (storedCompareMode !== null) {
    compareMode = !!storedCompareMode
  } else if (Array.isArray(storedMulti) && storedMulti.length > 1) {
    compareMode = true
    compareModelIds = normalizeCompareIds(storedMulti)
    selectedModelId = storedMulti[0]
  }

  if (Array.isArray(storedCompareIds) && storedCompareIds.length) {
    compareModelIds = normalizeCompareIds(storedCompareIds)
  }

  return { selectedModelId, compareMode, compareModelIds }
}

export const useSettingsStore = defineStore('settings', () => {
  const models = ref([...MODELS])
  const datasets = ref([])
  const modelsLoaded = ref(false)
  const datasetsLoaded = ref(false)

  const storedScenario = getItem('selectedScenario', DEFAULT_SCENARIO_ID)
  const initialScenarioId = SCENARIO_PRESETS.some((s) => s.id === storedScenario)
    ? storedScenario
    : DEFAULT_SCENARIO_ID
  const initialPreset = getScenarioPreset(initialScenarioId)

  const initialModelState = readInitialModelState()
  const selectedModelId = ref(initialModelState.selectedModelId)
  const compareMode = ref(initialModelState.compareMode)
  const compareModelIds = ref(initialModelState.compareModelIds)
  const selectedScenarioId = ref(initialScenarioId)
  const modelParams = ref({ ...initialPreset.params })
  const useDataset = ref(getItem('useDataset', true))
  const selectedDatasetIds = ref(getItem('selectedDatasets', []))

  let modelsLoadPromise = null
  let datasetsLoadPromise = null

  async function loadModels() {
    if (modelsLoaded.value) return
    if (modelsLoadPromise) return modelsLoadPromise
    modelsLoadPromise = (async () => {
      try {
        const list = await listModels()
        models.value = mergePlatformModels(list)
        if (!models.value.some((m) => m.id === selectedModelId.value)) {
          selectedModelId.value = models.value[0]?.id || DEFAULT_MODEL_ID
          setItem('selectedModel', selectedModelId.value)
        }
        compareModelIds.value = normalizeCompareIds(
          compareModelIds.value.filter((id) => models.value.some((m) => m.id === id))
        )
        setItem('compareModelIds', compareModelIds.value)
        if (models.value.length === 1) {
          compareMode.value = false
          setItem('compareMode', false)
          setModel(models.value[0].id)
        }
      } finally {
        modelsLoaded.value = true
        modelsLoadPromise = null
      }
    })()
    return modelsLoadPromise
  }

  async function loadDatasets() {
    if (datasetsLoaded.value) return
    if (datasetsLoadPromise) return datasetsLoadPromise
    datasetsLoadPromise = (async () => {
      try {
        const list = await listDatasets()
        datasets.value = list
        if (list.length && (!selectedDatasetIds.value || !selectedDatasetIds.value.length)) {
          selectedDatasetIds.value = list.map((d) => d.id)
          setItem('selectedDatasets', selectedDatasetIds.value)
        }
      } finally {
        datasetsLoaded.value = true
        datasetsLoadPromise = null
      }
    })()
    return datasetsLoadPromise
  }

  function setModel(id) {
    if (!ALLOWED_MODEL_IDS.includes(id)) return
    selectedModelId.value = id
    setItem('selectedModel', id)
  }

  function setCompareMode(val) {
    if (models.value.length <= 1) {
      compareMode.value = false
      setItem('compareMode', false)
      return
    }
    compareMode.value = val
    setItem('compareMode', val)
    if (val && compareModelIds.value.length < 2) {
      const next = normalizeCompareIds([selectedModelId.value, ...ALL_MODEL_IDS])
      compareModelIds.value = next.slice(0, Math.max(2, next.length))
      setItem('compareModelIds', compareModelIds.value)
    }
  }

  function setCompareModelIds(ids) {
    const next = normalizeCompareIds(ids)
    if (!next.length) return
    compareModelIds.value = next
    setItem('compareModelIds', next)
  }

  function setModelParams(params) {
    modelParams.value = { ...modelParams.value, ...params }
    setItem('modelParams', modelParams.value)
  }

  function setScenario(id) {
    const preset = getScenarioPreset(id)
    selectedScenarioId.value = preset.id
    modelParams.value = { ...preset.params }
    setItem('selectedScenario', preset.id)
    setItem('modelParams', modelParams.value)
  }

  setItem('selectedScenario', initialScenarioId)
  setItem('modelParams', initialPreset.params)
  setItem('selectedModel', selectedModelId.value)
  setItem('compareMode', compareMode.value)
  setItem('compareModelIds', compareModelIds.value)

  function setUseDataset(val) {
    useDataset.value = val
    setItem('useDataset', val)
  }

  function setDatasetIds(ids) {
    selectedDatasetIds.value = ids
    setItem('selectedDatasets', ids)
  }

  const currentModel = () => models.value.find((m) => m.id === selectedModelId.value)

  const compareModels = () =>
    compareModelIds.value
      .map((id) => models.value.find((m) => m.id === id))
      .filter(Boolean)

  return {
    models,
    datasets,
    modelsLoaded,
    datasetsLoaded,
    selectedModelId,
    compareMode,
    compareModelIds,
    selectedScenarioId,
    modelParams,
    useDataset,
    selectedDatasetIds,
    loadModels,
    loadDatasets,
    setModel,
    setCompareMode,
    setCompareModelIds,
    setScenario,
    setModelParams,
    setUseDataset,
    setDatasetIds,
    currentModel,
    compareModels,
  }
})

/** 以后端返回为准合并本地展示配置，保证 ALLOWED_MODEL_IDS 中的模型都会展示 */
function mergePlatformModels(remoteList) {
  const byId = new Map(remoteList.map((m) => [m.id, m]))
  return ALLOWED_MODEL_IDS.map((id) => {
    const local = MODELS.find((m) => m.id === id)
    if (!local) return null
    const remote = byId.get(id)
    return remote ? { ...local, ...remote, name: local.name } : { ...local }
  }).filter(Boolean)
}
