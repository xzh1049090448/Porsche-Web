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
const request = axios.create(options)
installAuthInterceptors(request, authSession, { onUnauthorized: () => handleUnauthorized(), onError: error => ElMessage.error(authErrorMessage(error)) })
export function getAuthToken() { return authSession.accessToken() }
export function authenticatedFetch(input, init = {}) {
  return runAuthenticatedFetch(authSession, input, { credentials: 'include', ...init }, { onUnauthorized: () => handleUnauthorized() })
}
export default request
