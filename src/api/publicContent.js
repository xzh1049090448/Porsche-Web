import { mapPublicModel, mapPublicModelList } from '../utils/public-catalog.js'

export class PublicContentError extends Error {
  constructor(code, status = 0) { super(`public_content_${code}`); this.name = 'PublicContentError'; this.code = code; this.status = status }
}

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
const positiveInteger = value => Number.isSafeInteger(value) && value >= 1

function mapDocument(raw) {
  if (!exact(raw, ['document', 'release_version']) || typeof raw.document !== 'string' || !positiveInteger(raw.release_version)) throw new Error('invalid_public_document')
  return { document: raw.document, releaseVersion: raw.release_version }
}
function mapSite(raw) {
  if (!exact(raw, ['content_release_version', 'price_release_version', 'price_visibility']) || !positiveInteger(raw.content_release_version) || !positiveInteger(raw.price_release_version) || !['visible', 'authenticated_only'].includes(raw.price_visibility)) throw new Error('invalid_public_site')
  return { contentReleaseVersion: raw.content_release_version, priceReleaseVersion: raw.price_release_version, priceVisibility: raw.price_visibility }
}
function mapDetail(raw) {
  if (!exact(raw, ['model'])) throw new Error('invalid_public_model_detail')
  return { model: mapPublicModel(raw.model), releaseVersion: raw.model.release_version }
}

function queryString(filters = {}) {
  const allowed = new Set(['search', 'provider', 'capability', 'endpointType', 'publicDisplayGroup', 'pricingType', 'page', 'pageSize', 'sort', 'order'])
  if (Object.keys(filters).some(key => !allowed.has(key))) throw new Error('invalid_public_models_query')
  const params = new URLSearchParams()
  for (const key of ['search', 'provider', 'capability']) if (filters[key] !== undefined && filters[key] !== '') { if (typeof filters[key] !== 'string') throw new Error('invalid_public_models_query'); params.set(key, filters[key]) }
  for (const [key, name] of [['endpointType','endpoint_type'],['publicDisplayGroup','public_display_group']]) if (filters[key] !== undefined && filters[key] !== '') { if (typeof filters[key] !== 'string') throw new Error('invalid_public_models_query'); params.set(name, filters[key]) }
  if (filters.pricingType !== undefined) { if (filters.pricingType !== 'token') throw new Error('invalid_public_models_query'); params.set('pricing_type', 'token') }
  if (filters.sort !== undefined) { if (!['default','name','input_price','output_price'].includes(filters.sort)) throw new Error('invalid_public_models_query'); params.set('sort', filters.sort) }
  if (filters.order !== undefined) { if (!['asc','desc'].includes(filters.order)) throw new Error('invalid_public_models_query'); params.set('order', filters.order) }
  if (filters.page !== undefined) { if (!positiveInteger(filters.page)) throw new Error('invalid_public_models_query'); params.set('page', String(filters.page)) }
  if (filters.pageSize !== undefined) { if (![20, 50, 100].includes(filters.pageSize)) throw new Error('invalid_public_models_query'); params.set('page_size', String(filters.pageSize)) }
  const encoded = params.toString(); return encoded ? `?${encoded}` : ''
}

export function publicModelsResourceKey(filters = {}) { return `/api/v1/public/models${queryString(filters)}` }

async function productionAuthenticatedFetch(input, init) {
  const { authenticatedFetch } = await import('./request.js')
  return authenticatedFetch(input, init)
}

export function createPublicContentClient({ fetchImpl = globalThis.fetch, authenticatedFetch: authenticatedFetchImpl, baseURL = import.meta.env?.VITE_API_BASE ?? '', getAuthorization = null } = {}) {
  async function request(path, mapper, options = {}) {
    const headers = {}
    if (options.etag) headers['If-None-Match'] = options.etag
    if (options.authenticated && getAuthorization) { const authorization = getAuthorization(); if (authorization) headers.Authorization = authorization }
    let response
    try {
      const transport = options.authenticated && !getAuthorization ? (authenticatedFetchImpl || productionAuthenticatedFetch) : fetchImpl
      response = await transport(`${baseURL}${path}`, { method: 'GET', headers, signal: options.signal })
    }
    catch (error) { if (error?.name === 'AbortError') throw error; throw new PublicContentError('network_error') }
    if (response.status === 304) {
      if (!options.cached) throw new PublicContentError('invalid_304', 304)
      return { ...options.cached, notModified: true }
    }
    if (!response.ok) throw new PublicContentError(({ 401: 'authentication_required', 404: 'not_found', 410: 'gone', 503: 'unavailable' })[response.status] || 'request_failed', response.status)
    const etag = response.headers.get('ETag'); const headerVersion = Number(response.headers.get('X-Public-Release-Version'))
    const cacheControl = response.headers.get('Cache-Control')
    if (!etag || !positiveInteger(headerVersion) || cacheControl !== 'public, max-age=60, stale-while-revalidate=300') throw new PublicContentError('invalid_response_headers')
    let raw
    try { raw = await response.json() } catch { throw new PublicContentError('invalid_response') }
    let data
    try { data = mapper(raw) } catch (error) { throw Object.assign(new PublicContentError(error.message === 'mixed_publication_generation' ? error.message : 'invalid_response'), { cause: error }) }
    const bodyVersions = data.releaseVersion === undefined ? [data.contentReleaseVersion, data.priceReleaseVersion] : [data.releaseVersion]
    if (!bodyVersions.includes(headerVersion)) throw new PublicContentError('mixed_publication_generation')
    const publicationVersions = data.contentReleaseVersion === undefined
      ? path.includes('/models') ? { price: data.releaseVersion } : { content: data.releaseVersion }
      : { content: data.contentReleaseVersion, price: data.priceReleaseVersion }
    return { data, etag, releaseVersion: headerVersion, publicationVersions, notModified: false }
  }
  const document = path => options => request(path, mapDocument, options)
  return {
    getSite: options => request('/api/v1/public/site', mapSite, options), getHome: document('/api/v1/public/home'),
    getModels: (filters = {}, options = {}) => request(publicModelsResourceKey(filters), mapPublicModelList, options),
    getModel: (modelKey, options = {}) => { if (typeof modelKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(modelKey)) throw new Error('invalid_model_key'); return request(`/api/v1/public/models/${encodeURIComponent(modelKey)}`, mapDetail, options) },
    getAbout: document('/api/v1/public/pages/about'), getTerms: document('/api/v1/public/pages/terms'), getPrivacy: document('/api/v1/public/pages/privacy'),
  }
}

export const publicContentApi = createPublicContentClient()
