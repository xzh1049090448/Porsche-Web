import { mockApi } from './mock'
import request, { authSession, authTransport, USE_MOCK } from './request'
import { sessionRows, validateLoginResponse } from './auth-session'

const PREFIX = '/api/v1/auth'
const headers = token => token ? { Authorization: `Bearer ${token}` } : {}
const post = async (path, body, token) => (await authTransport.post(`${PREFIX}${path}`, body, { headers: headers(token) })).data

/** Registration does not set a refresh cookie or establish a session. */
export const register = payload => { authSession.requireAvailable(); return USE_MOCK ? Promise.resolve({ message: '注册成功，请登录' }) : post('/register', payload) }
export const login = payload => authSession.cookieOperation('login', () => USE_MOCK ? mockApi.loginUsername(payload) : post('/login', payload), { identityChange: true })
export const refreshSession = () => authSession.ensureSession()
export const getSelf = () => request.get(`${PREFIX}/self`)

function expired(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 <= Date.now() }
  catch { return !token }
}
/** One explicit pre-logout refresh is allowed, inside the same cookie lock. Never replay logout. */
export const logout = () => authSession.logout(async token => {
  if (USE_MOCK) return
  if (expired(token)) token = validateLoginResponse(await post('/refresh')).access_token
  return post('/logout', undefined, token)
})
export async function listSessions() { if (USE_MOCK) return [{ guid: '903496573054181376', current: true, loginMethod: 'mock', userAgent: '本地演示' }]; return sessionRows((await request.get(`${PREFIX}/sessions`))?.data) }
export const revokeSession = (guid, current = false) => authSession.cookieOperation('revoke-session',
  async token => USE_MOCK ? undefined : (await authTransport.delete(`${PREFIX}/sessions/${encodeURIComponent(guid)}`, { headers: headers(token) })).data,
  { identityChange: current, clear: current })
export const revokeOtherSessions = () => authSession.cookieOperation('revoke-others', token => USE_MOCK ? undefined : post('/sessions/revoke-others', undefined, token))
export const changePassword = data => authSession.cookieOperation('password', token => USE_MOCK ? undefined : post('/self/password', {
  old_password: data.oldPassword, new_password: data.newPassword,
}, token), { identityChange: true, clear: true })
