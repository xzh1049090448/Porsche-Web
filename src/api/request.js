import axios from 'axios'
import { ElMessage } from 'element-plus'
import { getItem } from '@/utils/storage'
import { handleUnauthorized, isAuthRequestUrl } from '@/utils/auth-redirect'

/** 默认对接 ai-gateway；开发可用 Mock */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '',
  timeout: 120000,
})

request.interceptors.request.use((config) => {
  const token = getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function formatError(err) {
  const data = err.response?.data
  const detail = data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || d.message || JSON.stringify(d)).join('; ')
  }
  return data?.message || err.message || '请求失败'
}

request.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status
    const url = err.config?.url || ''
    if (status === 401 && !isAuthRequestUrl(url)) {
      handleUnauthorized(formatError(err))
    } else if (status !== 401) {
      ElMessage.error(formatError(err))
    }
    return Promise.reject(err)
  }
)

export function getAuthToken() {
  return getItem('token')
}

export default request
