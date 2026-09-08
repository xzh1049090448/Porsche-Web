import { mapUserReadDto } from './admin-users.js'

const MAX_INT32 = 2147483647
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const INPUT_KEYS = ['targetGuid', 'nickname', 'expectedAuthVersion']
const FAILURE_CODES = new Map([
  [400, 'invalid_request'], [401, 'authentication_failed'], [403, 'forbidden'], [404, 'not_found'],
  [413, 'request_too_large'], [503, 'unavailable'],
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

function publicFailure(error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null
  const headers = error?.response?.headers
  const secure = headerValue(headers, 'Cache-Control') === 'no-store' && !!headerValue(headers, 'X-Request-ID')?.trim()
  let code = FAILURE_CODES.get(status) ?? 'request_failed'
  if (status === 409 && secure && error.response?.data?.error?.code === 'auth_version_conflict') code = 'auth_version_conflict'
  if (!secure) code = 'request_failed'
  return Object.freeze(Object.assign(new Error(code === 'request_failed' ? '请求失败，请稍后重试' : code), { code, status }))
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
        throw publicFailure(error)
      }
    },
  })
}

async function productionPatch(path, body, config) {
  const { authenticatedFetch } = await import('./request.js')
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

export async function patchAdminUserEdit(input) {
  return createAdminUserEditApi({ patch: productionPatch }).patchAdminUserEdit(input)
}
