import request, { USE_MOCK } from './request'
import { mockApi } from './mock'
import { getProfile } from './users'

const PREFIX = '/api/v1/auth'

export function sendSmsCode(phone) {
  if (USE_MOCK) return mockApi.sendSms(phone)
  return request.post(`${PREFIX}/send-code`, { phone })
}

/** 验证码登录 */
export function loginByCode({ phone, code }) {
  if (USE_MOCK) return mockApi.loginSms({ phone, code })
  return request.post(`${PREFIX}/login/code`, { phone, code })
}

/** 密码登录（后端仅支持手机号） */
export function loginByPassword({ phone, password }) {
  if (USE_MOCK) return mockApi.loginPassword({ account: phone, password })
  return request.post(`${PREFIX}/login/password`, { phone, password })
}

export function register({ phone, code, password, nickname }) {
  if (USE_MOCK) return mockApi.loginSms({ phone, code })
  return request.post(`${PREFIX}/register`, { phone, code, password, nickname })
}

/** 登录后拉取用户信息 */
export async function loginAndLoadProfile(loginFn, payload) {
  const tokenRes = await loginFn(payload)
  const { setItem } = await import('@/utils/storage')
  setItem('token', tokenRes.access_token)
  const profile = await getProfile()
  return {
    token: tokenRes.access_token,
    user: profile,
    userId: tokenRes.user_id,
    planType: tokenRes.plan_type,
  }
}
