import axios from 'axios'
import { createSessionRefresh } from './auth-refresh'
import { installAuthInterceptors } from './auth-request-policy'
import { ElMessage } from 'element-plus'
import { authenticatedFetch as runAuthenticatedFetch, createAuthSessionManager } from './auth-session'
import { createBrowserAuthAdapter } from './auth-browser'
import { authErrorMessage } from './auth-errors'
import { handleUnauthorized } from '@/utils/auth-redirect'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const options = { baseURL: import.meta.env.VITE_API_BASE ?? '', timeout: 120000, withCredentials: true }
// Cookie operations use a separate transport with no session/retry interceptors.
export const authTransport = axios.create(options)
export const authSession = createAuthSessionManager({
  browser: createBrowserAuthAdapter(),
  refresh: createSessionRefresh({ useMock: USE_MOCK, transport: authTransport }),
})
function installBearerInterceptor(transport, auth) {
  transport.interceptors.request.use(config => {
    const context = auth.capture()
    auth.assertCurrent(context)
    const token = auth.accessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    else delete config.headers.Authorization
    return config
  })
}
// Sensitive action POSTs acquire the current bearer but have no response
// interceptor, so a 401 or network ambiguity can never replay the mutation.
export const adminActionTransport = axios.create(options)
installBearerInterceptor(adminActionTransport, authSession)
const request = axios.create(options)
installAuthInterceptors(request, authSession, { onUnauthorized: () => handleUnauthorized(), onError: error => ElMessage.error(authErrorMessage(error)) })
export function getAuthToken() { return authSession.accessToken() }
export function authenticatedFetch(input, init = {}) {
  return runAuthenticatedFetch(authSession, input, { credentials: 'include', ...init }, { onUnauthorized: () => handleUnauthorized() })
}
export async function adminActionQuery(path, headers) {
  const response = await authenticatedFetch(`${options.baseURL}${path}`, { method: 'GET', headers })
  let data
  try { data = await response.json() } catch { data = null }
  if (!response.ok) throw { response: { status: response.status, data, headers: response.headers } }
  return { data, headers: response.headers }
}
export default request
