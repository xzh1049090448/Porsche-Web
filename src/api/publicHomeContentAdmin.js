import { mapPublicHomeConfig } from './publicContent.js'

const GUID = /^[1-9]\d{0,18}$/
const MAX_INT64 = '9223372036854775807'
const MODEL_KEY = /^[a-z][a-z0-9-]{0,127}$/
const RFC3339 = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z$/
const UNSAFE = /[\p{Cc}\p{Cf}]/u
const LONE_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/
const snapshotObject = (value, allowed, required = allowed) => {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const own = Reflect.ownKeys(descriptors)
    if (own.some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !Object.hasOwn(descriptors, key))) return null
    const snapshot = {}
    for (const key of own) {
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return snapshot
  } catch { return null }
}
const snapshotArray = (value, maxLength) => {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const own = Reflect.ownKeys(descriptors)
    const lengthDescriptor = descriptors.length
    const length = lengthDescriptor?.value
    if (!Object.hasOwn(lengthDescriptor || {}, 'value') || lengthDescriptor.enumerable || !Number.isSafeInteger(length) || length < 0 || length > maxLength || own.length !== length + 1) return null
    const snapshot = []
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[String(index)]
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot.push(descriptor.value)
    }
    return snapshot
  } catch { return null }
}
const positive = value => Number.isSafeInteger(value) && value >= 1
const validGuid = value => typeof value === 'string' && GUID.test(value) && (value.length < MAX_INT64.length || value <= MAX_INT64)
const validModelKey = value => typeof value === 'string' && MODEL_KEY.test(value) && !value.endsWith('-') && !value.includes('--')
const validScalars = value => !LONE_SURROGATE.test(value) && ![...value].some(character => { const code = character.codePointAt(0); return code === 0xfffd || code >= 0xfdd0 && code <= 0xfdef || (code & 0xffff) >= 0xfffe })
const validText = (value, max, { empty = false, multiline = false, bytes = false } = {}) => typeof value === 'string' && (empty || value.trim().length > 0) && ![...value].some(character => multiline && ['\t', '\n', '\r'].includes(character) ? false : UNSAFE.test(character)) && validScalars(value) && (bytes ? new TextEncoder().encode(value).length : [...value].length) <= max
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
const compareGuid = (left, right) => left.length === right.length ? left < right ? -1 : left > right ? 1 : 0 : left.length - right.length
const compareAnnouncement = (left, right) => left.sortOrder - right.sortOrder || (left.effectiveAt === right.effectiveAt ? 0 : left.effectiveAt === null ? -1 : right.effectiveAt === null ? 1 : left.effectiveAt < right.effectiveAt ? -1 : 1) || compareGuid(left.guid, right.guid)
const compareFAQ = (left, right) => left.sortOrder - right.sortOrder || compareGuid(left.guid, right.guid)
const canonicalOrder = (items, compare) => items.every((item, index) => index === 0 || compare(items[index - 1], item) <= 0)
const invalidRequest = () => { throw new Error('invalid_public_home_content_admin_request') }
class InvalidResponse extends Error { constructor() { super('invalid_public_home_content_admin_response') } }
const invalid = () => { throw new InvalidResponse() }

