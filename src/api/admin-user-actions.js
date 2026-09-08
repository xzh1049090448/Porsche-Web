const MAX_INT32 = 2147483647
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const TOKEN = /^(?:av|op|ik)_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const FAILURE_CODES = new Set(['action_rejected', 'target_version_conflict', 'policy_version_conflict', 'target_state_conflict', 'consumer_validation_failed'])
const STATUS_CODES = new Map([
  [400, new Set(['invalid_admin_action_request'])],
  [403, new Set(['action_verification_rejected', 'action_operation_rejected'])],
  [404, new Set(['action_target_not_found', 'action_operation_not_found'])],
  [409, new Set(['action_verification_conflict', 'idempotency_conflict', 'idempotency_cross_session', ...FAILURE_CODES])],
  [410, new Set(['operation_expired'])],
  [422, new Set(['action_inactive'])],
  [429, new Set(['action_rate_limited'])],
  [503, new Set(['action_dependency_unavailable', 'operation_commit_unknown'])],
])

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const compareDecimal = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
const validGuid = value => typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0
const validVersion = value => Number.isInteger(value) && value >= 1 && value <= MAX_INT32
const validTimestamp = value => Number.isSafeInteger(value) && value > 0
const validOpaque = (value, prefix) => typeof value === 'string' && TOKEN.test(value) && value.startsWith(prefix)
class InvalidActionResponse extends Error { constructor() { super('invalid_action_response') } }
const invalidResponse = () => { throw new InvalidActionResponse() }

function validateReason(value) {
  if (typeof value !== 'string' || value !== value.trim() || [...value].length < 1 || [...value].length > 200 || /[\uD800-\uDFFF]/u.test(value)) throw new Error('invalid_action_request')
}
function validateCommon(targetGuid, expectedAuthVersion, reason) {
  if (!validGuid(targetGuid) || !validVersion(expectedAuthVersion)) throw new Error('invalid_action_request')
  validateReason(reason)
}
function validateHeader(value, prefix) {
  if (!validOpaque(value, prefix)) throw new Error('invalid_action_request')
}

function responseMetadata(result, status) {
  if (!exactKeys(result, ['data', 'status', 'headers']) || result.status !== status
      || headerValue(result.headers, 'Cache-Control') !== 'no-store') invalidResponse()
  const requestID = headerValue(result.headers, 'X-Request-ID')
  if (requestID == null || requestID.trim() === '') invalidResponse()
  return result
}
function issueResponse(result) {
  const { data: raw } = responseMetadata(result, 201)
  if (!exactKeys(raw, ['ticket', 'expires_at']) || !validOpaque(raw.ticket, 'av_') || !validTimestamp(raw.expires_at)) invalidResponse()
  return { ticket: raw.ticket, expiresAt: raw.expires_at }
}
function executeResponse(result, targetGuid) {
  const { data: raw } = responseMetadata(result, 200)
  if (!exactKeys(raw, ['operation_ref', 'user']) || !validOpaque(raw.operation_ref, 'op_')
      || !exactKeys(raw.user, ['guid', 'status']) || raw.user.guid !== targetGuid || raw.user.status !== 'deleted') invalidResponse()
  return { operationRef: raw.operation_ref, user: { guid: raw.user.guid, status: raw.user.status } }
}
function headerValue(headers, name) {
  if (!headers) return null
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]
  return typeof value === 'string' ? value : null
}
function queryResponse(result) {
  const { data: raw, headers } = responseMetadata(result, 200)
  if (!exactKeys(raw, ['operation_ref', 'scope', 'status', 'finished_at', 'failure_code']) || !validOpaque(raw.operation_ref, 'op_') || raw.scope !== 'users.delete') invalidResponse()
  const terminal = raw.status === 'succeeded' || raw.status === 'failed'
  if (!['processing', 'succeeded', 'failed', 'pending_recovery'].includes(raw.status)
      || (terminal ? !validTimestamp(raw.finished_at) : raw.finished_at !== null)
      || (raw.status === 'failed' ? !FAILURE_CODES.has(raw.failure_code) : raw.failure_code !== null)) invalidResponse()
  const retryText = headerValue(headers, 'Retry-After')
  const retryAfter = retryText == null ? null : Number(retryText)
  if (raw.status === 'processing'
    ? retryText == null || !/^\d+$/.test(retryText) || !Number.isInteger(retryAfter) || retryAfter < 1 || retryAfter > 30
    : retryText != null) invalidResponse()
  return { operationRef: raw.operation_ref, scope: raw.scope, status: raw.status, finishedAt: raw.finished_at, failureCode: raw.failure_code, retryAfter }
}

