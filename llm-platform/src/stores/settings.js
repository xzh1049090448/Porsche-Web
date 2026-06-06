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

/** 以后端 /platform/models 为准合并；界面始终展示 ALLOWED_MODEL_IDS 中的模型 */
function mergePlatformModels(remoteList) {
  const byId = new Map((remoteList || []).map((m) => [m.id, m]))
  return ALLOWED_MODEL_IDS.map((id) => {
    const local = MODELS.find((m) => m.id === id)
    if (!local) return null
    const remote = byId.get(id)
    return {
      ...local,
      ...(remote || {}),
      name: local.name,
      registered: remote ? remote.registered !== false : false,
    }
  }).filter(Boolean)
}

export const useSettingsStore = defineStore('settings', () => {
  const models = ref(mergePlatformModels([]))
  const modelsLoaded = ref(false)

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
        const list = await listModels()
        models.value = mergePlatformModels(list)
        const missing = ALLOWED_MODEL_IDS.filter((id) => !list.some((m) => m.id === id))
        if (missing.length) {
          const { ElMessage } = await import('element-plus')
          ElMessage.warning(
            `网关未注册模型：${missing.join('、')}，请检查 models.yaml 并热加载后刷新`
          )
        }
        if (!models.value.some((m) => m.id === selectedModelId.value)) {
          const fallback =
            models.value.find((m) => m.id === DEFAULT_MODEL_ID)?.id ||
            models.value[0]?.id ||
            DEFAULT_MODEL_ID
          selectedModelId.value = fallback
          setItem('selectedModel', fallback)
        }
        if (compareMode.value) {
          const validCompare = compareModelIds.value.filter((id) =>
            models.value.some((m) => m.id === id)
          )
          if (validCompare.length !== compareModelIds.value.length) {
            compareModelIds.value = validCompare.length
              ? validCompare
              : models.value.map((m) => m.id)
            setItem('compareModelIds', compareModelIds.value)
          }
        }
        compareModelIds.value = normalizeCompareIds(
          compareModelIds.value.filter((id) => models.value.some((m) => m.id === id))
        )
        setItem('compareModelIds', compareModelIds.value)
        const registered = models.value.filter((m) => m.registered)
        if (registered.length && !registered.some((m) => m.id === selectedModelId.value)) {
          setModel(registered[0].id)
        }
        modelsLoaded.value = true
      } catch {
        modelsLoaded.value = false
      } finally {
        modelsLoadPromise = null
      }
    })()
    return modelsLoadPromise
  }

  function setModel(id) {
    if (compareMode.value) return
    if (!ALLOWED_MODEL_IDS.includes(id)) return
    const m = models.value.find((x) => x.id === id)
    if (m && m.registered === false) return
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
    const next = normalizeCompareIds(ids).filter((id) => {
      const m = models.value.find((x) => x.id === id)
      return m?.registered !== false
    })
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
    selectedModelId,
    compareMode,
    compareModelIds,
    selectedScenarioId,
    modelParams,
    loadModels,
    setModel,
    setCompareMode,
    setCompareModelIds,
    setScenario,
    setModelParams,
    currentModel,
    compareModels,
  }
})
