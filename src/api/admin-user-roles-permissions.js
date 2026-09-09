import { ADMIN_CAPABILITY_DEFINITIONS } from './admin-users.js'

const MAX_INT32 = 2147483647
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const TOKEN = /^(?:av|op|ik)_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const SCOPES = new Set(['users.promote', 'users.demote', 'users.permissions.write'])
const EFFECTS = new Set(['inherit', 'allow', 'deny'])
const FAILURE_CODES = new Set(['action_rejected', 'target_version_conflict', 'policy_version_conflict', 'target_state_conflict', 'consumer_validation_failed'])
const STATUS_CODES = new Map([
  [400, new Set(['invalid_admin_action_request'])],
  [403, new Set(['action_verification_rejected', 'action_operation_rejected'])],
  [404, new Set(['action_target_not_found', 'action_operation_not_found'])],
  [409, new Set(['action_verification_conflict', 'idempotency_conflict', 'idempotency_cross_session', ...FAILURE_CODES])],
  [410, new Set(['operation_expired'])],
  [413, new Set(['request_body_too_large'])],
  [422, new Set(['action_inactive'])],
  [429, new Set(['action_rate_limited'])],
  [503, new Set(['action_dependency_unavailable', 'operation_commit_unknown'])],
])
const ROLE_BY_SCOPE = Object.freeze({
  'users.promote': 'admin',
  'users.demote': 'user',
  'users.permissions.write': 'admin',
})
const CAPABILITIES = new Map(ADMIN_CAPABILITY_DEFINITIONS.map((definition, index) => [definition.name, Object.freeze({
  index,
  grantable: definition.grantable === true,
  rootOnly: definition.rootOnly === true,
  available: definition.available === true,
})]))

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const compareDecimal = (left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0)
const validGuid = value => typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0
const validInt32 = value => Number.isInteger(value) && value >= 1 && value <= MAX_INT32
const validPermissionVersion = (value, allowZero) => Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1)
const validOpaque = (value, prefix) => typeof value === 'string' && value.startsWith(prefix) && TOKEN.test(value)
const validTimestamp = value => Number.isSafeInteger(value) && value > 0

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xDC00 && low <= 0xDFFF) { index++; continue }
      return true
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return true
  }
  return false
}

class InvalidA08Response extends Error {
  constructor() { super('invalid_a08_response') }
}
const invalidRequest = () => { throw new Error('invalid_a08_request') }
const invalidResponse = () => { throw new InvalidA08Response() }

function headerValue(headers, name) {
  if (!headers) return null
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]
  return typeof value === 'string' ? value : null
}

function validateReason(value) {
  if (typeof value !== 'string' || hasLoneSurrogate(value)) invalidRequest()
  const reason = value.trim()
  if (!reason || [...reason].length > 200) invalidRequest()
  return reason
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length === 0 || hasLoneSurrogate(value)) invalidRequest()
  return value
}

function validateMetadata(result, status, retryAllowed = false) {
  if (!exactKeys(result, ['status', 'headers', 'data']) || result.status !== status
      || headerValue(result.headers, 'Cache-Control') !== 'no-store'
      || !headerValue(result.headers, 'X-Request-ID')?.trim()
      || (!retryAllowed && headerValue(result.headers, 'Retry-After') !== null)) invalidResponse()
  return result
}

export function normalizeRolePermissionOverrides(value) {
  if (!Array.isArray(value)) invalidRequest()
  const seen = new Set()
  const wire = []
  for (const item of value) {
    if (!exactKeys(item, ['capability', 'effect']) || typeof item.capability !== 'string' || !EFFECTS.has(item.effect)) invalidRequest()
    const folded = item.capability.toLocaleLowerCase('en-US')
    if (seen.has(folded)) invalidRequest()
    seen.add(folded)
    const definition = CAPABILITIES.get(item.capability)
    if (!definition || !definition.available || (item.effect === 'allow' && (!definition.grantable || definition.rootOnly))) invalidRequest()
    if (item.effect !== 'inherit') wire.push(Object.freeze({ capability: item.capability, effect: item.effect }))
  }
  wire.sort((left, right) => CAPABILITIES.get(left.capability).index - CAPABILITIES.get(right.capability).index)
  return Object.freeze(wire)
}

