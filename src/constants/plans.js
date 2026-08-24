/** 套餐方案 */
export const PLANS = [
  {
    id: 'free',
    name: '免费版',
    price: 0,
    period: '每日',
    quota: '100 次/日',
    features: ['基础模型', '标准响应速度'],
  },
  {
    id: 'pro',
    name: '专业版',
    price: 99,
    period: '月',
    quota: '无限次调用',
    features: ['全模型', '模型对比', '优先响应'],
    recommended: true,
  },
  {
    id: 'enterprise',
    name: '企业版',
    price: null,
    period: '定制',
    quota: '按需定制',
    features: ['API 接口授权', '专属客服', '合规溯源凭证'],
  },
]
