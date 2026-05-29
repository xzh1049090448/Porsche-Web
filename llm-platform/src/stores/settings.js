import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getItem, setItem } from '@/utils/storage'
import { DEFAULT_MODEL_ID, DEFAULT_SCENARIO_ID, MODELS } from '@/constants/models'
import { SCENARIO_PRESETS, getScenarioPreset } from '@/constants/scenario-presets'
import { listModels } from '@/api/platform'
import { listDatasets } from '@/api/datasets'

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

  const selectedModelId = ref(getItem('selectedModel', DEFAULT_MODEL_ID))
  const selectedScenarioId = ref(initialScenarioId)
  const modelParams = ref({ ...initialPreset.params })
  const useDataset = ref(getItem('useDataset', true))
  const selectedDatasetIds = ref(getItem('selectedDatasets', []))
  const compareMode = ref(false)
  const compareModelIds = ref(getItem('compareModels', [DEFAULT_MODEL_ID]))

  let modelsLoadPromise = null
  let datasetsLoadPromise = null

  async function loadModels() {
    if (modelsLoaded.value) return
    if (modelsLoadPromise) return modelsLoadPromise
    modelsLoadPromise = (async () => {
      try {
        const list = await listModels()
        const glmOnly = list.filter((m) => m.id === DEFAULT_MODEL_ID)
        models.value = glmOnly.length ? glmOnly : [...MODELS]
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
