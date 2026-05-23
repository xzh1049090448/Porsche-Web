import request, { USE_MOCK } from './request'
import { mockApi } from './mock'
import { mapOrder, mapPlan } from '@/utils/api-mapper'
import { getUsageStats } from './users'

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

export async function payOrder(orderId) {
  if (USE_MOCK) return mockApi.payOrder(orderId)
  const raw = await request.post(`${PREFIX}/orders/${orderId}/pay`)
  return mapOrder(raw)
}

/** 创建订单并支付（一键购买） */
export async function purchaseAndPay(planType) {
  const order = await createOrder(planType)
  if (order.status === 'paid') return order
  return payOrder(order.id)
}

export function applyInvoice(orderId) {
  if (USE_MOCK) return Promise.resolve({ message: '发票申请已提交', order_no: `ORD${orderId}` })
  return request.post(`${PREFIX}/invoice`, { order_id: orderId })
}
