import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getItem, setItem } from '@/utils/storage'
import { DEFAULT_MODEL_PARAMS, MODELS } from '@/constants/models'
import { listModels } from '@/api/platform'
import { listDatasets } from '@/api/datasets'

export const useSettingsStore = defineStore('settings', () => {
  const models = ref([...MODELS])
  const datasets = ref([])
  const modelsLoaded = ref(false)
  const datasetsLoaded = ref(false)

  const selectedModelId = ref(getItem('selectedModel', 'qwen-turbo'))
  const modelParams = ref(getItem('modelParams', { ...DEFAULT_MODEL_PARAMS }))
  const useDataset = ref(getItem('useDataset', true))
  const selectedDatasetIds = ref(getItem('selectedDatasets', []))
  const compareMode = ref(false)
  const compareModelIds = ref(getItem('compareModels', ['qwen-turbo', 'deepseek-chat']))

  async function loadModels() {
    try {
      const list = await listModels()
      if (list.length) {
        models.value = list
        if (!list.some((m) => m.id === selectedModelId.value)) {
          selectedModelId.value = list[0].id
          setItem('selectedModel', list[0].id)
        }
      }
    } finally {
      modelsLoaded.value = true
    }
  }

  async function loadDatasets() {
    try {
      const list = await listDatasets()
      datasets.value = list
      if (list.length && (!selectedDatasetIds.value || !selectedDatasetIds.value.length)) {
        selectedDatasetIds.value = list.map((d) => d.id)
        setItem('selectedDatasets', selectedDatasetIds.value)
      }
    } finally {
      datasetsLoaded.value = true
    }
  }

  function setModel(id) {
    selectedModelId.value = id
    setItem('selectedModel', id)
  }

  function setModelParams(params) {
    modelParams.value = { ...modelParams.value, ...params }
    setItem('modelParams', modelParams.value)
  }

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
    modelParams,
    useDataset,
    selectedDatasetIds,
    compareMode,
    compareModelIds,
    loadModels,
    loadDatasets,
    setModel,
    setModelParams,
    setUseDataset,
    setDatasetIds,
    toggleCompare,
    setCompareModels,
    currentModel,
  }
})
