/** 平台可用模型（与 ai-gateway config/models.yaml 中智谱路由对齐） */
import { DEFAULT_SCENARIO_ID, getScenarioPreset } from './scenario-presets'

export const ALLOWED_MODEL_IDS = ['glm-4.7-flash', 'glm-4', 'glm-5.1']

export const ALL_MODEL_IDS = [...ALLOWED_MODEL_IDS]

export const DEFAULT_MODEL_ID = 'glm-4.7-flash'

export const MODELS = [
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    vendor: '智谱',
    icon: 'G',
    multimodal: false,
    upstreamModel: 'glm-4.7-flash',
  },
  {
    id: 'glm-4',
    name: 'GLM-4',
    vendor: '智谱',
    icon: 'G',
    multimodal: false,
    upstreamModel: 'glm-4',
  },
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    vendor: '智谱',
    icon: 'G',
    multimodal: false,
    upstreamModel: 'glm-5.1',
  },
]

export { DEFAULT_SCENARIO_ID }
export const DEFAULT_MODEL_PARAMS = { ...getScenarioPreset(DEFAULT_SCENARIO_ID).params }
