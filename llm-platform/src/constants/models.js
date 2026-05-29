/** 平台可用模型（与 ai-gateway config/models.yaml 中智谱路由对齐，仅以下三个） */
import { DEFAULT_SCENARIO_ID, getScenarioPreset } from './scenario-presets'

export const ALLOWED_MODEL_IDS = ['glm-5.1', 'glm-4.5-air', 'glm-4.7-flash']

export const ALL_MODEL_IDS = [...ALLOWED_MODEL_IDS]

export const DEFAULT_MODEL_ID = 'glm-4.5-air'

export const MODELS = [
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    vendor: '智谱',
    icon: 'G',
    multimodal: false,
    upstreamModel: 'glm-5.1',
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5 Air',
    vendor: '智谱',
    icon: 'G',
    multimodal: false,
    upstreamModel: 'glm-4.5-air',
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    vendor: '智谱',
    icon: 'G',
    multimodal: false,
    upstreamModel: 'glm-4.7-flash',
  },
]

export { DEFAULT_SCENARIO_ID }
export const DEFAULT_MODEL_PARAMS = { ...getScenarioPreset(DEFAULT_SCENARIO_ID).params }
