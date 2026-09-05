import axios from 'axios'
import { createSessionRefresh } from './auth-refresh.js'
import { installAuthInterceptors } from './auth-request-policy.js'
import { ElMessage } from 'element-plus'
import { authenticatedFetch as runAuthenticatedFetch, createAuthSessionManager } from './auth-session.js'
import { createBrowserAuthAdapter } from './auth-browser.js'
import { authErrorMessage } from './auth-errors.js'

const env = import.meta.env ?? {}
export const USE_MOCK = env.VITE_USE_MOCK === 'true'
const options = { baseURL: env.VITE_API_BASE ?? '', timeout: 120000, withCredentials: true }
const handleUnauthorized = async () => (await import('../utils/auth-redirect.js')).handleUnauthorized()
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
export function createAdminActionRequest({ auth, baseURL = '', fetchImpl = fetch, axiosOptions = {}, onUnauthorized = handleUnauthorized }) {
  // Sensitive action POSTs acquire the current bearer but have no response
  // interceptor, so a 401 or network ambiguity can never replay the mutation.
  const transport = axios.create({ baseURL, timeout: 120000, withCredentials: true, ...axiosOptions })
  installBearerInterceptor(transport, auth)
  return Object.freeze({
    transport,
    async post(path, body, config) {
      const response = await transport.post(path, body, config)
      return { data: response.data, status: response.status, headers: response.headers }
    },
    async query(path, headers) {
      const response = await runAuthenticatedFetch(auth, `${baseURL}${path}`, { method: 'GET', headers, credentials: 'include' }, { fetchImpl, onUnauthorized })
      let data
      try { data = await response.json() } catch { data = null }
      if (!response.ok) throw { response: { status: response.status, data, headers: response.headers } }
      return { data, status: response.status, headers: response.headers }
    },
  })
}
const adminActionRequest = createAdminActionRequest({ auth: authSession, baseURL: options.baseURL, axiosOptions: options })
export const adminActionTransport = adminActionRequest.transport
export const adminActionPost = adminActionRequest.post
export const adminActionQuery = adminActionRequest.query
const request = axios.create(options)
installAuthInterceptors(request, authSession, { onUnauthorized: () => handleUnauthorized(), onError: error => ElMessage.error(authErrorMessage(error)) })
export function getAuthToken() { return authSession.accessToken() }
export function authenticatedFetch(input, init = {}) {
  return runAuthenticatedFetch(authSession, input, { credentials: 'include', ...init }, { onUnauthorized: () => handleUnauthorized() })
}
export default request
