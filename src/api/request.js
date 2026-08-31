import axios from 'axios'
import { ElMessage } from 'element-plus'
import { createAuthSessionManager } from './auth-session'
import { handleUnauthorized, isAuthRequestUrl } from '@/utils/auth-redirect'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const request = axios.create({ baseURL: import.meta.env.VITE_API_BASE ?? '', timeout: 120000, withCredentials: true })

// Only this module attaches the in-memory Access token. Refresh remains an
// HttpOnly cookie that JavaScript neither reads nor writes.
export const authSession = createAuthSessionManager({ refresh: () => request.post('/api/v1/auth/refresh') })

request.interceptors.request.use((config) => {
  const token = authSession.accessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

function formatError(err) {
  const data = err.response?.data
  const detail = data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((d) => d.msg || d.message || JSON.stringify(d)).join('; ')
  return data?.error?.message || data?.message || err.message || '请求失败'
}

request.interceptors.response.use(
  (res) => res.data,
  async (err) => {
    const status = err.response?.status
    const config = err.config || {}
    const url = config.url || ''
    if (status === 401 && !config.__authRetried && !isAuthRequestUrl(url) && authSession.accessToken()) {
      try {
        return await authSession.refreshAndRetry(config, (retryConfig) => request.request(retryConfig))
      } catch {
        await handleUnauthorized(formatError(err))
      }
    } else if (status === 401 && !isAuthRequestUrl(url)) {
      await handleUnauthorized(formatError(err))
    } else if (status !== 401) {
      ElMessage.error(formatError(err))
    }
    return Promise.reject(err)
  },
)

/** Returns the transient Access token for fetch-based streaming requests. */
export function getAuthToken() { return authSession.accessToken() }

export default request
