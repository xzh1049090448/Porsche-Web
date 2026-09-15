import { mapPublicModel, mapPublicModelList } from '../utils/public-catalog.js'

export class PublicContentError extends Error {
  constructor(code, status = 0, requestId = null) { super(`public_content_${code}`); this.name = 'PublicContentError'; this.code = code; this.status = status; this.requestId = requestId }
}

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
const positiveInteger = value => Number.isSafeInteger(value) && value >= 1
const GUID = /^[1-9]\d{0,18}$/
const MAX_INT64 = '9223372036854775807'
const MODEL_KEY = /^[a-z][a-z0-9-]{0,127}$/
const RFC3339 = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z$/
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}]/u
const UNSAFE_HTML = /[\p{Cc}\p{Cf}]/u
const LONE_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/
const validScalars = value => !LONE_SURROGATE.test(value) && ![...value].some(character => { const code = character.codePointAt(0); return code === 0xfffd || code >= 0xfdd0 && code <= 0xfdef || (code & 0xffff) >= 0xfffe })
const validGuid = value => typeof value === 'string' && GUID.test(value) && (value.length < MAX_INT64.length || value <= MAX_INT64)
const validText = (value, max, { empty = false, bytes = false } = {}) => typeof value === 'string' && (empty || value.trim().length > 0) && !UNSAFE_TEXT.test(value) && validScalars(value) && (bytes ? new TextEncoder().encode(value).length : [...value].length) <= max
const validHTML = value => typeof value === 'string' && ![...value].some(character => !['\t', '\n', '\r'].includes(character) && UNSAFE_HTML.test(character)) && validScalars(value)
const validModelKey = value => typeof value === 'string' && MODEL_KEY.test(value) && !value.endsWith('-') && !value.includes('--')
const validUTC = value => {
  if (value === null) return true
  const match = typeof value === 'string' ? RFC3339.exec(value) : null
  if (!match) return false
  const parts = match.slice(1, 7).map(Number); const time = Date.parse(value)
  if (!Number.isFinite(time)) return false
  const date = new Date(time)
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() + 1 === parts[1] && date.getUTCDate() === parts[2] && date.getUTCHours() === parts[3] && date.getUTCMinutes() === parts[4] && date.getUTCSeconds() === parts[5]
}
const freeze = value => Array.isArray(value) ? Object.freeze(value.map(freeze)) : value && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)]))) : value
const plainExact = (value, keys) => exact(value, keys) && Object.getPrototypeOf(value) === Object.prototype
const denseArray = value => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false
  const enumerable = Object.keys(value)
  if (enumerable.length !== value.length || !enumerable.every((key, index) => key === String(index))) return false
  const own = Reflect.ownKeys(value)
  return own.length === value.length + 1 && own.includes('length')
}
const compareGuid = (left, right) => left.length === right.length ? left < right ? -1 : left > right ? 1 : 0 : left.length - right.length
const compareAnnouncement = (left, right) => left.sortOrder - right.sortOrder || (left.effectiveAt === right.effectiveAt ? 0 : left.effectiveAt === null ? -1 : right.effectiveAt === null ? 1 : left.effectiveAt < right.effectiveAt ? -1 : 1) || compareGuid(left.guid, right.guid)
const compareFAQ = (left, right) => left.sortOrder - right.sortOrder || compareGuid(left.guid, right.guid)
const canonicalOrder = (items, compare) => items.every((item, index) => index === 0 || compare(items[index - 1], item) <= 0)

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
export function mapPublicHomeConfig(raw) {
  const keys = ['announcements', 'faqs', 'featured_model_keys', 'content_release_version', 'price_release_version']
  if (!exact(raw, keys) || !denseArray(raw.announcements) || raw.announcements.length > 20 || !denseArray(raw.faqs) || raw.faqs.length > 50 || !denseArray(raw.featured_model_keys) || raw.featured_model_keys.length > 12 || !positiveInteger(raw.content_release_version) || !positiveInteger(raw.price_release_version)) throw new Error('invalid_public_home_config')
  const announcementGuids = new Set(); const faqGuids = new Set(); const modelKeys = new Set()
  const announcements = raw.announcements.map(item => {
    if (!exact(item, ['guid', 'title', 'body_html', 'effective_at', 'sort_order']) || !validGuid(item.guid) || announcementGuids.has(item.guid) || !validText(item.title, 120) || !validHTML(item.body_html) || !validUTC(item.effective_at) || !Number.isSafeInteger(item.sort_order) || item.sort_order < 0 || item.sort_order > 1000000) throw new Error('invalid_public_home_config')
    announcementGuids.add(item.guid)
    return { guid: item.guid, title: item.title, bodyHtml: item.body_html, effectiveAt: item.effective_at, sortOrder: item.sort_order }
  })
  const faqs = raw.faqs.map(item => {
    if (!exact(item, ['guid', 'question', 'answer_html', 'sort_order']) || !validGuid(item.guid) || faqGuids.has(item.guid) || !validText(item.question, 200) || !validHTML(item.answer_html) || !Number.isSafeInteger(item.sort_order) || item.sort_order < 0 || item.sort_order > 1000000) throw new Error('invalid_public_home_config')
    faqGuids.add(item.guid)
    return { guid: item.guid, question: item.question, answerHtml: item.answer_html, sortOrder: item.sort_order }
  })
  if (!canonicalOrder(announcements, compareAnnouncement) || !canonicalOrder(faqs, compareFAQ)) throw new Error('invalid_public_home_config')
  for (const key of raw.featured_model_keys) { if (!validModelKey(key) || modelKeys.has(key)) throw new Error('invalid_public_home_config'); modelKeys.add(key) }
  return freeze({ announcements, faqs, featuredModelKeys: raw.featured_model_keys, contentReleaseVersion: raw.content_release_version, priceReleaseVersion: raw.price_release_version })
}

