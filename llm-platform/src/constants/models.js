/** 平台可用模型（当前仅接入智谱 GLM-5.1） */
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

export const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  maxTokens: 2048,
  contextWindow: 10,
}
