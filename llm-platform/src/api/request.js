import axios from 'axios'
import { ElMessage } from 'element-plus'
import { getItem } from '@/utils/storage'

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
    if (err.response?.status === 401) {
      // 由路由守卫处理未登录，避免重复弹窗
    } else {
      ElMessage.error(formatError(err))
    }
    return Promise.reject(err)
  }
)

export function getAuthToken() {
  return getItem('token')
}

export default request
