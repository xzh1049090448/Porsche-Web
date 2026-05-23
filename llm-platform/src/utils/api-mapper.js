/** 将后端字段映射为前端使用的结构 */

export function mapUserProfile(raw) {
  if (!raw) return null
  return {
    id: raw.id,
    phone: raw.phone,
    nickname: raw.nickname,
    verified: raw.is_verified,
    plan: raw.plan_type,
    totalTokensUsed: raw.total_tokens_used,
    datasetCalls: raw.dataset_calls,
    dailyCallsUsed: raw.daily_calls_used,
    dailyCallLimit: raw.daily_call_limit,
    createdAt: raw.created_at,
  }
}

export function mapUsageStats(raw) {
  return {
    totalTokens: raw.total_tokens_used,
    datasetCalls: raw.dataset_calls,
    dailyCallsUsed: raw.daily_calls_used,
    dailyLimit: raw.daily_call_limit,
    remainingQuota: raw.remaining_daily_calls,
    plan: raw.plan_type,
  }
}

export function mapConversation(raw) {
  return {
    id: raw.id,
    title: raw.title,
    model: raw.model,
    datasetEnabled: raw.dataset_enabled,
    datasetIds: raw.dataset_ids || [],
    createdAt: new Date(raw.created_at).getTime(),
    updatedAt: new Date(raw.updated_at).getTime(),
    messages: (raw.messages || []).map(mapMessage),
  }
}

export function mapMessage(raw) {
  return {
    id: raw.id,
    role: raw.role,
    content: raw.content,
    model: raw.model,
    datasetUsed: raw.dataset_used,
    datasetBadge: raw.dataset_attribution,
    tokens: raw.tokens,
    createdAt: new Date(raw.created_at).getTime(),
  }
}

export function mapOrder(raw) {
  return {
    id: raw.id,
    orderNo: raw.order_no,
    plan: raw.plan_type,
    amount: raw.amount,
    status: raw.status,
    invoiceRequested: raw.invoice_requested,
    createdAt: new Date(raw.created_at).getTime(),
    paidAt: raw.paid_at ? new Date(raw.paid_at).getTime() : null,
  }
}

export function mapPlan(raw) {
  return {
    id: raw.plan_type,
    name: raw.name,
    price: raw.price,
    dailyCallLimit: raw.daily_call_limit,
    description: raw.description,
    features: raw.features || [],
    recommended: raw.plan_type === 'professional',
  }
}

export function mapDataset(raw) {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    category: raw.category,
    desc: raw.description,
    icon: '🔹',
  }
}

export function mapModel(raw) {
  return {
    id: raw.id,
    name: raw.id,
    vendor: raw.provider || '',
    icon: (raw.id || '?').slice(0, 1).toUpperCase(),
    multimodal: false,
    upstreamModel: raw.upstream_model,
  }
}
