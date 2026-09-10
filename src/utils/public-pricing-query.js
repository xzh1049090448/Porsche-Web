import { sortPublicModels } from './public-catalog.js'

const PAGE_SIZES = new Set([20, 50, 100])
const SORTS = new Set(['default', 'name', 'input', 'output'])
const DIRECTIONS = new Set(['asc', 'desc'])
const text = value => typeof value === 'string' ? value.trim().slice(0, 120) : ''
const scalar = value => Array.isArray(value) ? value[0] : value

export function canonicalPricingQuery(raw = {}) {
  const page = Number.parseInt(scalar(raw.page), 10)
  const pageSize = Number.parseInt(scalar(raw.pageSize ?? raw.page_size), 10)
  const sort = text(scalar(raw.sort))
  const direction = text(scalar(raw.direction))
  return {
    search: text(scalar(raw.search)), provider: text(scalar(raw.provider)), capability: text(scalar(raw.capability)), endpoint: text(scalar(raw.endpoint)),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.has(pageSize) ? pageSize : 20,
    sort: SORTS.has(sort) ? sort : 'default', direction: DIRECTIONS.has(direction) ? direction : 'asc',
  }
}

export function pricingAPIQuery(raw = {}) {
  const query = canonicalPricingQuery(raw)
  return Object.fromEntries(Object.entries({ search: query.search, provider: query.provider, capability: query.capability, page: query.page, pageSize: query.pageSize }).filter(([, value]) => value !== ''))
}

export function pricingQueryString(raw = {}) {
  const query = canonicalPricingQuery(raw); const params = new URLSearchParams()
  for (const key of ['search', 'provider', 'capability', 'endpoint']) if (query[key]) params.set(key, query[key])
  params.set('page', String(query.page)); params.set('pageSize', String(query.pageSize)); params.set('sort', query.sort); params.set('direction', query.direction)
  return params.toString()
}

export function applyPricingPresentation(models, raw = {}) {
  const query = canonicalPricingQuery(raw)
  let result = Array.isArray(models) ? models.filter(model => !query.endpoint || model.capabilities?.includes(query.endpoint)) : []
  if (query.sort === 'name') result = [...result].sort((a, b) => (a.displayName || a.modelKey).localeCompare(b.displayName || b.modelKey) || a.modelKey.localeCompare(b.modelKey))
  else if (query.sort === 'input' || query.sort === 'output') result = sortPublicModels(result, query.sort, query.direction)
  if (query.sort === 'name' && query.direction === 'desc') result.reverse()
  return result
}
