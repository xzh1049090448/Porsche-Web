/** 对话场景预设：一键切换温度 / 最大输出 / 上下文轮数 */
export const SCENARIO_PRESETS = [
  {
    id: 'policy',
    name: '政策查询',
    desc: '回答更稳、更准，适合查平台规则与合规要求',
    params: { temperature: 0.3, maxTokens: 2048, contextWindow: 8 },
  },
  {
    id: 'copywriting',
    name: '文案撰写',
    desc: '表达更灵活，适合写 Listing、广告与客服话术',
    params: { temperature: 0.75, maxTokens: 4096, contextWindow: 10 },
  },
  {
    id: 'analysis',
    name: '深度分析',
    desc: '记住更多轮对话，适合长文解读与多轮改稿',
    params: { temperature: 0.5, maxTokens: 4096, contextWindow: 20 },
  },
]

export const DEFAULT_SCENARIO_ID = 'policy'

export function getScenarioPreset(id) {
  return SCENARIO_PRESETS.find((s) => s.id === id) || SCENARIO_PRESETS[0]
}
