import request, { USE_MOCK } from './request'
import { mockApi } from './mock'
import { mapOrder, mapPlan } from '@/utils/platform-mappers'
import { getUsageStats } from './users'
import { requiredGuid } from './guid'

const PREFIX = '/api/v1/billing'

export { getUsageStats }

export async function getPlans() {
  if (USE_MOCK) {
    const res = await mockApi.getPlans()
    return {
      plans: res.plans,
      currentPlan: res.currentPlan,
    }
  }
  const res = await request.get(`${PREFIX}/plans`)
  return {
    plans: (res.plans || []).map(mapPlan),
    currentPlan: res.current_plan,
  }
}

export async function getOrders() {
  if (USE_MOCK) return mockApi.getOrders()
  const res = await request.get(`${PREFIX}/orders`)
  return (res.items || []).map(mapOrder)
}

export async function createOrder(planType) {
  if (USE_MOCK) return mockApi.purchasePlan(planType)
  const raw = await request.post(`${PREFIX}/orders`, { plan_type: planType })
  return mapOrder(raw)
}

export async function payOrder(orderGuid) {
  const guid = requiredGuid(orderGuid, 'order GUID')
  if (USE_MOCK) return mockApi.payOrder(guid)
  const raw = await request.post(`${PREFIX}/orders/${encodeURIComponent(guid)}/pay`)
  return mapOrder(raw)
}

/** 创建订单并支付（一键购买） */
export async function purchaseAndPay(planType) {
  const order = await createOrder(planType)
  if (order.status === 'paid') return order
  return payOrder(order.guid)
}

export function applyInvoice(orderGuid) {
  const guid = requiredGuid(orderGuid, 'order GUID')
  if (USE_MOCK) return Promise.resolve({ message: '发票申请已提交', order_no: `ORD${guid}` })
  return request.post(`${PREFIX}/invoice`, { order_guid: guid })
}
