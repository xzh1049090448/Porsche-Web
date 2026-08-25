/** Maps stable local platform API fields to view state. */
import { enrichMessage } from './multi-model-message.js'

function mapUnixMilliseconds(value) {
  if (value == null) return null
  return typeof value === 'number' ? value : Number(value)
}

function mapGuid(value) {
  return typeof value === 'string' && value.trim() ? value : null
}

export function mapUserProfile(raw) {
  if (!raw) return null
  return { guid: mapGuid(raw.guid), phone: raw.phone, nickname: raw.nickname, verified: raw.is_verified, plan: raw.plan_type, totalTokensUsed: raw.total_tokens_used, dailyCallsUsed: raw.daily_calls_used, dailyCallLimit: raw.daily_call_limit, createdAt: mapUnixMilliseconds(raw.created_at) }
}

export function mapUsageStats(raw) {
  return { totalTokens: raw.total_tokens_used, dailyCallsUsed: raw.daily_calls_used, dailyLimit: raw.daily_call_limit, remainingQuota: raw.remaining_daily_calls, plan: raw.plan_type }
}

export function mapConversation(raw) {
  return { guid: mapGuid(raw.guid), title: raw.title, model: raw.model, createdAt: mapUnixMilliseconds(raw.created_at), updatedAt: mapUnixMilliseconds(raw.updated_at), messages: (raw.messages || []).map(mapMessage) }
}

export function mapMessage(raw) {
  return enrichMessage({ guid: mapGuid(raw.guid), role: raw.role, content: raw.content, model: raw.model, tokens: raw.tokens, createdAt: mapUnixMilliseconds(raw.created_at) })
}

export function mapOrder(raw) {
  return { guid: mapGuid(raw.guid), orderNo: raw.order_no, plan: raw.plan_type, amount: raw.amount, status: raw.status, invoiceRequested: raw.invoice_requested, createdAt: mapUnixMilliseconds(raw.created_at), paidAt: mapUnixMilliseconds(raw.paid_at) }
}

export function mapPlan(raw) {
  return { id: raw.plan_type, name: raw.name, price: raw.price, dailyCallLimit: raw.daily_call_limit, description: raw.description, features: raw.features || [], recommended: raw.plan_type === 'professional' }
}
