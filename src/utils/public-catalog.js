const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const BASE_KEYS = ['model_key', 'display_name', 'provider', 'capabilities', 'context_window', 'price_visibility', 'release_version', 'pricing_type', 'endpoint_types', 'updated_at']
const PRICE_KEYS = ['input_price_usd_per_million_tokens', 'output_price_usd_per_million_tokens']
const OPTIONAL_KEYS = ['public_display_group', 'public_restrictions', 'price_source', 'price_reviewer', 'effective_at']
const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/

export const PUBLIC_PRICING = Object.freeze({ currency: 'USD', unit: 'million_tokens', billingSemantics: 'references_only_no_automatic_charge' })
export const PUBLIC_PRICE_DISCLAIMER = '价格仅供参考，不代表自动计费或最终账单。'

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key))
}

function validBase(raw) {
  return typeof raw.model_key === 'string' && MODEL_KEY.test(raw.model_key) && typeof raw.display_name === 'string' && raw.display_name.length > 0 && typeof raw.provider === 'string' && raw.provider.length > 0 && Array.isArray(raw.capabilities) && raw.capabilities.every(item => typeof item === 'string') && new Set(raw.capabilities).size === raw.capabilities.length && Number.isSafeInteger(raw.context_window) && raw.context_window >= 0 && Number.isSafeInteger(raw.release_version) && raw.release_version >= 1
}

function validUTC(value) {
  if (typeof value !== 'string') return false
  const match = RFC3339_UTC.exec(value)
  if (!match) return false
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= days[month - 1]
}

export function mapPublicModel(raw) {
  const visible = raw?.price_visibility === 'visible'
  const required = BASE_KEYS
  const keys = Object.keys(raw || {})
  if (!required.every(key => keys.includes(key)) || keys.some(key => !required.includes(key) && !OPTIONAL_KEYS.includes(key) && !PRICE_KEYS.includes(key)) || !validBase(raw)) throw new Error('invalid_public_model')
  if (visible && PRICE_KEYS.some(key => raw[key] !== undefined && (typeof raw[key] !== 'string' || !DECIMAL.test(raw[key])))) throw new Error('invalid_public_model')
  if (!visible && (raw.price_visibility !== 'authenticated_only' || PRICE_KEYS.some(key => raw[key] !== undefined))) throw new Error('invalid_public_model')
  if (raw.pricing_type !== 'token' || !Array.isArray(raw.endpoint_types) || !raw.endpoint_types.every(value => typeof value === 'string' && value) || new Set(raw.endpoint_types).size !== raw.endpoint_types.length || !validUTC(raw.updated_at)) throw new Error('invalid_public_model')
  if (raw.public_restrictions !== undefined && (!Array.isArray(raw.public_restrictions) || !raw.public_restrictions.every(value => typeof value === 'string'))) throw new Error('invalid_public_model')
  for (const key of ['public_display_group','price_source','price_reviewer']) if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error('invalid_public_model')
  if (raw.effective_at !== undefined && !validUTC(raw.effective_at)) throw new Error('invalid_public_model')
  if (visible && PRICE_KEYS.some(key => raw[key] !== undefined) && (typeof raw.price_source !== 'string' || !raw.price_source.trim() || typeof raw.price_reviewer !== 'string' || !raw.price_reviewer.trim() || !validUTC(raw.effective_at))) throw new Error('invalid_public_model')
  const projected = { modelKey: raw.model_key, displayName: raw.display_name, provider: raw.provider, capabilities: [...raw.capabilities], contextWindow: raw.context_window, priceVisibility: raw.price_visibility, releaseVersion: raw.release_version, pricingType: raw.pricing_type, endpointTypes: [...raw.endpoint_types], updatedAt: raw.updated_at }
  for (const [rawKey, key] of [['public_display_group','publicDisplayGroup'],['price_source','priceSource'],['price_reviewer','priceReviewer'],['effective_at','effectiveAt']]) if (raw[rawKey] !== undefined) projected[key] = raw[rawKey]
  if (raw.public_restrictions !== undefined) projected.publicRestrictions = [...raw.public_restrictions]
  if (visible) {
    if (raw.input_price_usd_per_million_tokens !== undefined) projected.inputPrice = raw.input_price_usd_per_million_tokens
    if (raw.output_price_usd_per_million_tokens !== undefined) projected.outputPrice = raw.output_price_usd_per_million_tokens
  }
  return projected
}

export function mapPublicModelList(raw) {
  if (!exactKeys(raw, ['items', 'page', 'page_size', 'total', 'release_version', 'facets']) || !Array.isArray(raw.items) || !Number.isSafeInteger(raw.page) || raw.page < 1 || ![20, 50, 100].includes(raw.page_size) || !Number.isSafeInteger(raw.total) || raw.total < 0 || !Number.isSafeInteger(raw.release_version) || raw.release_version < 1 || !exactKeys(raw.facets, ['providers', 'capabilities', 'endpoint_types', 'public_display_groups'])) throw new Error('invalid_public_model_list')
  const facet = key => {
    const values = raw.facets[key]
    if (!Array.isArray(values) || values.some((value, index) => typeof value !== 'string' || !value || index > 0 && values[index - 1] >= value)) throw new Error('invalid_public_model_list')
    return [...values]
  }
  const items = raw.items.map(mapPublicModel)
  if (items.some(item => item.releaseVersion !== raw.release_version)) throw new Error('mixed_publication_generation')
  return { items, page: raw.page, pageSize: raw.page_size, total: raw.total, releaseVersion: raw.release_version, facets: { providers: facet('providers'), capabilities: facet('capabilities'), endpointTypes: facet('endpoint_types'), publicDisplayGroups: facet('public_display_groups') } }
}

export function formatPublicPrice(value) {
  return typeof value === 'string' && DECIMAL.test(value) ? { state: 'published', label: value, currency: 'USD', unit: 'million_tokens' } : { state: 'missing', label: '价格未发布' }
}

export function filterPublicModels(models, { search = '', provider = '', capability = '' } = {}) {
  const needle = String(search).trim().toLocaleLowerCase()
  return models.filter(model => (!needle || `${model.modelKey} ${model.displayName} ${model.provider}`.toLocaleLowerCase().includes(needle)) && (!provider || model.provider === provider) && (!capability || model.capabilities.includes(capability)))
}

function decimalCompare(a, b) {
  const normalize = value => { const [whole, fraction = ''] = value.split('.'); return [whole.length, whole, fraction.padEnd(8, '0')] }
  const x = normalize(a); const y = normalize(b)
  return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2])
}

export function sortPublicModels(models, component, direction = 'asc', pricing = PUBLIC_PRICING) {
  if (pricing.currency !== 'USD' || pricing.unit !== 'million_tokens' || !['input', 'output'].includes(component) || !['asc', 'desc'].includes(direction)) throw new Error('incomparable_price_units')
  const key = component === 'input' ? 'inputPrice' : 'outputPrice'
  return [...models].sort((a, b) => {
    if (a[key] === undefined) return b[key] === undefined ? a.modelKey.localeCompare(b.modelKey) : 1
    if (b[key] === undefined) return -1
    const order = decimalCompare(a[key], b[key])
    return (direction === 'asc' ? order : -order) || a.modelKey.localeCompare(b.modelKey)
  })
}
