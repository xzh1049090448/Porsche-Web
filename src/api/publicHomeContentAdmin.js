import { mapPublicHomeConfig } from './publicContent.js'

const GUID = /^[1-9]\d{0,18}$/
const MAX_INT64 = '9223372036854775807'
const MODEL_KEY = /^[a-z][a-z0-9-]{0,127}$/
const RFC3339 = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?Z$/
const UNSAFE = /[\p{Cc}\p{Cf}]/u
const UNSAFE_MULTILINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}]/u
const LONE_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const positive = value => Number.isSafeInteger(value) && value >= 1
const validGuid = value => typeof value === 'string' && GUID.test(value) && (value.length < MAX_INT64.length || value <= MAX_INT64)
const validModelKey = value => typeof value === 'string' && MODEL_KEY.test(value) && !value.endsWith('-') && !value.includes('--')
const validScalars = value => !LONE_SURROGATE.test(value) && ![...value].some(character => { const code = character.codePointAt(0); return code === 0xfffd || code >= 0xfdd0 && code <= 0xfdef || (code & 0xffff) >= 0xfffe })
const validText = (value, max, { empty = false, multiline = false, bytes = false } = {}) => typeof value === 'string' && (empty || value.trim().length > 0) && !(multiline ? UNSAFE_MULTILINE : UNSAFE).test(value) && validScalars(value) && (bytes ? new TextEncoder().encode(value).length : [...value].length) <= max
const validTime = value => {
  if (value === null) return true
  const match = typeof value === 'string' ? RFC3339.exec(value) : null
  if (!match) return false
  const values = match.slice(1, 7).map(Number); const ms = Date.parse(value); if (!Number.isFinite(ms)) return false
  const date = new Date(ms)
  return date.getUTCFullYear() === values[0] && date.getUTCMonth() + 1 === values[1] && date.getUTCDate() === values[2] && date.getUTCHours() === values[3] && date.getUTCMinutes() === values[4] && date.getUTCSeconds() === values[5]
}
const validSort = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000
const header = (headers, name) => { const value = typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]; return typeof value === 'string' ? value : null }
const freeze = value => Array.isArray(value) ? Object.freeze(value.map(freeze)) : value && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)]))) : value
const invalidRequest = () => { throw new Error('invalid_public_home_content_admin_request') }
class InvalidResponse extends Error { constructor() { super('invalid_public_home_content_admin_response') } }
const invalid = () => { throw new InvalidResponse() }

function mapAnnouncement(raw) {
  if (!exact(raw, ['guid', 'title', 'body_markdown', 'effective_at', 'is_visible', 'sort_order']) || !validGuid(raw.guid) || !validText(raw.title, 120) || !validText(raw.body_markdown, 16384, { empty: true, multiline: true, bytes: true }) || !validTime(raw.effective_at) || typeof raw.is_visible !== 'boolean' || !validSort(raw.sort_order)) invalid()
  return freeze({ guid: raw.guid, title: raw.title, bodyMarkdown: raw.body_markdown, effectiveAt: raw.effective_at, isVisible: raw.is_visible, sortOrder: raw.sort_order })
}
function mapFAQ(raw) {
  if (!exact(raw, ['guid', 'question', 'answer_markdown', 'is_visible', 'sort_order']) || !validGuid(raw.guid) || !validText(raw.question, 200) || !validText(raw.answer_markdown, 16384, { empty: true, multiline: true, bytes: true }) || typeof raw.is_visible !== 'boolean' || !validSort(raw.sort_order)) invalid()
  return freeze({ guid: raw.guid, question: raw.question, answerMarkdown: raw.answer_markdown, isVisible: raw.is_visible, sortOrder: raw.sort_order })
}
function mapHomeDraft(raw) {
  if (!exact(raw, ['revision', 'announcements', 'faqs', 'featured_model_keys']) || !positive(raw.revision) || !Array.isArray(raw.announcements) || raw.announcements.length > 20 || !Array.isArray(raw.faqs) || raw.faqs.length > 50 || !Array.isArray(raw.featured_model_keys) || raw.featured_model_keys.length > 12) invalid()
  const announcements = raw.announcements.map(mapAnnouncement), faqs = raw.faqs.map(mapFAQ), keys = raw.featured_model_keys
  if (new Set(announcements.map(item => item.guid)).size !== announcements.length || new Set(faqs.map(item => item.guid)).size !== faqs.length || new Set(keys).size !== keys.length || !keys.every(validModelKey)) invalid()
  return freeze({ revision: raw.revision, announcements, faqs, featuredModelKeys: keys })
}
function mapDocuments(raw) {
  if (!exact(raw, ['revision', 'about', 'terms', 'privacy', 'legal_reviewed']) || !positive(raw.revision) || ![raw.about, raw.terms, raw.privacy].every(value => validText(value, 262144, { empty: true, multiline: true, bytes: true })) || typeof raw.legal_reviewed !== 'boolean') invalid()
  return freeze({ revision: raw.revision, about: raw.about, terms: raw.terms, privacy: raw.privacy, legalReviewed: raw.legal_reviewed })
}
function metadata(result, status, { preview = false, deletion = false } = {}) {
  if (!exact(result, ['data', 'status', 'headers']) || result.status !== status || header(result.headers, 'Cache-Control') !== 'no-store' || !safeRequestId(header(result.headers, 'X-Request-ID')) || (preview && header(result.headers, 'X-Robots-Tag') !== 'noindex,nofollow')) invalid()
  if (deletion) {
    if (result.data !== null && result.data !== undefined && result.data !== '') invalid()
    const rawRevision = header(result.headers, 'X-Content-Draft-Revision'); const revision = /^[1-9]\d*$/.test(rawRevision || '') ? Number(rawRevision) : NaN; if (!positive(revision)) invalid()
    return revision
  }
  return result.data
}
const safeRequestId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
export class PublicHomeContentAdminError extends Error { constructor(code, status = null, requestId = null) { super(`public_home_content_admin_${code}`); this.name = 'PublicHomeContentAdminError'; Object.assign(this, { code, status, requestId }) } }
function mapError(error) {
  if (error?.name === 'AbortError') return error
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null, raw = error?.response?.data, requestId = header(error?.response?.headers, 'X-Request-ID')
  const expected = ({ 400: 'invalid_request', 401: 'authentication_required', 403: 'root_role_required', 404: 'not_found', 409: 'conflict', 410: 'gone', 422: 'validation_failed', 503: 'unavailable' })[status]
  const valid = expected && header(error?.response?.headers, 'Cache-Control') === 'no-store' && safeRequestId(requestId) && exact(raw, ['error']) && exact(raw.error, ['code', 'message', 'request_id']) && raw.error.code === expected && raw.error.request_id === requestId && typeof raw.error.message === 'string'
  if (!valid) return new PublicHomeContentAdminError(status ? 'request_failed' : 'network_error', status)
  return new PublicHomeContentAdminError(status === 403 ? 'root_required' : status === 409 ? 'revision_conflict' : expected, status, requestId)
}

