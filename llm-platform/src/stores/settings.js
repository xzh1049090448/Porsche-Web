import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getItem, setItem } from '@/utils/storage'
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID, DEFAULT_SCENARIO_ID, MODELS } from '@/constants/models'
import { SCENARIO_PRESETS, getScenarioPreset } from '@/constants/scenario-presets'
import { listModels } from '@/api/platform'
import { listDatasets } from '@/api/datasets'

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

  const selectedModelId = ref(
    ALLOWED_MODEL_IDS.includes(getItem('selectedModel')) ? getItem('selectedModel') : DEFAULT_MODEL_ID
  )
  const selectedScenarioId = ref(initialScenarioId)
  const modelParams = ref({ ...initialPreset.params })
  const useDataset = ref(getItem('useDataset', true))
  const selectedDatasetIds = ref(getItem('selectedDatasets', []))
  const compareMode = ref(false)
  const storedCompare = getItem('compareModels', ALLOWED_MODEL_IDS)
  const compareModelIds = ref(
    (Array.isArray(storedCompare) ? storedCompare : ALLOWED_MODEL_IDS).filter((id) =>
      ALLOWED_MODEL_IDS.includes(id)
    )
  )
  if (!compareModelIds.value.length) {
    compareModelIds.value = [...ALLOWED_MODEL_IDS]
  }

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
          selectedModelId.value = DEFAULT_MODEL_ID
          setItem('selectedModel', DEFAULT_MODEL_ID)
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
    selectedModelId.value = id
    setItem('selectedModel', id)
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

  function setUseDataset(val) {
    useDataset.value = val
    setItem('useDataset', val)
  }

  function setDatasetIds(ids) {
    selectedDatasetIds.value = ids
    setItem('selectedDatasets', ids)
  }

  function toggleCompare(enabled) {
    compareMode.value = enabled
  }

  function setCompareModels(ids) {
    compareModelIds.value = ids
    setItem('compareModels', ids)
  }

  const currentModel = () => models.value.find((m) => m.id === selectedModelId.value)

  return {
    models,
    datasets,
    modelsLoaded,
    datasetsLoaded,
    selectedModelId,
    selectedScenarioId,
    modelParams,
    useDataset,
    selectedDatasetIds,
    compareMode,
    compareModelIds,
    loadModels,
    loadDatasets,
    setModel,
    setScenario,
    setModelParams,
    setUseDataset,
    setDatasetIds,
    toggleCompare,
    setCompareModels,
    currentModel,
  }
})
