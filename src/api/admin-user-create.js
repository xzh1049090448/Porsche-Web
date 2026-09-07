import { mapAdminActionError } from './admin-user-actions.js'
import { mapUserReadDto } from './admin-users.js'

const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const TOKEN = /^(?:av|op|ik)_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const PLANS = new Set(['free', 'professional', 'enterprise'])
const ROLES = new Set(['user', 'admin'])
const EFFECTS = new Set(['allow', 'deny'])
const WEAK_PASSWORDS = new Set(['password', 'password123', '12345678', 'qwerty123', 'porsche', 'porsche@2026'])
const REQUEST_KEYS = ['username', 'nickname', 'password', 'role', 'group_guid', 'plan_type', 'permission_overrides']
const INPUT_KEYS = new Set(['username', 'nickname', 'password', 'role', 'groupGuid', 'planType', 'permissionOverrides'])
const GRANTABLE_CAPABILITIES = Object.freeze([
  'users.read', 'users.create', 'users.edit', 'users.enable', 'users.disable', 'users.reset_password',
  'users.sessions.read', 'users.sessions.revoke', 'users.plan.change', 'users.group.change', 'users.delete',
  'users.deleted.read', 'users.audit.read', 'groups.read', 'public_content.read', 'public_content.edit',
  'public_content.preview', 'public_content.publish', 'public_content.rollback',
])
const GRANTABLE_CAPABILITY_SET = new Set(GRANTABLE_CAPABILITIES)
const CAPABILITY_ORDER = new Map(GRANTABLE_CAPABILITIES.map((name, index) => [name, index]))
const CREATE_FAILURES = new Map([
  [400, new Set(['invalid_admin_user_create_request'])],
  [404, new Set(['action_group_not_found'])],
  [409, new Set(['username_conflict'])],
])

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const compareDecimal = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
const validGuid = value => typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0
const validOpaque = (value, prefix) => typeof value === 'string' && TOKEN.test(value) && value.startsWith(prefix)
const validTimestamp = value => Number.isSafeInteger(value) && value > 0

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) { index++; continue }
      return true
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return true
  }
  return false
}

function invalidRequest() {
  throw Object.assign(new Error('invalid_admin_user_create_request'), { code: 'invalid_admin_user_create_request', status: 400 })
}

class InvalidAdminUserCreateResponse extends Error {
  constructor() { super('invalid_admin_user_create_response') }
}
const invalidResponse = () => { throw new InvalidAdminUserCreateResponse() }

function headerValue(headers, name) {
  if (!headers) return null
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]
  return typeof value === 'string' ? value : null
}

function responseMetadata(result, status) {
  if (!exactKeys(result, ['data', 'status', 'headers']) || result.status !== status
      || headerValue(result.headers, 'Cache-Control') !== 'no-store') invalidResponse()
  const requestID = headerValue(result.headers, 'X-Request-ID')
  if (requestID == null || requestID.trim() === '') invalidResponse()
  return result
}

function normalizeNickname(value) {
  if (value == null) return null
  if (typeof value !== 'string' || hasLoneSurrogate(value)) invalidRequest()
  const nickname = value.trim()
  if (nickname === '' || [...nickname].length > 64) invalidRequest()
  return nickname
}

function normalizePassword(value) {
  if (typeof value !== 'string' || hasLoneSurrogate(value) || [...value].length < 8 || [...value].length > 20
      || WEAK_PASSWORDS.has(value.trim().toLowerCase())) invalidRequest()
  return value
}

function normalizeOverrides(value, role) {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) invalidRequest()
  const seen = new Set()
  const normalized = value.map(item => {
    if (!exactKeys(item, ['capability', 'effect']) || typeof item.capability !== 'string' || !EFFECTS.has(item.effect) || seen.has(item.capability)) invalidRequest()
    if (!GRANTABLE_CAPABILITY_SET.has(item.capability)) invalidRequest()
    seen.add(item.capability)
    return Object.freeze({ capability: item.capability, effect: item.effect })
  })
  if (role !== 'admin' && normalized.length !== 0) invalidRequest()
  normalized.sort((left, right) => CAPABILITY_ORDER.get(left.capability) - CAPABILITY_ORDER.get(right.capability))
  return Object.freeze(normalized)
}

export function normalizeAdminUserCreateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !INPUT_KEYS.has(key))) invalidRequest()
  if (typeof input.username !== 'string') invalidRequest()
  const username = input.username.trim()
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) invalidRequest()
  const password = normalizePassword(input.password)
  if (!ROLES.has(input.role)) invalidRequest()
  const groupGuid = input.groupGuid == null ? null : input.groupGuid
  if (groupGuid !== null && !validGuid(groupGuid)) invalidRequest()
  const planType = input.planType === undefined ? 'free' : input.planType
  if (!PLANS.has(planType)) invalidRequest()
  return Object.freeze({
    username,
    nickname: normalizeNickname(input.nickname),
    password,
    role: input.role,
    group_guid: groupGuid,
    plan_type: planType,
    permission_overrides: normalizeOverrides(input.permissionOverrides, input.role),
  })
}