function mapAnnouncement(raw) {
  const value = snapshotObject(raw, ['guid', 'title', 'body_markdown', 'effective_at', 'is_visible', 'sort_order'])
  if (!value || !validGuid(value.guid) || !validText(value.title, 120) || !validText(value.body_markdown, 16384, { empty: true, multiline: true, bytes: true }) || !validTime(value.effective_at) || typeof value.is_visible !== 'boolean' || !validSort(value.sort_order)) invalid()
  return freeze({ guid: value.guid, title: value.title, bodyMarkdown: value.body_markdown, effectiveAt: value.effective_at, isVisible: value.is_visible, sortOrder: value.sort_order })
}
function mapFAQ(raw) {
  const value = snapshotObject(raw, ['guid', 'question', 'answer_markdown', 'is_visible', 'sort_order'])
  if (!value || !validGuid(value.guid) || !validText(value.question, 200) || !validText(value.answer_markdown, 16384, { empty: true, multiline: true, bytes: true }) || typeof value.is_visible !== 'boolean' || !validSort(value.sort_order)) invalid()
  return freeze({ guid: value.guid, question: value.question, answerMarkdown: value.answer_markdown, isVisible: value.is_visible, sortOrder: value.sort_order })
}
function mapHomeDraft(raw) {
  const value = snapshotObject(raw, ['revision', 'announcements', 'faqs', 'featured_model_keys'])
  const sourceAnnouncements = value && snapshotArray(value.announcements, 20)
  const sourceFAQs = value && snapshotArray(value.faqs, 50)
  const keys = value && snapshotArray(value.featured_model_keys, 12)
  if (!value || !positive(value.revision) || !sourceAnnouncements || !sourceFAQs || !keys) invalid()
  const announcements = sourceAnnouncements.map(mapAnnouncement), faqs = sourceFAQs.map(mapFAQ)
  if (new Set(announcements.map(item => item.guid)).size !== announcements.length || new Set(faqs.map(item => item.guid)).size !== faqs.length || new Set(keys).size !== keys.length || !keys.every(validModelKey) || !canonicalOrder(announcements, compareAnnouncement) || !canonicalOrder(faqs, compareFAQ)) invalid()
  return freeze({ revision: value.revision, announcements, faqs, featuredModelKeys: keys })
}
function mapDocuments(raw) {
  const value = snapshotObject(raw, ['revision', 'about', 'terms', 'privacy', 'legal_reviewed'])
  if (!value || !positive(value.revision) || ![value.about, value.terms, value.privacy].every(item => validText(item, 262144, { empty: true, multiline: true, bytes: true })) || typeof value.legal_reviewed !== 'boolean') invalid()
  return freeze({ revision: value.revision, about: value.about, terms: value.terms, privacy: value.privacy, legalReviewed: value.legal_reviewed })
}
function metadata(result, status, { preview = false, deletion = false } = {}) {
  const value = snapshotObject(result, ['data', 'status', 'headers'])
  if (!value || value.status !== status || header(value.headers, 'Cache-Control') !== 'no-store' || !safeRequestId(header(value.headers, 'X-Request-ID')) || (preview && header(value.headers, 'X-Robots-Tag') !== 'noindex,nofollow')) invalid()
  if (deletion) {
    if (value.data !== null && value.data !== undefined && value.data !== '') invalid()
    const rawRevision = header(value.headers, 'X-Content-Draft-Revision'); const revision = /^[1-9]\d*$/.test(rawRevision || '') ? Number(rawRevision) : NaN; if (!positive(revision)) invalid()
    return revision
  }
  return value.data
}
const safeRequestId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
export class PublicHomeContentAdminError extends Error { constructor(code, status = null, requestId = null) { super(`public_home_content_admin_${code}`); this.name = 'PublicHomeContentAdminError'; Object.assign(this, { code, status, requestId }) } }
function mapError(error) {
  try { if (error?.name === 'AbortError') return error } catch { return new PublicHomeContentAdminError('network_error') }
  let response
  try { response = snapshotObject(error?.response, ['data', 'status', 'headers']) } catch { response = null }
  const status = Number.isInteger(response?.status) ? response.status : null, raw = response?.data, requestId = header(response?.headers, 'X-Request-ID')
  const expected = ({ 400: 'invalid_request', 401: 'authentication_required', 403: 'root_role_required', 404: 'not_found', 409: 'conflict', 410: 'gone', 422: 'validation_failed', 503: 'unavailable' })[status]
  const envelope = snapshotObject(raw, ['error'])
  const errorBody = envelope && snapshotObject(envelope.error, ['code', 'message', 'request_id'])
  const valid = expected && header(response?.headers, 'Cache-Control') === 'no-store' && safeRequestId(requestId) && errorBody && errorBody.code === expected && errorBody.request_id === requestId && typeof errorBody.message === 'string'
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
function exactInput(value, keys) { const snapshot = snapshotObject(value, keys); if (!snapshot) invalidRequest(); return snapshot }
function requestOptions(value, allowed = ['signal']) { const snapshot = snapshotObject(value, allowed, []); if (!snapshot) invalidRequest(); return snapshot }
function announcementBody(value, update = false) {
  const allowed = ['expectedRevision', 'title', 'bodyMarkdown', 'effectiveAt', 'isVisible', 'sortOrder']
  const snapshot = snapshotObject(value, allowed, update ? ['expectedRevision'] : allowed)
  if (!snapshot || !positive(snapshot.expectedRevision)) invalidRequest()
  const body = { expected_revision: snapshot.expectedRevision }
  for (const [source, target, validate] of [['title','title',v=>validText(v,120)],['bodyMarkdown','body_markdown',v=>validText(v,16384,{empty:true,multiline:true,bytes:true})],['effectiveAt','effective_at',validTime],['isVisible','is_visible',v=>typeof v==='boolean'],['sortOrder','sort_order',validSort]]) if (Object.hasOwn(snapshot, source)) { if (!validate(snapshot[source])) invalidRequest(); body[target] = snapshot[source] }
  return body
}
function faqBody(value, update = false) {
  const allowed = ['expectedRevision', 'question', 'answerMarkdown', 'isVisible', 'sortOrder']
  const snapshot = snapshotObject(value, allowed, update ? ['expectedRevision'] : allowed)
  if (!snapshot || !positive(snapshot.expectedRevision)) invalidRequest()
  const body = { expected_revision: snapshot.expectedRevision }
  for (const [source, target, validate] of [['question','question',v=>validText(v,200)],['answerMarkdown','answer_markdown',v=>validText(v,16384,{empty:true,multiline:true,bytes:true})],['isVisible','is_visible',v=>typeof v==='boolean'],['sortOrder','sort_order',validSort]]) if (Object.hasOwn(snapshot, source)) { if (!validate(snapshot[source])) invalidRequest(); body[target] = snapshot[source] }
  return body
}

export function createPublicHomeContentAdminApi({ request = productionRequest } = {}) {
  const run = async (input, status, mapper, options) => { try { return mapper(metadata(await request(input), status, options)) } catch (error) { if (error instanceof InvalidResponse || error instanceof PublicHomeContentAdminError) throw error; throw mapError(error) } }
  const home = (input, status) => run(input, status, mapHomeDraft)
  return Object.freeze({
    getHomeDraft: (options = {}) => { options=requestOptions(options); return home({ method: 'GET', path: '/admin/v2/public-content/home-draft', signal: options.signal }, 200) },
    createAnnouncement: (value, options = {}) => { const body=announcementBody(value); options=requestOptions(options); return home({ method: 'POST', path: '/admin/v2/public-content/home-draft/announcements', body, signal: options.signal }, 201) },
    updateAnnouncement: (id, value, options = {}) => { const pathGuid=guid(id),body=announcementBody(value,true);options=requestOptions(options);return home({ method: 'PATCH', path: `/admin/v2/public-content/home-draft/announcements/${pathGuid}`, body, signal: options.signal }, 200) },
    deleteAnnouncement: (id, expectedRevision, options = {}) => { const pathGuid=guid(id),rev=revision(expectedRevision);options=requestOptions(options);return run({ method: 'DELETE', path: `/admin/v2/public-content/home-draft/announcements/${pathGuid}`, body: { expected_revision: rev }, signal: options.signal }, 204, value => value, { deletion: true }) },
    createFAQ: (value, options = {}) => { const body=faqBody(value);options=requestOptions(options);return home({ method: 'POST', path: '/admin/v2/public-content/home-draft/faqs', body, signal: options.signal }, 201) },
    updateFAQ: (id, value, options = {}) => { const pathGuid=guid(id),body=faqBody(value,true);options=requestOptions(options);return home({ method: 'PATCH', path: `/admin/v2/public-content/home-draft/faqs/${pathGuid}`, body, signal: options.signal }, 200) },
    deleteFAQ: (id, expectedRevision, options = {}) => { const pathGuid=guid(id),rev=revision(expectedRevision);options=requestOptions(options);return run({ method: 'DELETE', path: `/admin/v2/public-content/home-draft/faqs/${pathGuid}`, body: { expected_revision: rev }, signal: options.signal }, 204, value => value, { deletion: true }) },
    saveFeaturedModels: (expectedRevision, featuredModelKeys, options = {}) => { const keys=snapshotArray(featuredModelKeys,12);if (!keys || new Set(keys).size !== keys.length || !keys.every(validModelKey)) invalidRequest(); const rev=revision(expectedRevision);options=requestOptions(options);return home({ method: 'PUT', path: '/admin/v2/public-content/home-draft/featured-models', body: { expected_revision: rev, featured_model_keys: keys }, signal: options.signal }, 200) },
    previewHome: (draftRevision, options = {}) => { if (draftRevision !== undefined && !positive(draftRevision)) invalidRequest();options=requestOptions(options);return run({ method: 'GET', path: `/admin/v2/public-content/home-preview${draftRevision === undefined ? '' : `?revision=${draftRevision}`}`, signal: options.signal }, 200, mapHomeDraft, { preview: true }) },
    getReleaseHomeConfig: (id, options = {}) => { const pathGuid=guid(id);options=requestOptions(options);return run({ method: 'GET', path: `/admin/v2/public-content/releases/${pathGuid}/home-config`, signal: options.signal }, 200, raw => { try { return mapPublicHomeConfig(raw) } catch { invalid() } }) },
    getDocumentsDraft: (options = {}) => { options=requestOptions(options);return run({ method: 'GET', path: '/admin/v2/public-content/documents-draft', signal: options.signal }, 200, mapDocuments) },
    saveDocumentsDraft: (value, options = {}) => { const snapshot=exactInput(value, ['expectedRevision','about','terms','privacy','legalReviewed']); if (![snapshot.about,snapshot.terms,snapshot.privacy].every(item=>validText(item,262144,{empty:true,multiline:true,bytes:true})) || typeof snapshot.legalReviewed !== 'boolean') invalidRequest(); const rev=revision(snapshot.expectedRevision);options=requestOptions(options);return run({ method: 'PUT', path: '/admin/v2/public-content/documents-draft', body: { expected_revision: rev, about:snapshot.about, terms:snapshot.terms, privacy:snapshot.privacy, legal_reviewed:snapshot.legalReviewed }, signal: options.signal }, 200, mapDocuments) },
  })
}
export const publicHomeContentAdminApi = createPublicHomeContentAdminApi()
