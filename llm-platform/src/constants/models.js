/** 平台可用模型（智谱 GLM 系列） */
import { DEFAULT_SCENARIO_ID, getScenarioPreset } from './scenario-presets'

export const ALLOWED_MODEL_IDS = ['glm-4.7-flash', 'glm-4']

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
    multimodal: true,
    upstreamModel: 'glm-4',
  },
]

export { DEFAULT_SCENARIO_ID }
export const DEFAULT_MODEL_PARAMS = { ...getScenarioPreset(DEFAULT_SCENARIO_ID).params }
