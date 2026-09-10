const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const BASE_KEYS = ['model_key', 'display_name', 'provider', 'capabilities', 'context_window', 'price_visibility', 'release_version']
const PRICE_KEYS = ['input_price_usd_per_million_tokens', 'output_price_usd_per_million_tokens']

export const PUBLIC_PRICING = Object.freeze({ currency: 'USD', unit: 'million_tokens', billingSemantics: 'references_only_no_automatic_charge' })
export const PUBLIC_PRICE_DISCLAIMER = '价格仅供参考，不代表自动计费或最终账单。'

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key))
}

function validBase(raw) {
  return typeof raw.model_key === 'string' && MODEL_KEY.test(raw.model_key) && typeof raw.display_name === 'string' && raw.display_name.length > 0 && typeof raw.provider === 'string' && raw.provider.length > 0 && Array.isArray(raw.capabilities) && raw.capabilities.every(item => typeof item === 'string') && new Set(raw.capabilities).size === raw.capabilities.length && Number.isSafeInteger(raw.context_window) && raw.context_window >= 0 && Number.isSafeInteger(raw.release_version) && raw.release_version >= 1
}

export function mapPublicModel(raw) {
  const visible = raw?.price_visibility === 'visible'
  const expected = visible ? [...BASE_KEYS, ...PRICE_KEYS] : BASE_KEYS
  if (!exactKeys(raw, expected) || !validBase(raw)) throw new Error('invalid_public_model')
  if (visible && (typeof raw.input_price_usd_per_million_tokens !== 'string' || typeof raw.output_price_usd_per_million_tokens !== 'string' || !DECIMAL.test(raw.input_price_usd_per_million_tokens) || !DECIMAL.test(raw.output_price_usd_per_million_tokens))) throw new Error('invalid_public_model')
  if (!visible && raw.price_visibility !== 'authenticated_only') throw new Error('invalid_public_model')
  const projected = { modelKey: raw.model_key, displayName: raw.display_name, provider: raw.provider, capabilities: [...raw.capabilities], contextWindow: raw.context_window, priceVisibility: raw.price_visibility, releaseVersion: raw.release_version }
  if (visible) { projected.inputPrice = raw.input_price_usd_per_million_tokens; projected.outputPrice = raw.output_price_usd_per_million_tokens }
  return projected
}

export function mapPublicModelList(raw) {
  if (!exactKeys(raw, ['items', 'page', 'page_size', 'total', 'release_version']) || !Array.isArray(raw.items) || !Number.isSafeInteger(raw.page) || raw.page < 1 || ![20, 50, 100].includes(raw.page_size) || !Number.isSafeInteger(raw.total) || raw.total < 0 || !Number.isSafeInteger(raw.release_version) || raw.release_version < 1) throw new Error('invalid_public_model_list')
  const items = raw.items.map(mapPublicModel)
  if (items.some(item => item.releaseVersion !== raw.release_version)) throw new Error('mixed_publication_generation')
  return { items, page: raw.page, pageSize: raw.page_size, total: raw.total, releaseVersion: raw.release_version }
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
