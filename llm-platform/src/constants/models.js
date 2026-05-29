/** 平台可用模型（当前仅接入智谱 GLM-5.1） */
import { DEFAULT_SCENARIO_ID, getScenarioPreset } from './scenario-presets'

export const DEFAULT_MODEL_ID = 'glm-5.1'

export const MODELS = [
  {
    id: DEFAULT_MODEL_ID,
    name: 'GLM-5.1',
    vendor: '智谱',
    icon: 'G',
    multimodal: true,
    upstreamModel: 'glm-5.1',
  },
]

export { DEFAULT_SCENARIO_ID }
export const DEFAULT_MODEL_PARAMS = { ...getScenarioPreset(DEFAULT_SCENARIO_ID).params }