export function createPublicHomeContentAdminProductionRequest({ fetchImpl = globalThis.fetch, baseURL = import.meta.env?.VITE_API_BASE ?? '', getAuthorization } = {}) {
  return async input => {
    const headers = {}; const authorization = getAuthorization?.(); if (authorization) headers.Authorization = authorization
    if (input.method !== 'GET' && input.method !== 'DELETE' || input.body !== undefined) headers['Content-Type'] = 'application/json'
    let response
    try { response = await fetchImpl(`${baseURL}${input.path}`, { method: input.method, headers, credentials: 'include', signal: input.signal, ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) }) } catch (error) { if (error?.name === 'AbortError') throw error; throw new PublicHomeContentAdminError('network_error') }
    let data = null
    if (response.status !== 204) { try { data = await response.json() } catch { data = null } }
    const result = { data, status: response.status, headers: response.headers }
    if (!response.ok) throw { response: result }
    return result
  }
}
async function productionRequest(input) { const { getAuthToken } = await import('./request.js'); return createPublicHomeContentAdminProductionRequest({ getAuthorization: () => { const token = getAuthToken(); return token ? `Bearer ${token}` : null } })(input) }

function revision(value) { if (!positive(value)) invalidRequest(); return value }
function guid(value) { if (!validGuid(value)) invalidRequest(); return encodeURIComponent(value) }
function exactInput(value, keys) { if (!exact(value, keys)) invalidRequest() }
function announcementBody(value, update = false) {
  const allowed = ['expectedRevision', 'title', 'bodyMarkdown', 'effectiveAt', 'isVisible', 'sortOrder']; if (!value || typeof value !== 'object' || Object.keys(value).some(key => !allowed.includes(key)) || !positive(value.expectedRevision)) invalidRequest()
  if (!update && allowed.some(key => !Object.hasOwn(value, key))) invalidRequest()
  const body = { expected_revision: value.expectedRevision }
  for (const [source, target, validate] of [['title','title',v=>validText(v,120)],['bodyMarkdown','body_markdown',v=>validText(v,16384,{empty:true,multiline:true,bytes:true})],['effectiveAt','effective_at',validTime],['isVisible','is_visible',v=>typeof v==='boolean'],['sortOrder','sort_order',validSort]]) if (Object.hasOwn(value, source)) { if (!validate(value[source])) invalidRequest(); body[target] = value[source] }
  return body
}
function faqBody(value, update = false) {
  const allowed = ['expectedRevision', 'question', 'answerMarkdown', 'isVisible', 'sortOrder']; if (!value || typeof value !== 'object' || Object.keys(value).some(key => !allowed.includes(key)) || !positive(value.expectedRevision)) invalidRequest()
  if (!update && allowed.some(key => !Object.hasOwn(value, key))) invalidRequest()
  const body = { expected_revision: value.expectedRevision }
  for (const [source, target, validate] of [['question','question',v=>validText(v,200)],['answerMarkdown','answer_markdown',v=>validText(v,16384,{empty:true,multiline:true,bytes:true})],['isVisible','is_visible',v=>typeof v==='boolean'],['sortOrder','sort_order',validSort]]) if (Object.hasOwn(value, source)) { if (!validate(value[source])) invalidRequest(); body[target] = value[source] }
  return body
}

