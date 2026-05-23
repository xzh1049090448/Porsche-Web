/** 开发环境 Mock：设置 VITE_USE_MOCK=true 启用 */
import { getItem, setItem } from '@/utils/storage'
import { MODELS } from '@/constants/models'
import { DATASETS, DATASET_BADGE_TEXT } from '@/constants/datasets'
import { PLANS } from '@/constants/plans'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

const MOCK_RESPONSES = {
  default:
    '您好！我是国内大模型聚合平台的 AI 助手。您可以切换不同模型、加载跨境电商专属数据集，获得更精准的行业回答。',
  cross_border:
    '根据跨境电商专属数据集检索结果：亚马逊 FBA 商品标题建议控制在 200 字符以内，核心关键词前置，避免促销性词汇。',
  compare: (modelName) => `【${modelName}】针对您的问题，结合通用知识库给出参考回答。（演示模式）`,
}

function ensureConvStore() {
  if (!getItem('conversations')) setItem('conversations', [])
}

export const mockApi = {
  async loginSms({ phone, code }) {
    await delay(600)
    if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确')
    if (code !== '123456') throw new Error('验证码错误（演示环境请输入 123456）')
    const token = 'mock_token_' + genId()
    setItem('user', {
      id: 1,
      phone,
      nickname: `用户${phone.slice(-4)}`,
      verified: false,
      plan: 'free',
    })
    return { access_token: token, user_id: 1, plan_type: 'free' }
  },

  async loginPassword({ account, password }) {
    await delay(600)
    if (!account || password !== 'demo123') {
      throw new Error('账号或密码错误（演示：手机号 + 密码 demo123）')
    }
    const token = 'mock_token_' + genId()
    setItem('user', {
      id: 1,
      phone: account,
      nickname: account.slice(-4),
      verified: true,
      plan: 'professional',
    })
    return { access_token: token, user_id: 1, plan_type: 'professional' }
  },

  async sendSms(phone) {
    await delay(400)
    if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确')
    return { message: '验证码已发送', dev_code: '123456' }
  },

  async getProfile() {
    await delay(200)
    return getItem('user')
  },

  async updateProfile(data) {
    await delay(300)
    const user = { ...getItem('user'), ...data }
    setItem('user', user)
    return user
  },

  async realNameVerify({ name, idCard }) {
    await delay(800)
    if (!name || !idCard || idCard.length < 15) throw new Error('请填写正确的实名信息')
    const user = { ...getItem('user'), verified: true, realName: name }
    setItem('user', user)
    return user
  },

  async getUsage() {
    await delay(200)
    return {
      totalTokens: 128450,
      datasetCalls: 342,
      remainingQuota: 68,
      dailyLimit: 100,
      plan: getItem('user')?.plan || 'free',
    }
  },

  async getPlans() {
    await delay(200)
    return {
      plans: PLANS.map((p) => {
        const id = p.id === 'pro' ? 'professional' : p.id
        return {
          id,
          name: p.name,
          price: p.price ?? 0,
          dailyCallLimit: id === 'free' ? 100 : null,
          description: p.quota,
          features: p.features,
          recommended: !!p.recommended,
        }
      }),
      currentPlan: getItem('user')?.plan || 'free',
    }
  },

  async getOrders() {
    await delay(200)
    return [
      {
        id: 1,
        orderNo: 'ORD001',
        plan: 'professional',
        amount: 99,
        status: 'paid',
        invoiceRequested: false,
        createdAt: Date.now() - 86400000 * 5,
        paidAt: Date.now() - 86400000 * 5,
      },
    ]
  },

  async purchasePlan(planType) {
    await delay(500)
    const user = { ...getItem('user'), plan: planType }
    setItem('user', user)
    return {
      id: Date.now(),
      orderNo: 'ORD' + genId(),
      plan: planType,
      amount: 99,
      status: 'pending',
      invoiceRequested: false,
      createdAt: Date.now(),
      paidAt: null,
    }
  },

  async payOrder(orderId) {
    await delay(300)
    const user = getItem('user')
    setItem('user', { ...user, plan: 'professional' })
    return {
      id: orderId,
      orderNo: 'ORD' + orderId,
      plan: 'professional',
      amount: 99,
      status: 'paid',
      invoiceRequested: false,
      createdAt: Date.now(),
      paidAt: Date.now(),
    }
  },

  async listConversations() {
    ensureConvStore()
    const items = getItem('conversations', [])
    return { items, total: items.length }
  },

  async createConversation(body) {
    ensureConvStore()
    const conv = {
      id: genId(),
      title: body.title || '新对话',
      model: body.model,
      datasetEnabled: body.datasetEnabled,
      datasetIds: body.datasetIds,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const list = getItem('conversations', [])
    list.unshift(conv)
    setItem('conversations', list)
    return conv
  },

  async getConversation(id) {
    const list = getItem('conversations', [])
    const c = list.find((x) => x.id === id)
    if (!c) throw new Error('对话不存在')
    return c
  },

  async renameConversation(id, title) {
    const list = getItem('conversations', [])
    const c = list.find((x) => x.id === id)
    if (c) {
      c.title = title
      c.updatedAt = Date.now()
      setItem('conversations', list)
    }
    return c
  },

  async deleteConversation(id) {
    const list = getItem('conversations', []).filter((c) => c.id !== id)
    setItem('conversations', list)
  },

  async streamChat({ modelId, content, useDataset, datasetIds, onChunk, onDone, onMeta }) {
    const model = MODELS.find((m) => m.id === modelId)
    const useCross = useDataset && datasetIds?.length
    if (onMeta) {
      onMeta({
        datasetUsed: useCross,
        datasetBadge: useCross ? DATASET_BADGE_TEXT : null,
      })
    }
    let text = useCross ? MOCK_RESPONSES.cross_border : MOCK_RESPONSES.default
    text = `【${model?.name || modelId}】${text}\n\n（演示模式）`
    for (let i = 0; i < text.length; i++) {
      await delay(18 + Math.random() * 12)
      onChunk(text[i])
    }
    onDone({
      datasetUsed: useCross,
      datasetBadge: DATASET_BADGE_TEXT,
      tokens: Math.ceil(text.length * 1.2),
    })
  },

  async compareModels({ modelIds, content, onModelChunk }) {
    for (const id of modelIds) {
      const model = MODELS.find((m) => m.id === id)
      const text = MOCK_RESPONSES.compare(model?.name || id) + `\n\n${content.slice(0, 80)}...`
      let acc = ''
      for (const ch of text) {
        await delay(12)
        acc += ch
        onModelChunk(id, acc)
      }
    }
  },
}