function normalizeCommon(input, keys, scope, withOverrides) {
  if (!exactKeys(input, keys) || !validGuid(input.targetGuid) || !validInt32(input.expectedAuthVersion)
      || !validPermissionVersion(input.expectedPermissionsVersion, scope === 'users.promote') || !validInt32(input.catalogVersion)) invalidRequest()
  const normalized = {
    targetGuid: input.targetGuid,
    expectedAuthVersion: input.expectedAuthVersion,
    expectedPermissionsVersion: input.expectedPermissionsVersion,
    catalogVersion: input.catalogVersion,
    reason: validateReason(input.reason),
  }
  if (withOverrides) normalized.overrides = normalizeRolePermissionOverrides(input.overrides)
  return Object.freeze(normalized)
}

function normalizeIssue(input, scope) {
  const withOverrides = scope !== 'users.demote'
  const keys = withOverrides
    ? ['targetGuid', 'expectedAuthVersion', 'expectedPermissionsVersion', 'catalogVersion', 'overrides', 'reason', 'currentPassword']
    : ['targetGuid', 'expectedAuthVersion', 'expectedPermissionsVersion', 'catalogVersion', 'reason', 'currentPassword']
  const common = normalizeCommon(input, keys, scope, withOverrides)
  return Object.freeze({ ...common, currentPassword: validatePassword(input.currentPassword) })
}

function normalizeExecute(input, scope) {
  const withOverrides = scope !== 'users.demote'
  const keys = withOverrides
    ? ['targetGuid', 'expectedAuthVersion', 'expectedPermissionsVersion', 'catalogVersion', 'overrides', 'reason', 'ticket', 'idempotencyKey']
    : ['targetGuid', 'expectedAuthVersion', 'expectedPermissionsVersion', 'catalogVersion', 'reason', 'ticket', 'idempotencyKey']
  const common = normalizeCommon(input, keys, scope, withOverrides)
  if (!validOpaque(input.ticket, 'av_') || !validOpaque(input.idempotencyKey, 'ik_')) invalidRequest()
  return Object.freeze({ ...common, ticket: input.ticket, idempotencyKey: input.idempotencyKey })
}

function intentBody(scope, request) {
  const intent = {
    target_guid: request.targetGuid,
    expected_auth_version: request.expectedAuthVersion,
    expected_permissions_version: request.expectedPermissionsVersion,
    catalog_version: request.catalogVersion,
  }
  if (scope !== 'users.demote') intent.overrides = request.overrides.map(item => ({ ...item }))
  intent.reason = request.reason
  return { action: scope, intent, current_password: request.currentPassword }
}

function executeBody(scope, request) {
  const body = {}
  if (scope !== 'users.permissions.write') body.action = scope === 'users.promote' ? 'promote' : 'demote'
  body.expected_auth_version = request.expectedAuthVersion
  body.expected_permissions_version = request.expectedPermissionsVersion
  body.catalog_version = request.catalogVersion
  if (scope !== 'users.demote') body.overrides = request.overrides.map(item => ({ ...item }))
  body.reason = request.reason
  return body
}

function issueResponse(result) {
  const { data } = validateMetadata(result, 201)
  if (!exactKeys(data, ['ticket', 'expires_at']) || !validOpaque(data.ticket, 'av_') || !validTimestamp(data.expires_at)) invalidResponse()
  return Object.freeze({ ticket: data.ticket, expiresAt: data.expires_at })
}