export function createPublicHomeContentAdminApi({ request = productionRequest } = {}) {
  const run = async (input, status, mapper, options) => { try { return mapper(metadata(await request(input), status, options)) } catch (error) { if (error instanceof InvalidResponse || error instanceof PublicHomeContentAdminError) throw error; throw mapError(error) } }
  const home = (input, status) => run(input, status, mapHomeDraft)
  return Object.freeze({
    getHomeDraft: (options = {}) => home({ method: 'GET', path: '/admin/v2/public-content/home-draft', signal: options.signal }, 200),
    createAnnouncement: (value, options = {}) => home({ method: 'POST', path: '/admin/v2/public-content/home-draft/announcements', body: announcementBody(value), signal: options.signal }, 201),
    updateAnnouncement: (id, value, options = {}) => home({ method: 'PATCH', path: `/admin/v2/public-content/home-draft/announcements/${guid(id)}`, body: announcementBody(value, true), signal: options.signal }, 200),
    deleteAnnouncement: (id, expectedRevision, options = {}) => run({ method: 'DELETE', path: `/admin/v2/public-content/home-draft/announcements/${guid(id)}`, body: { expected_revision: revision(expectedRevision) }, signal: options.signal }, 204, value => value, { deletion: true }),
    createFAQ: (value, options = {}) => home({ method: 'POST', path: '/admin/v2/public-content/home-draft/faqs', body: faqBody(value), signal: options.signal }, 201),
    updateFAQ: (id, value, options = {}) => home({ method: 'PATCH', path: `/admin/v2/public-content/home-draft/faqs/${guid(id)}`, body: faqBody(value, true), signal: options.signal }, 200),
    deleteFAQ: (id, expectedRevision, options = {}) => run({ method: 'DELETE', path: `/admin/v2/public-content/home-draft/faqs/${guid(id)}`, body: { expected_revision: revision(expectedRevision) }, signal: options.signal }, 204, value => value, { deletion: true }),
    saveFeaturedModels: (expectedRevision, featuredModelKeys, options = {}) => { if (!Array.isArray(featuredModelKeys) || featuredModelKeys.length > 12 || new Set(featuredModelKeys).size !== featuredModelKeys.length || !featuredModelKeys.every(validModelKey)) invalidRequest(); return home({ method: 'PUT', path: '/admin/v2/public-content/home-draft/featured-models', body: { expected_revision: revision(expectedRevision), featured_model_keys: [...featuredModelKeys] }, signal: options.signal }, 200) },
    previewHome: (draftRevision, options = {}) => { if (draftRevision !== undefined && !positive(draftRevision)) invalidRequest(); return run({ method: 'GET', path: `/admin/v2/public-content/home-preview${draftRevision === undefined ? '' : `?revision=${draftRevision}`}`, signal: options.signal }, 200, mapHomeDraft, { preview: true }) },
    getReleaseHomeConfig: (id, options = {}) => run({ method: 'GET', path: `/admin/v2/public-content/releases/${guid(id)}/home-config`, signal: options.signal }, 200, raw => { try { return mapPublicHomeConfig(raw) } catch { invalid() } }),
    getDocumentsDraft: (options = {}) => run({ method: 'GET', path: '/admin/v2/public-content/documents-draft', signal: options.signal }, 200, mapDocuments),
    saveDocumentsDraft: (value, options = {}) => { exactInput(value, ['expectedRevision','about','terms','privacy','legalReviewed']); if (![value.about,value.terms,value.privacy].every(item=>validText(item,262144,{empty:true,multiline:true,bytes:true})) || typeof value.legalReviewed !== 'boolean') invalidRequest(); return run({ method: 'PUT', path: '/admin/v2/public-content/documents-draft', body: { expected_revision: revision(value.expectedRevision), about:value.about, terms:value.terms, privacy:value.privacy, legal_reviewed:value.legalReviewed }, signal: options.signal }, 200, mapDocuments) },
  })
}
export const publicHomeContentAdminApi = createPublicHomeContentAdminApi()
