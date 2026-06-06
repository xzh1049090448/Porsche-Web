/** 平台可用模型（与 ai-gateway platform_models、models.yaml 对齐） */
import { DEFAULT_SCENARIO_ID, getScenarioPreset } from './scenario-presets'

export const ALLOWED_MODEL_IDS = [
  'glm-5.1',
  'glm-4.5-air',
  'glm-4.7-flash',
  'deepseek-v4-flash',
]

export const ALL_MODEL_IDS = [...ALLOWED_MODEL_IDS]

export const DEFAULT_MODEL_ID = 'glm-4.5-air'

export const MODEL_TYPE_TAGS = {
  chat: { label: '对话', color: 'var(--tag-chat)' },
  multimodal: { label: '多模态', color: 'var(--tag-multimodal)' },
  image: { label: '图片', color: 'var(--tag-image)' },
  video: { label: '视频', color: 'var(--tag-video)' },
}

export const MODELS = [
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    vendor: '智谱',
    desc: '智谱旗舰对话模型，综合能力强',
    icon: 'G',
    type: 'chat',
    multimodal: false,
    upstreamModel: 'glm-5.1',
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5 Air',
    vendor: '智谱',
    desc: '轻量高效，适合日常对话',
    icon: 'G',
    type: 'chat',
    multimodal: false,
    upstreamModel: 'glm-4.5-air',
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    vendor: '智谱',
    desc: '极速响应，低成本推理',
    icon: 'G',
    type: 'chat',
    multimodal: false,
    upstreamModel: 'glm-4.7-flash',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    vendor: 'DeepSeek',
    desc: 'DeepSeek 高速对话模型',
    icon: 'D',
    type: 'chat',
    multimodal: false,
    upstreamModel: 'deepseek-v4-flash',
  },
]

export { DEFAULT_SCENARIO_ID }
export const DEFAULT_MODEL_PARAMS = { ...getScenarioPreset(DEFAULT_SCENARIO_ID).params }
