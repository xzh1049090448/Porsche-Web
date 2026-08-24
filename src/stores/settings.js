import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getItem, setItem } from '@/utils/storage'
import { DEFAULT_SCENARIO_ID, SCENARIO_PRESETS, getScenarioPreset } from '@/constants/scenario-presets'
import { getModel, listModels } from '@/api/platform'
import { chooseAvailableModel, chooseCompareModels } from '@/utils/model-catalog'

function readInitialModelState() {
  const storedCompareMode = getItem('compareMode', null)
  const storedCompareIds = getItem('compareModelIds', null)
  const storedMulti = getItem('selectedModels', null)
  const legacySingle = getItem('selectedModel', '')

  let selectedModelId = typeof legacySingle === 'string' ? legacySingle : ''
  let compareMode = false
  let compareModelIds = []

  if (storedCompareMode !== null) {
    compareMode = !!storedCompareMode
  } else if (Array.isArray(storedMulti) && storedMulti.length > 1) {
    compareMode = true
    compareModelIds = storedMulti
    selectedModelId = storedMulti[0]
  }

  if (Array.isArray(storedCompareIds) && storedCompareIds.length) {
    compareModelIds = storedCompareIds
  }

  return { selectedModelId, compareMode, compareModelIds }
}

export const useSettingsStore = defineStore('settings', () => {
  const models = ref([])
  const modelsLoaded = ref(false)
  const catalogStale = ref(false)
  const modelLoadError = ref(false)

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

  let modelsLoadPromise = null

  async function loadModels() {
    if (modelsLoaded.value) return
    if (modelsLoadPromise) return modelsLoadPromise
    modelsLoadPromise = (async () => {
      try {
        const catalog = await listModels()
        models.value = catalog.models
        catalogStale.value = catalog.catalogStale
        modelLoadError.value = false
        selectedModelId.value = chooseAvailableModel(selectedModelId.value, models.value)
        compareModelIds.value = chooseCompareModels(compareModelIds.value, models.value)
        if (compareMode.value && compareModelIds.value.length === 0) compareMode.value = false
        setItem('selectedModel', selectedModelId.value)
        setItem('compareModelIds', compareModelIds.value)
        modelsLoaded.value = true
      } catch {
        modelsLoaded.value = false
        modelLoadError.value = true
      } finally {
        modelsLoadPromise = null
      }
    })()
    return modelsLoadPromise
  }

  function setModel(id) {
    if (compareMode.value) return
    if (!models.value.some((model) => model.id === id)) return
    selectedModelId.value = id
    setItem('selectedModel', id)
    void loadModelDetail(id)
  }

  /** Refreshes metadata for an already-authorized dynamic catalog model. */
  async function loadModelDetail(id) {
    if (!models.value.some((model) => model.id === id)) return null
    try {
      const detail = await getModel(id)
      if (!detail) return null
      const index = models.value.findIndex((model) => model.id === id)
      if (index >= 0) models.value[index] = { ...models.value[index], ...detail }
      return detail
    } catch {
      return null
    }
  }

  function setCompareMode(val) {
    if (models.value.length < 2) {
      compareMode.value = false
      setItem('compareMode', false)
      return
    }
    compareMode.value = val
    setItem('compareMode', val)
    if (val && compareModelIds.value.length < 2) {
      const next = chooseCompareModels([selectedModelId.value, ...models.value.map((model) => model.id)], models.value)
      compareModelIds.value = next
      setItem('compareModelIds', compareModelIds.value)
    }
  }

  function setCompareModelIds(ids) {
    const next = chooseCompareModels(ids, models.value)
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

  const currentModel = () => models.value.find((m) => m.id === selectedModelId.value)

  const compareModels = () =>
    compareModelIds.value
      .map((id) => models.value.find((m) => m.id === id))
      .filter(Boolean)

  return {
    models,
    modelsLoaded,
    catalogStale,
    modelLoadError,
    selectedModelId,
    compareMode,
    compareModelIds,
    selectedScenarioId,
    modelParams,
    loadModels,
    loadModelDetail,
    setModel,
    setCompareMode,
    setCompareModelIds,
    setScenario,
    setModelParams,
    currentModel,
    compareModels,
  }
})
