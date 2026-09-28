import request, { authenticatedFetch } from './request'

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
  if (params.user_guid != null) q.user_guid = params.user_guid
  return q
}

function withParams(path, params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else if (value != null) query.set(key, value)
  })
  const encoded = query.toString()
  return encoded ? `${path}?${encoded}` : path
}

export async function checkAccess() {
  try {
    const baseURL = import.meta.env.VITE_API_BASE ?? ''
    const res = await authenticatedFetch(`${baseURL}${PREFIX}/access`)
    if (res.status === 200) return res.json()
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
  const res = await authenticatedFetch(withParams(`${baseURL}${PREFIX}/export`, { ...buildParams(params), view }))
  if (!res.ok) throw new Error('analytics export failed')
  let filename = `model-analytics-${view}.xlsx`
  const disposition = res.headers.get('content-disposition')
  if (disposition) {
    const match = /filename\*?=(?:UTF-8''|"?)([^";]+)/i.exec(disposition)
    if (match) filename = decodeURIComponent(match[1].replace(/"/g, ''))
  }
  return { blob: await res.blob(), filename }
}
