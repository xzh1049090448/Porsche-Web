import { mapUserReadDto } from './admin-users.js'

const MAX_INT32 = 2147483647
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const INPUT_KEYS = ['targetGuid', 'status', 'reason', 'expectedAuthVersion']
const FAILURE_CODES = new Map([
  [400, new Map([['invalid_admin_user_status_request', 'invalid_request']])],
  [401, new Map([['authentication_invalid', 'authentication_failed']])],
  [403, new Map([['user_status_forbidden', 'forbidden']])],
  [404, new Map([['user_not_found', 'not_found']])],
  [409, new Map([['auth_version_conflict', 'auth_version_conflict'], ['user_status_conflict', 'user_status_conflict']])],
  [413, new Map([['request_body_too_large', 'request_too_large']])],
  [503, new Map([['user_status_dependency_unavailable', 'unavailable']])],
])

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const compareDecimal = (left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0)
const headerValue = (headers, name) => {
  const value = typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]
  return typeof value === 'string' ? value : null
}
const invalidRequest = () => { throw new Error('invalid_admin_user_status_request') }
const invalidResponse = () => { throw new Error('invalid_admin_user_status_response') }

function validGuid(value) {
  return typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0
}

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

export function normalizeAdminUserStatusRequest(input) {
  if (!exactKeys(input, INPUT_KEYS) || !validGuid(input.targetGuid)
      || !['active', 'disabled'].includes(input.status)
      || !Number.isInteger(input.expectedAuthVersion) || input.expectedAuthVersion < 1 || input.expectedAuthVersion > MAX_INT32) invalidRequest()
  if (input.status === 'active') {
    if (input.reason !== null) invalidRequest()
    return Object.freeze({ targetGuid: input.targetGuid, status: input.status, reason: null, expectedAuthVersion: input.expectedAuthVersion })
  }
  if (typeof input.reason !== 'string' || hasLoneSurrogate(input.reason)) invalidRequest()
  const reason = input.reason.trim()
  if (!reason || [...reason].length > 200) invalidRequest()
  return Object.freeze({ targetGuid: input.targetGuid, status: input.status, reason, expectedAuthVersion: input.expectedAuthVersion })
}

function validateSuccess(result) {
  if (!exactKeys(result, ['data', 'status', 'headers']) || result.status !== 200
      || headerValue(result.headers, 'Cache-Control') !== 'no-store' || !headerValue(result.headers, 'X-Request-ID')?.trim()) invalidResponse()
  try { return Object.freeze(mapUserReadDto(result.data)) } catch { invalidResponse() }
}

const publicFailure = (code, status) => Object.freeze(Object.assign(new Error(code === 'request_failed' ? '请求失败，请稍后重试' : code), { code, status }))

export function mapAdminUserStatusError(error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null
  const expected = FAILURE_CODES.get(status)
  const headers = error?.response?.headers
  const requestID = headerValue(headers, 'X-Request-ID')
  const body = error?.response?.data
  const payload = body?.error
  const publicCode = expected?.get(payload?.code)
  const valid = publicCode && exactKeys(body, ['error']) && exactKeys(payload, ['code', 'message', 'kind', 'request_id'])
    && payload.message === '请求无法完成' && payload.kind === 'admin_user_status_error'
    && typeof payload.request_id === 'string' && requestID != null && requestID.trim() !== '' && payload.request_id === requestID
    && headerValue(headers, 'Cache-Control') === 'no-store' && headerValue(headers, 'Retry-After') == null
  return publicFailure(valid ? publicCode : 'request_failed', status)
}

export function createAdminUserStatusApi({ patch }) {
  if (typeof patch !== 'function') throw new TypeError('invalid_admin_user_status_api_dependencies')
  return Object.freeze({
    async patchAdminUserStatus(input) {
      const request = normalizeAdminUserStatusRequest(input)
      let result
      try {
        result = await patch(`/admin/v2/users/${encodeURIComponent(request.targetGuid)}/status`, {
          status: request.status,
          reason: request.reason,
          expected_auth_version: request.expectedAuthVersion,
        }, { headers: { 'Content-Type': 'application/json' } })
      } catch { throw publicFailure('request_failed', null) }
      if (result?.status !== 200) throw mapAdminUserStatusError({ response: result })
      return validateSuccess(result)
    },
  })
}

function createProductionPatch({ authenticatedFetch }) {
  if (typeof authenticatedFetch !== 'function') throw new TypeError('invalid_admin_user_status_transport')
  return async (path, body, config) => {
    const response = await authenticatedFetch(path, {
      method: 'PATCH',
      headers: config?.headers,
      body: JSON.stringify(body),
    })
    let data
    try { data = await response.json() } catch { data = null }
    return { data, status: response.status, headers: response.headers }
  }
}

export function createAdminUserStatusProductionApi({ authenticatedFetch }) {
  return createAdminUserStatusApi({ patch: createProductionPatch({ authenticatedFetch }) })
}

export async function patchAdminUserStatus(input, dependencies = {}) {
  let { authenticatedFetch } = dependencies
  if (typeof authenticatedFetch !== 'function') ({ authenticatedFetch } = await import('./request.js'))
  return createAdminUserStatusProductionApi({ authenticatedFetch }).patchAdminUserStatus(input)
}
