import axios from 'axios'
import request from './request'
import { getItem } from '@/utils/storage'

const PREFIX = '/api/v1/billing/analytics'

function buildParams(params = {}) {
  const q = {}
  if (params.start_at && params.end_at) {
    q.start_at = params.start_at
    q.end_at = params.end_at
  } else if (params.range) {
    q.range = params.range
  }
  if (params.granularity) q.granularity = params.granularity
  if (params.models) q.models = params.models
  if (params.top_n != null) q.top_n = params.top_n
  if (params.user_id != null) q.user_id = params.user_id
  return q
}

export async function checkAccess() {
  try {
    const baseURL = import.meta.env.VITE_API_BASE ?? ''
    const token = getItem('token')
    const res = await axios.get(`${baseURL}${PREFIX}/access`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      validateStatus: (status) => status < 500,
    })
    if (res.status === 200) return res.data
    return { allowed: false }
  } catch {
    return { allowed: false }
  }
}

export function getSummary(params) {
  return request.get(`${PREFIX}/summary`, { params: buildParams(params) })
}

export function getModels(params) {
  return request.get(`${PREFIX}/models`, { params: buildParams(params) })
}

export function getChart(view, params) {
  return request.get(`${PREFIX}/charts/${view}`, { params: buildParams(params) })
}

export async function exportExcel(view, params) {
  const baseURL = import.meta.env.VITE_API_BASE ?? ''
  const token = getItem('token')
  const res = await axios.get(`${baseURL}${PREFIX}/export`, {
    params: { ...buildParams(params), view },
    responseType: 'blob',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  let filename = `model-analytics-${view}.xlsx`
  const disposition = res.headers['content-disposition']
  if (disposition) {
    const match = /filename\*?=(?:UTF-8''|"?)([^";]+)/i.exec(disposition)
    if (match) filename = decodeURIComponent(match[1].replace(/"/g, ''))
  }
  return { blob: res.data, filename }
}
