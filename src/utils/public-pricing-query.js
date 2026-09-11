const PAGE_SIZES = new Set([20, 50, 100])
const SORTS = new Set(['default', 'name', 'input', 'output'])
const DIRECTIONS = new Set(['asc', 'desc'])
const text = value => typeof value === 'string' ? value.trim() : ''
const scalar = value => Array.isArray(value) ? value[0] : value
const integer = value => /^\d+$/.test(String(value ?? '')) ? Number(value) : NaN

export function canonicalPricingQuery(raw = {}) {
  const page = integer(scalar(raw.page))
  const pageSize = integer(scalar(raw.pageSize ?? raw.page_size))
  const sort = text(scalar(raw.sort))
  const direction = text(scalar(raw.direction))
  return {
    search: text(scalar(raw.search)), provider: text(scalar(raw.provider)), capability: text(scalar(raw.capability)), endpoint: text(scalar(raw.endpoint)), group: text(scalar(raw.group)),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.has(pageSize) ? pageSize : 20,
    sort: SORTS.has(sort) ? sort : 'default', direction: DIRECTIONS.has(direction) ? direction : 'asc',
  }
}

export function pricingAPIQuery(raw = {}) {
  const query = canonicalPricingQuery(raw)
  const sort = ({ input: 'input_price', output: 'output_price' })[query.sort] || query.sort
  return Object.fromEntries(Object.entries({ search: query.search, provider: query.provider, capability: query.capability, endpointType: query.endpoint, publicDisplayGroup: query.group, pricingType: 'token', page: query.page, pageSize: query.pageSize, sort, order: query.direction }).filter(([, value]) => value !== ''))
}

export function pricingQueryString(raw = {}) {
  const query = canonicalPricingQuery(raw); const params = new URLSearchParams()
  for (const key of ['search', 'provider', 'capability', 'endpoint', 'group']) if (query[key]) params.set(key, query[key])
  params.set('page', String(query.page)); params.set('pageSize', String(query.pageSize)); params.set('sort', query.sort); params.set('direction', query.direction)
  return params.toString()
}

export function canonicalPricingRouteQuery(raw = {}) {
  return Object.fromEntries(new URLSearchParams(pricingQueryString(raw)))
}

export function isCanonicalPricingRouteQuery(raw = {}) {
  const keys = Object.keys(raw)
  if (keys.some(key => Array.isArray(raw[key]))) return false
  const canonical = canonicalPricingRouteQuery(raw)
  return keys.length === Object.keys(canonical).length && Object.entries(canonical).every(([key, value]) => raw[key] === value)
}

export function applyPricingPresentation(models, raw = {}) {
  canonicalPricingQuery(raw)
  return Array.isArray(models) ? [...models] : []
}

export function publicPricingAuthOptions(auth) {
  if (!auth || auth.state() !== 'authenticated' || !auth.accessToken()) return { authenticated: false }
  return { authenticated: true, authContext: auth.capture() }
}

export async function loadPricingAuthSession(required, loadAuth) {
  if (!required) return null
  try {
    const auth = (await loadAuth())?.authSession
    if (!auth || typeof auth.ensureSession !== 'function' || !await auth.ensureSession()) return null
    return auth.state() === 'authenticated' && auth.accessToken() ? auth : null
  } catch { return null }
}

export function publicPriceState(model, component) {
  if (model?.priceVisibility === 'authenticated_only') return { state: 'login_required' }
  const value = component === 'input' ? model?.inputPrice : model?.outputPrice
  return value === undefined ? { state: 'unpublished' } : { state: 'published', value }
}