function executeResponse(result, scope, request) {
  const { data } = validateMetadata(result, 200)
  if (!exactKeys(data, ['operation_ref', 'target_guid', 'resulting_auth_version', 'resulting_permissions_version', 'resulting_role'])
      || !validOpaque(data.operation_ref, 'op_') || data.target_guid !== request.targetGuid
      || data.resulting_auth_version !== request.expectedAuthVersion + 1 || !validInt32(data.resulting_auth_version)
      || data.resulting_permissions_version !== request.expectedPermissionsVersion + 1 || !validPermissionVersion(data.resulting_permissions_version, false)
      || data.resulting_role !== ROLE_BY_SCOPE[scope]) invalidResponse()
  return Object.freeze({
    operationRef: data.operation_ref,
    targetGuid: data.target_guid,
    resultingAuthVersion: data.resulting_auth_version,
    resultingPermissionsVersion: data.resulting_permissions_version,
    resultingRole: data.resulting_role,
  })
}

function queryResponse(result, scope) {
  const { data, headers } = validateMetadata(result, 200, true)
  if (!exactKeys(data, ['operation_ref', 'scope', 'status', 'finished_at', 'failure_code', 'target_guid', 'resulting_auth_version', 'resulting_permissions_version', 'resulting_role'])
      || !validOpaque(data.operation_ref, 'op_') || data.scope !== scope
      || !['processing', 'succeeded', 'failed', 'pending_recovery'].includes(data.status)) invalidResponse()
  const retryText = headerValue(headers, 'Retry-After')
  const retryAfter = retryText !== null && /^[1-9]\d*$/.test(retryText) ? Number(retryText) : null
  const resultsNull = data.target_guid === null && data.resulting_auth_version === null
    && data.resulting_permissions_version === null && data.resulting_role === null
  if (data.status === 'processing') {
    if (data.finished_at !== null || data.failure_code !== null || !resultsNull
        || !Number.isSafeInteger(retryAfter) || retryAfter < 1 || retryAfter > 30) invalidResponse()
  } else if (data.status === 'succeeded') {
    if (!validTimestamp(data.finished_at) || data.failure_code !== null || retryText !== null || !validGuid(data.target_guid)
        || !validInt32(data.resulting_auth_version) || !validPermissionVersion(data.resulting_permissions_version, false)
        || data.resulting_role !== ROLE_BY_SCOPE[scope]) invalidResponse()
  } else if (data.status === 'failed') {
    if (!validTimestamp(data.finished_at) || !FAILURE_CODES.has(data.failure_code) || !resultsNull || retryText !== null) invalidResponse()
  } else if (data.finished_at !== null || data.failure_code !== null || !resultsNull || retryText !== null) invalidResponse()
  return Object.freeze({
    operationRef: data.operation_ref,
    scope: data.scope,
    status: data.status,
    finishedAt: data.finished_at,
    failureCode: data.failure_code,
    retryAfter,
    targetGuid: data.target_guid,
    resultingAuthVersion: data.resulting_auth_version,
    resultingPermissionsVersion: data.resulting_permissions_version,
    resultingRole: data.resulting_role,
  })
}

function publicFailure(code, status, operationRef = null, retryAfter = null) {
  const message = code === 'request_failed' ? '请求失败，请稍后重试' : code === 'authentication_failed' ? '认证已失效' : '请求无法完成'
  return Object.freeze(Object.assign(new Error(message), { code, status, operationRef, retryAfter }))
}