function normalizedRequestMatches(request, normalized) {
  if (!exactKeys(request, REQUEST_KEYS)) return false
  for (const key of REQUEST_KEYS.slice(0, -1)) {
    if (request[key] !== normalized[key]) return false
  }
  return Array.isArray(request.permission_overrides)
    && request.permission_overrides.length === normalized.permission_overrides.length
    && request.permission_overrides.every((item, index) => exactKeys(item, ['capability', 'effect'])
      && item.capability === normalized.permission_overrides[index].capability
      && item.effect === normalized.permission_overrides[index].effect)
}

function validateNormalizedRequest(request) {
  if (!exactKeys(request, REQUEST_KEYS)) invalidRequest()
  const normalized = normalizeAdminUserCreateRequest({
    username: request.username,
    nickname: request.nickname,
    password: request.password,
    role: request.role,
    groupGuid: request.group_guid,
    planType: request.plan_type,
    permissionOverrides: request.permission_overrides,
  })
  if (!normalizedRequestMatches(request, normalized)) invalidRequest()
  return request
}

function validateOpaque(value, prefix) {
  if (!validOpaque(value, prefix)) invalidRequest()
}

function issueResponse(result) {
  const { data } = responseMetadata(result, 201)
  if (!exactKeys(data, ['ticket', 'expires_at']) || !validOpaque(data.ticket, 'av_') || !validTimestamp(data.expires_at)) invalidResponse()
  return Object.freeze({ ticket: data.ticket, expiresAt: data.expires_at })
}

function createResponse(result, request) {
  const { data } = responseMetadata(result, 201)
  if (!exactKeys(data, ['operation_ref', 'user', 'permissions_version']) || !validOpaque(data.operation_ref, 'op_')
      || typeof data.user?.username !== 'string' || data.user.username !== request.username || data.user.role !== request.role
      || data.user.nickname !== request.nickname || data.user.plan_type !== request.plan_type
      || (request.group_guid === null && data.user.group !== 'default')
      || data.user.status !== 'active' || data.user.auth_version !== 1 || data.user.last_login_at !== null
      || (request.role === 'user' ? data.permissions_version !== null : data.permissions_version !== '1')) invalidResponse()
  let user
  try { user = Object.freeze(mapUserReadDto(data.user)) } catch { invalidResponse() }
  return Object.freeze({ operationRef: data.operation_ref, user, permissionsVersion: data.permissions_version })
}

function queryResponse(result, scope) {
  const { data, headers } = responseMetadata(result, 200)
  if (!exactKeys(data, ['operation_ref', 'scope', 'status', 'finished_at', 'failure_code'])
      || !validOpaque(data.operation_ref, 'op_') || data.scope !== scope) invalidResponse()
  const terminal = data.status === 'succeeded' || data.status === 'failed'
  const failureCodes = new Set(['action_rejected', 'target_version_conflict', 'policy_version_conflict', 'target_state_conflict', 'consumer_validation_failed'])
  if (!['processing', 'succeeded', 'failed', 'pending_recovery'].includes(data.status)
      || (terminal ? !validTimestamp(data.finished_at) : data.finished_at !== null)
      || (data.status === 'failed' ? !failureCodes.has(data.failure_code) : data.failure_code !== null)) invalidResponse()
  const retryText = headerValue(headers, 'Retry-After')
  const retryAfter = retryText == null ? null : Number(retryText)
  if (data.status === 'processing'
    ? retryText == null || !/^\d+$/.test(retryText) || !Number.isInteger(retryAfter) || retryAfter < 1 || retryAfter > 30
    : retryText != null) invalidResponse()
  return Object.freeze({
    operationRef: data.operation_ref,
    scope: data.scope,
    status: data.status,
    finishedAt: data.finished_at,
    failureCode: data.failure_code,
    retryAfter,
  })
}

function publicFailure(code, message, status, operationRef, retryAfter) {
  return Object.freeze({ code, message, status, operationRef, retryAfter })
}

function secureErrorMetadata(error) {
  const response = error?.response
  if (headerValue(response?.headers, 'Cache-Control') !== 'no-store') return false
  const requestID = headerValue(response?.headers, 'X-Request-ID')
  if (requestID == null || requestID.trim() === '') return false
  const payload = response?.data?.error
  return payload == null || payload.request_id === requestID
}

