import request, { USE_MOCK } from './request'
import { mockApi } from './mock'
import { mapUserProfile, mapUsageStats } from '@/utils/api-mapper'

const PREFIX = '/api/v1/users'

export async function getProfile() {
  if (USE_MOCK) return mockApi.getProfile()
  const raw = await request.get(`${PREFIX}/me`)
  return mapUserProfile(raw)
}

export async function updateProfile(data) {
  if (USE_MOCK) return mockApi.updateProfile(data)
  const raw = await request.put(`${PREFIX}/me`, {
    nickname: data.nickname,
  })
  return mapUserProfile(raw)
}

export function changePassword(data) {
  if (USE_MOCK) return Promise.resolve({ message: '密码修改成功' })
  return request.post(`${PREFIX}/me/password`, {
    old_password: data.oldPassword,
    new_password: data.newPassword,
  })
}

export function submitRealName(data) {
  if (USE_MOCK) return mockApi.realNameVerify(data)
  return request.post(`${PREFIX}/me/verify`, {
    real_name: data.name,
    id_card: data.idCard,
  })
}

export async function getUsageStats() {
  if (USE_MOCK) return mockApi.getUsage()
  const raw = await request.get(`${PREFIX}/me/usage`)
  return mapUsageStats(raw)
}
