/** 国内主流大模型配置 */
export const MODELS = [
  { id: 'qwen', name: '通义千问', vendor: '阿里', icon: 'Q', multimodal: true },
  { id: 'ernie', name: '文心一言', vendor: '百度', icon: 'E', multimodal: true },
  { id: 'hunyuan', name: '混元', vendor: '腾讯', icon: 'H', multimodal: false },
  { id: 'doubao', name: '豆包', vendor: '字节', icon: 'D', multimodal: true },
  { id: 'deepseek', name: 'DeepSeek', vendor: '深度求索', icon: 'S', multimodal: false },
  { id: 'glm', name: '智谱清言', vendor: '智谱', icon: 'G', multimodal: true },
  { id: 'moonshot', name: 'Moonshot', vendor: '月之暗面', icon: 'M', multimodal: false },
  { id: 'yi', name: '零一万物 Yi', vendor: '零一万物', icon: 'Y', multimodal: false },
]

export const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  maxTokens: 2048,
  contextWindow: 10,
}