export function mapAdminUserCreateError(error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null
  if (status === 410) {
    const body = error.response.data
    const payload = body?.error
    const deleted = payload?.code === 'created_user_deleted'
    const expired = payload?.code === 'operation_expired'
    const expectedKeys = deleted
      ? ['code', 'message', 'type', 'request_id', 'operation_ref']
      : ['code', 'message', 'type', 'request_id']
    const valid = (deleted || expired)
      && exactKeys(body, ['error']) && exactKeys(payload, expectedKeys)
      && payload.message === '请求无法完成' && payload.type === 'admin_action_error'
      && typeof payload.request_id === 'string' && payload.request_id.trim() !== ''
      && (deleted ? validOpaque(payload.operation_ref, 'op_') : payload.operation_ref === undefined)
      && secureErrorMetadata(error)
      && headerValue(error.response.headers, 'Retry-After') == null
    if (!valid) return publicFailure('request_failed', '请求失败，请稍后重试', status, null, null)
    return publicFailure(payload.code, payload.message, status, deleted ? payload.operation_ref : null, null)
  }
  const established = mapAdminActionError(error)
  if (established.code !== 'request_failed') {
    return secureErrorMetadata(error) ? established : publicFailure('request_failed', '请求失败，请稍后重试', status, null, null)
  }

  const body = error?.response?.data
  const payload = body?.error
  const expectedKeys = payload?.operation_ref === undefined
    ? ['code', 'message', 'type', 'request_id']
    : ['code', 'message', 'type', 'request_id', 'operation_ref']
  const valid = exactKeys(body, ['error']) && exactKeys(payload, expectedKeys)
    && CREATE_FAILURES.get(status)?.has(payload.code)
    && payload.message === '请求无法完成' && payload.type === 'admin_action_error'
    && typeof payload.request_id === 'string' && payload.request_id.trim() !== ''
    && payload.operation_ref === undefined && secureErrorMetadata(error)
    && headerValue(error.response.headers, 'Retry-After') == null
  if (!valid) return publicFailure('request_failed', '请求失败，请稍后重试', status, null, null)
  return publicFailure(payload.code, payload.message, status, null, null)
}

export function createAdminUserCreateApi({ post, get }) {
  if (typeof post !== 'function' || typeof get !== 'function') throw new TypeError('invalid_admin_user_create_api_dependencies')
  return Object.freeze({
    async issueAdminUserCreateVerification({ request, currentPassword }) {
      request = validateNormalizedRequest(request)
      if (request.role !== 'admin' || typeof currentPassword !== 'string' || currentPassword.length === 0 || hasLoneSurrogate(currentPassword)) invalidRequest()
      try {
        return issueResponse(await post('/admin/v2/action-verifications', {
          action: 'users.create_admin', intent: request, current_password: currentPassword,
        }))
      } catch (error) {
        if (error instanceof InvalidAdminUserCreateResponse) throw error
        throw mapAdminUserCreateError(error)
      }
    },

    async executeAdminUserCreate({ request, ticket, idempotencyKey }) {
      request = validateNormalizedRequest(request)
      validateOpaque(idempotencyKey, 'ik_')
      let headers
      if (request.role === 'admin') {
        validateOpaque(ticket, 'av_')
        headers = { 'Idempotency-Key': idempotencyKey, 'X-Action-Ticket': ticket }
      } else {
        if (ticket != null) invalidRequest()
        headers = { 'Idempotency-Key': idempotencyKey }
      }
      try {
        return createResponse(await post('/admin/v2/users', request, { headers }), request)
      } catch (error) {
        if (error instanceof InvalidAdminUserCreateResponse) throw error
        throw mapAdminUserCreateError(error)
      }
    },

    async queryAdminUserCreate({ scope, idempotencyKey }) {
      if (scope !== 'users.create' && scope !== 'users.create_admin') invalidRequest()
      validateOpaque(idempotencyKey, 'ik_')
      try {
        return queryResponse(await get(`/admin/v2/operations?scope=${scope}`, { 'Idempotency-Key': idempotencyKey }), scope)
      } catch (error) {
        if (error instanceof InvalidAdminUserCreateResponse) throw error
        throw mapAdminUserCreateError(error)
      }
    },
  })
}

async function productionApi() {
  const { adminActionPost, adminActionQuery } = await import('./request.js')
  return createAdminUserCreateApi({ post: adminActionPost, get: adminActionQuery })
}

export async function issueAdminUserCreateVerification(input) {
  return (await productionApi()).issueAdminUserCreateVerification(input)
}
export async function executeAdminUserCreate(input) {
  return (await productionApi()).executeAdminUserCreate(input)
}
export async function queryAdminUserCreate(input) {
  return (await productionApi()).queryAdminUserCreate(input)
}