function publicFailure(code, message, status, operationRef, retryAfter) {
  return Object.freeze({ code, message, status, operationRef, retryAfter })
}
export function mapAdminActionError(error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null
  const body = error?.response?.data
  const retryText = headerValue(error?.response?.headers, 'Retry-After')
  if (status === 401 && retryText == null && exactKeys(body, ['detail']) && ['未登录', 'Token无效或已过期'].includes(body.detail)) {
    return publicFailure('authentication_failed', body.detail, status, null, null)
  }
  const payload = body?.error
  const retry = retryText && /^[1-9]\d*$/.test(retryText) ? Number(retryText) : null
  const retryValid = status === 429 ? Number.isSafeInteger(retry) : retryText == null
  const envelopeValid = exactKeys(body, ['error']) && exactKeys(payload, payload?.operation_ref === undefined
    ? ['code', 'message', 'type', 'request_id']
    : ['code', 'message', 'type', 'request_id', 'operation_ref'])
    && payload.type === 'admin_action_error' && payload.message === '请求无法完成'
    && typeof payload.request_id === 'string' && payload.request_id.trim().length > 0
    && STATUS_CODES.get(status)?.has(payload.code)
    && retryValid
    && (payload.code !== 'operation_commit_unknown' || payload.operation_ref !== undefined)
    && (payload.operation_ref === undefined || (payload.code === 'operation_commit_unknown' && validOpaque(payload.operation_ref, 'op_')))
  if (!envelopeValid) return publicFailure('request_failed', '请求失败，请稍后重试', status, null, null)
  return publicFailure(payload.code, payload.message, status, payload.operation_ref ?? null, status === 429 ? retry : null)
}

export function createAdminUserActionsApi({ post, get }) {
  return Object.freeze({
    async issueUserDelete({ targetGuid, expectedAuthVersion, reason, currentPassword }) {
      validateCommon(targetGuid, expectedAuthVersion, reason)
      if (typeof currentPassword !== 'string' || currentPassword.length < 1) throw new Error('invalid_action_request')
      try {
        return issueResponse(await post('/admin/v2/action-verifications', { action: 'users.delete', intent: { target_guid: targetGuid, expected_auth_version: expectedAuthVersion, reason }, current_password: currentPassword }))
      } catch (error) { if (error instanceof InvalidActionResponse) throw error; throw mapAdminActionError(error) }
    },
    async executeUserDelete({ targetGuid, expectedAuthVersion, reason, ticket, idempotencyKey }) {
      validateCommon(targetGuid, expectedAuthVersion, reason); validateHeader(ticket, 'av_'); validateHeader(idempotencyKey, 'ik_')
      try {
        return executeResponse(await post(`/admin/v2/users/${encodeURIComponent(targetGuid)}/actions`, { action: 'delete', expected_auth_version: expectedAuthVersion, reason }, { headers: { 'Idempotency-Key': idempotencyKey, 'X-Action-Ticket': ticket } }), targetGuid)
      } catch (error) { if (error instanceof InvalidActionResponse) throw error; throw mapAdminActionError(error) }
    },
    async queryUserDelete({ idempotencyKey }) {
      validateHeader(idempotencyKey, 'ik_')
      try { return queryResponse(await get('/admin/v2/operations?scope=users.delete', { 'Idempotency-Key': idempotencyKey })) }
      catch (error) { if (error instanceof InvalidActionResponse) throw error; throw mapAdminActionError(error) }
    },
  })
}

async function productionApi() {
  const { adminActionPost, adminActionQuery } = await import('./request.js')
  return createAdminUserActionsApi({
    post: adminActionPost,
    get: adminActionQuery,
  })
}
export async function issueUserDelete(input) { return (await productionApi()).issueUserDelete(input) }
export async function executeUserDelete(input) { return (await productionApi()).executeUserDelete(input) }
export async function queryUserDelete(input) { return (await productionApi()).queryUserDelete(input) }