function canonicalCachedHomeConfig(cached, path, requestETag) {
  const resultKeys = ['data', 'etag', 'releaseVersion', 'publicationVersions', 'resourceKey', 'notModified']
  const dataKeys = ['announcements', 'faqs', 'featuredModelKeys', 'contentReleaseVersion', 'priceReleaseVersion']
  if (!plainExact(cached, resultKeys) || !plainExact(cached.data, dataKeys) || !plainExact(cached.publicationVersions, ['content','price']) || !denseArray(cached.data.announcements) || !denseArray(cached.data.faqs) || !denseArray(cached.data.featuredModelKeys) || !cached.data.announcements.every(item => plainExact(item, ['guid','title','bodyHtml','effectiveAt','sortOrder'])) || !cached.data.faqs.every(item => plainExact(item, ['guid','question','answerHtml','sortOrder'])) || cached.resourceKey !== path || typeof cached.notModified !== 'boolean' || typeof requestETag !== 'string' || !requestETag.trim() || cached.etag !== requestETag || !positiveInteger(cached.releaseVersion) || !positiveInteger(cached.publicationVersions.content) || !positiveInteger(cached.publicationVersions.price)) throw new Error('invalid_cache')
  const data = mapPublicHomeConfig({
    announcements: cached.data.announcements.map(item => ({ guid:item.guid, title:item.title, body_html:item.bodyHtml, effective_at:item.effectiveAt, sort_order:item.sortOrder })),
    faqs: cached.data.faqs.map(item => ({ guid:item.guid, question:item.question, answer_html:item.answerHtml, sort_order:item.sortOrder })),
    featured_model_keys: [...cached.data.featuredModelKeys], content_release_version:cached.data.contentReleaseVersion, price_release_version:cached.data.priceReleaseVersion,
  })
  if (cached.releaseVersion !== data.contentReleaseVersion || cached.publicationVersions.content !== data.contentReleaseVersion || cached.publicationVersions.price !== data.priceReleaseVersion) throw new Error('invalid_cache')
  return Object.freeze({ data, etag: cached.etag, releaseVersion: data.contentReleaseVersion, publicationVersions: Object.freeze({ content:data.contentReleaseVersion, price:data.priceReleaseVersion }), resourceKey:path, notModified:true })
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
    if (!options.authenticated && options.etag) headers['If-None-Match'] = options.etag
    if (options.authenticated && getAuthorization) { const authorization = getAuthorization(); if (authorization) headers.Authorization = authorization }
    let response
    try {
      const transport = options.authenticated && !getAuthorization ? (authenticatedFetchImpl || productionAuthenticatedFetch) : fetchImpl
      response = await transport(`${baseURL}${path}`, { method: 'GET', headers, signal: options.signal })
    }
    catch (error) { if (error?.name === 'AbortError') throw error; throw new PublicContentError('network_error') }
    if (response.status === 304) {
      if (options.authenticated) throw new PublicContentError('invalid_304', 304)
      if (options.resourceKey) { try { return options.cacheMapper(options.cached, path, options.etag) } catch { throw new PublicContentError('invalid_304', 304) } }
      if (!options.cached) throw new PublicContentError('invalid_304', 304)
      return { ...options.cached, notModified: true }
    }
    if (!response.ok) {
      const code = ({ 401: 'authentication_required', 404: 'not_found', 410: 'gone', 503: 'unavailable' })[response.status] || 'request_failed'
      const requestIdHeader = response.headers.get('X-Request-ID'); let requestId = null
      try { const raw = await response.json(); if (/^[A-Za-z0-9._:-]{1,128}$/.test(requestIdHeader || '') && exact(raw, ['error']) && exact(raw.error, ['code','message','request_id']) && raw.error.code === code && raw.error.request_id === requestIdHeader && typeof raw.error.message === 'string') requestId = requestIdHeader } catch {}
      throw new PublicContentError(code, response.status, requestId)
    }
    const etag = response.headers.get('ETag'); const rawHeaderVersion = response.headers.get('X-Public-Release-Version'); const headerVersion = /^[1-9]\d*$/.test(rawHeaderVersion || '') ? Number(rawHeaderVersion) : NaN
    const cacheControl = response.headers.get('Cache-Control')
    const expectedCacheControl = options.authenticated ? 'private, no-store' : 'public, max-age=60, stale-while-revalidate=300'
    if (!etag?.trim() || !positiveInteger(headerVersion) || cacheControl !== expectedCacheControl) throw new PublicContentError('invalid_response_headers')
    let raw
    try { raw = await response.json() } catch { throw new PublicContentError('invalid_response') }
    let data
    try { data = mapper(raw) } catch (error) { throw Object.assign(new PublicContentError(error.message === 'mixed_publication_generation' ? error.message : 'invalid_response'), { cause: error }) }
    const inferredProtected = data.priceVisibility === 'authenticated_only' || data.model?.priceVisibility === 'authenticated_only' || data.items?.some(item => item.priceVisibility === 'authenticated_only')
    const expectedVary = options.varyAuthorization ?? inferredProtected
    if ((response.headers.get('Vary') === 'Authorization') !== !!expectedVary) throw new PublicContentError('invalid_response_headers')
    const bodyVersions = path === '/api/v1/public/home-config' ? [data.contentReleaseVersion] : data.releaseVersion === undefined ? [data.contentReleaseVersion, data.priceReleaseVersion] : [data.releaseVersion]
    if (!bodyVersions.includes(headerVersion)) throw new PublicContentError('mixed_publication_generation')
    const publicationVersions = data.contentReleaseVersion === undefined
      ? path.includes('/models') ? { price: data.releaseVersion } : { content: data.releaseVersion }
      : { content: data.contentReleaseVersion, price: data.priceReleaseVersion }
    const result = { data, etag: options.authenticated ? undefined : etag, releaseVersion: headerVersion, publicationVersions, ...(options.resourceKey ? { resourceKey: path } : {}), notModified: false }
    return options.resourceKey ? Object.freeze({ ...result, publicationVersions: Object.freeze({ ...publicationVersions }) }) : result
  }
  const document = path => options => request(path, mapDocument, options)
  return {
    getSite: options => request('/api/v1/public/site', mapSite, options), getHome: document('/api/v1/public/home'),
    getHomeConfig: (options = {}) => { if (!plainExact(options, Object.keys(options)) || Object.keys(options).some(key => !['etag','cached','signal'].includes(key))) throw new Error('invalid_public_home_config_options'); return request('/api/v1/public/home-config', mapPublicHomeConfig, { ...options, authenticated: false, resourceKey: true, cacheMapper: canonicalCachedHomeConfig }) },
    getModels: (filters = {}, options = {}) => request(publicModelsResourceKey(filters), mapPublicModelList, options),
    getModel: (modelKey, options = {}) => { if (typeof modelKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(modelKey)) throw new Error('invalid_model_key'); return request(`/api/v1/public/models/${encodeURIComponent(modelKey)}`, mapDetail, options) },
    getAbout: document('/api/v1/public/pages/about'), getTerms: document('/api/v1/public/pages/terms'), getPrivacy: document('/api/v1/public/pages/privacy'),
  }
}

export const publicContentApi = createPublicContentClient()
