import { mapUserReadDto } from './admin-users.js'

const MAX_INT32 = 2147483647
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const INPUT_KEYS = ['targetGuid', 'nickname', 'expectedAuthVersion']
const FAILURE_CODES = new Map([
  [400, ['invalid_admin_user_edit_request', 'invalid_request']],
  [401, ['authentication_invalid', 'authentication_failed']],
  [403, ['user_edit_forbidden', 'forbidden']],
  [404, ['user_not_found', 'not_found']],
  [409, ['auth_version_conflict', 'auth_version_conflict']],
  [413, ['request_body_too_large', 'request_too_large']],
  [503, ['user_edit_dependency_unavailable', 'unavailable']],
])

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const compareDecimal = (left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0)
const headerValue = (headers, name) => {
  const value = typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]
  return typeof value === 'string' ? value : null
}
const invalidRequest = () => { throw new Error('invalid_admin_user_edit_request') }
const invalidResponse = () => { throw new Error('invalid_admin_user_edit_response') }

function validGuid(value) { return typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0 }
function hasLoneSurrogate(value) { return /[\uD800-\uDFFF]/u.test(value) }

export function normalizeAdminUserEditRequest(input) {
  if (!exactKeys(input, INPUT_KEYS) || !validGuid(input.targetGuid)
      || !Number.isInteger(input.expectedAuthVersion) || input.expectedAuthVersion < 1 || input.expectedAuthVersion > MAX_INT32) invalidRequest()
  if (input.nickname === null) return Object.freeze({ targetGuid: input.targetGuid, nickname: null, expectedAuthVersion: input.expectedAuthVersion })
  if (typeof input.nickname !== 'string' || hasLoneSurrogate(input.nickname)) invalidRequest()
  const nickname = input.nickname.trim()
  if (!nickname || [...nickname].length > 64) invalidRequest()
  return Object.freeze({ targetGuid: input.targetGuid, nickname, expectedAuthVersion: input.expectedAuthVersion })
}

function validateSuccess(result) {
  if (!exactKeys(result, ['data', 'status', 'headers']) || result.status !== 200
      || headerValue(result.headers, 'Cache-Control') !== 'no-store' || !headerValue(result.headers, 'X-Request-ID')?.trim()) invalidResponse()
  try { return Object.freeze(mapUserReadDto(result.data)) } catch { invalidResponse() }
}

const publicFailure = (code, status) => Object.freeze(Object.assign(new Error(code === 'request_failed' ? '请求失败，请稍后重试' : code), { code, status }))

export function mapAdminUserEditError(error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null
  const expected = FAILURE_CODES.get(status)
  const headers = error?.response?.headers
  const requestID = headerValue(headers, 'X-Request-ID')
  const body = error?.response?.data
  const payload = body?.error
  const valid = expected && exactKeys(body, ['error']) && exactKeys(payload, ['code', 'message', 'kind', 'request_id'])
    && payload.code === expected[0] && payload.message === '请求无法完成' && payload.kind === 'admin_user_edit_error'
    && typeof payload.request_id === 'string' && requestID != null && requestID.trim() !== '' && payload.request_id === requestID
    && headerValue(headers, 'Cache-Control') === 'no-store' && headerValue(headers, 'Retry-After') == null
  return publicFailure(valid ? expected[1] : 'request_failed', status)
}

export function createAdminUserEditApi({ patch }) {
  if (typeof patch !== 'function') throw new TypeError('invalid_admin_user_edit_api_dependencies')
  return Object.freeze({
    async patchAdminUserEdit(input) {
      const request = normalizeAdminUserEditRequest(input)
      try {
        return validateSuccess(await patch(`/admin/v2/users/${encodeURIComponent(request.targetGuid)}`, {
          nickname: request.nickname,
          expected_auth_version: request.expectedAuthVersion,
        }, { headers: { 'Content-Type': 'application/json' } }))
      } catch (error) {
        if (error?.message === 'invalid_admin_user_edit_response') throw error
        throw mapAdminUserEditError(error)
      }
    },
  })
}

function createProductionPatch({ authenticatedFetch }) {
  if (typeof authenticatedFetch !== 'function') throw new TypeError('invalid_admin_user_edit_transport')
  return async (path, body, config) => {
    const response = await authenticatedFetch(path, {
      method: 'PATCH',
      headers: config?.headers,
      body: JSON.stringify(body),
    })
    let data
    try { data = await response.json() } catch { data = null }
    if (!response.ok) throw { response: { status: response.status, data, headers: response.headers } }
    return { data, status: response.status, headers: response.headers }
  }
}

export function createAdminUserEditProductionApi({ authenticatedFetch }) {
  return createAdminUserEditApi({ patch: createProductionPatch({ authenticatedFetch }) })
}

export async function patchAdminUserEdit(input, dependencies = {}) {
  let { authenticatedFetch } = dependencies
  if (typeof authenticatedFetch !== 'function') ({ authenticatedFetch } = await import('./request.js'))
  return createAdminUserEditProductionApi({ authenticatedFetch }).patchAdminUserEdit(input)
}