export function mapRolePermissionError(error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null
  const headers = error?.response?.headers
  const body = error?.response?.data
  const retryText = headerValue(headers, 'Retry-After')
  if (status === 401 && retryText === null && exactKeys(body, ['detail']) && ['未登录', 'Token无效或已过期'].includes(body.detail)) {
    return publicFailure('authentication_failed', status)
  }
  const payload = body?.error
  const code = payload?.code
  const operationUnknown = code === 'operation_commit_unknown'
  const expectedKeys = operationUnknown
    ? ['code', 'message', 'type', 'request_id', 'operation_ref']
    : ['code', 'message', 'type', 'request_id']
  const requestID = headerValue(headers, 'X-Request-ID')
  const retryAfter = retryText !== null && /^[1-9]\d*$/.test(retryText) ? Number(retryText) : null
  const retryValid = status === 429 ? Number.isSafeInteger(retryAfter) : retryText === null
  const valid = exactKeys(body, ['error']) && exactKeys(payload, expectedKeys)
    && STATUS_CODES.get(status)?.has(code) && payload.message === '请求无法完成' && payload.type === 'admin_action_error'
    && typeof payload.request_id === 'string' && payload.request_id.trim() !== '' && payload.request_id === requestID
    && headerValue(headers, 'Cache-Control') === 'no-store' && retryValid
    && (operationUnknown ? validOpaque(payload.operation_ref, 'op_') : payload.operation_ref === undefined)
  if (!valid) return publicFailure('request_failed', status)
  return publicFailure(code, status, operationUnknown ? payload.operation_ref : null, status === 429 ? retryAfter : null)
}

async function callTransport(invoke, parse) {
  try {
    const result = await invoke()
    if (!Number.isInteger(result?.status) || result.status < 200 || result.status >= 300) throw { response: result }
    return parse(result)
  } catch (error) {
    if (error instanceof InvalidA08Response) throw error
    throw mapRolePermissionError(error)
  }
}

export function createRolePermissionApi({ post, patch, get } = {}) {
  if (![post, patch, get].every(value => typeof value === 'function')) throw new TypeError('invalid_a08_api_dependencies')
  const issue = (scope, input) => {
    const request = normalizeIssue(input, scope)
    return callTransport(() => post('/admin/v2/action-verifications', intentBody(scope, request)), issueResponse)
  }
  const execute = (scope, input) => {
    const request = normalizeExecute(input, scope)
    const path = scope === 'users.permissions.write'
      ? `/admin/v2/users/${encodeURIComponent(request.targetGuid)}/permissions`
      : `/admin/v2/users/${encodeURIComponent(request.targetGuid)}/actions`
    const transport = scope === 'users.permissions.write' ? patch : post
    return callTransport(() => transport(path, executeBody(scope, request), { headers: {
      'Idempotency-Key': request.idempotencyKey,
      'X-Action-Ticket': request.ticket,
    } }), result => executeResponse(result, scope, request))
  }
  return Object.freeze({
    issuePromote: input => issue('users.promote', input),
    executePromote: input => execute('users.promote', input),
    issueDemote: input => issue('users.demote', input),
    executeDemote: input => execute('users.demote', input),
    issuePermissionWrite: input => issue('users.permissions.write', input),
    executePermissionWrite: input => execute('users.permissions.write', input),
    query(input) {
      if (!exactKeys(input, ['scope', 'idempotencyKey']) || !SCOPES.has(input.scope) || !validOpaque(input.idempotencyKey, 'ik_')) invalidRequest()
      return callTransport(() => get(`/admin/v2/operations?scope=${input.scope}`, { 'Idempotency-Key': input.idempotencyKey }), result => queryResponse(result, input.scope))
    },
  })
}

async function productionApi() {
  const { adminActionPost, adminActionPatch, adminActionQuery } = await import('./request.js')
  return createRolePermissionApi({ post: adminActionPost, patch: adminActionPatch, get: adminActionQuery })
}

export async function issueAdminUserPromote(input) { return (await productionApi()).issuePromote(input) }
export async function executeAdminUserPromote(input) { return (await productionApi()).executePromote(input) }
export async function issueAdminUserDemote(input) { return (await productionApi()).issueDemote(input) }
export async function executeAdminUserDemote(input) { return (await productionApi()).executeDemote(input) }
export async function issueAdminUserPermissionWrite(input) { return (await productionApi()).issuePermissionWrite(input) }
export async function executeAdminUserPermissionWrite(input) { return (await productionApi()).executePermissionWrite(input) }
export async function queryAdminUserRolePermission(input) { return (await productionApi()).query(input) }
