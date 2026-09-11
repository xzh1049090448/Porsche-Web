import { mapUserReadDto } from './admin-users.js'

const MAX_INT32 = 2147483647
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const OPAQUE = /^(?:av|op|ik)_[A-Za-z0-9_-]{43}$/
const PLANS = new Set(['free', 'professional', 'enterprise'])
const WEAK_PASSWORDS = new Set(['password', 'password123', '12345678', 'qwerty123', 'porsche', 'porsche@2026'])
const ACTION_FAILURES = new Set(['invalid_admin_action_request','action_verification_rejected','action_operation_rejected','action_target_not_found','action_operation_not_found','action_verification_conflict','idempotency_conflict','idempotency_cross_session','target_version_conflict','target_state_conflict','policy_version_conflict','consumer_validation_failed','operation_expired','request_body_too_large','action_rate_limited','action_dependency_unavailable','operation_commit_unknown'])
const DIRECT_FAILURES = new Set(['invalid_admin_user_entitlement_request','user_entitlement_forbidden','user_not_found','group_not_found','auth_version_conflict','user_group_conflict','user_plan_conflict','request_body_too_large','user_entitlement_dependency_unavailable'])
const ACTION_FAILURES_BY_STATUS = new Map([
  [400, new Set(['invalid_admin_action_request'])],
  [403, new Set(['action_verification_rejected','action_operation_rejected'])],
  [404, new Set(['action_target_not_found','action_operation_not_found'])],
  [409, new Set(['action_verification_conflict','idempotency_conflict','idempotency_cross_session','target_version_conflict','target_state_conflict','policy_version_conflict','consumer_validation_failed'])],
  [410, new Set(['operation_expired'])],
  [413, new Set(['request_body_too_large'])],
  [429, new Set(['action_rate_limited'])],
  [503, new Set(['action_dependency_unavailable','operation_commit_unknown'])],
])
const DIRECT_FAILURES_BY_STATUS = new Map([
  [400, new Set(['invalid_admin_user_entitlement_request'])],
  [403, new Set(['user_entitlement_forbidden'])],
  [404, new Set(['user_not_found','group_not_found'])],
  [409, new Set(['auth_version_conflict','user_group_conflict','user_plan_conflict'])],
  [413, new Set(['request_body_too_large'])],
  [503, new Set(['user_entitlement_dependency_unavailable'])],
])
const TERMINAL_OPERATION_FAILURES = new Set(['action_rejected','target_version_conflict','policy_version_conflict','target_state_conflict','consumer_validation_failed'])
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const headerValue = (headers, name) => typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()] ?? null
const validGuid = value => typeof value === 'string' && GUID.test(value) && (value.length < 19 || value <= MAX_INT64)
const validVersion = value => Number.isInteger(value) && value >= 1 && value <= MAX_INT32
class InvalidAdminUserEntitlementResponse extends Error { constructor() { super('invalid_admin_user_entitlement_response') } }
const invalidRequest = () => { throw new Error('invalid_admin_user_entitlement_request') }
const invalidResponse = () => { throw new InvalidAdminUserEntitlementResponse() }
const validPassword = value => typeof value === 'string' && [...value].length >= 8 && [...value].length <= 20
  && !/[\uD800-\uDFFF]/u.test(value) && !WEAK_PASSWORDS.has(value.trim().toLowerCase())

function normalizeCommon(input, exact) {
  if (!exactKeys(input, exact) || !validGuid(input.targetGuid) || !validVersion(input.expectedAuthVersion) || typeof input.reason !== 'string') invalidRequest()
  const reason = input.reason.trim()
  if (!reason || [...reason].length > 200 || /[\uD800-\uDFFF]/u.test(reason)) invalidRequest()
  return reason
}
export function normalizeGroupChangeRequest(input) {
  const reason = normalizeCommon(input, ['targetGuid','groupGuid','reason','expectedAuthVersion'])
  if (!validGuid(input.groupGuid)) invalidRequest()
  return Object.freeze({ targetGuid:input.targetGuid, groupGuid:input.groupGuid, reason, expectedAuthVersion:input.expectedAuthVersion })
}
export function normalizePlanChangeRequest(input) {
  const reason = normalizeCommon(input, ['targetGuid','planType','reason','expectedAuthVersion'])
  if (!PLANS.has(input.planType)) invalidRequest()
  return Object.freeze({ targetGuid:input.targetGuid, planType:input.planType, reason, expectedAuthVersion:input.expectedAuthVersion })
}
export function normalizePasswordResetRequest(input) {
  const reason = normalizeCommon(input, ['targetGuid','newPassword','reason','currentPassword','expectedAuthVersion'])
  if (!validPassword(input.newPassword) || typeof input.currentPassword !== 'string' || input.currentPassword.length < 1) invalidRequest()
  return Object.freeze({ targetGuid:input.targetGuid, newPassword:input.newPassword, reason, currentPassword:input.currentPassword, expectedAuthVersion:input.expectedAuthVersion })
}

function responseHeaders(result) {
  if (headerValue(result?.headers, 'Cache-Control') !== 'no-store' || !headerValue(result?.headers, 'X-Request-ID')?.trim()) invalidResponse()
}
function userResponse(result, expectedVersion) {
  if (result?.status !== 200) invalidResponse()
  responseHeaders(result)
  const user = mapUserReadDto(result.data)
  if (user.authVersion !== expectedVersion + 1) invalidResponse()
  return Object.freeze(user)
}
function opaque(value, prefix) { return typeof value === 'string' && value.startsWith(prefix) && OPAQUE.test(value) }
function issueResponse(result) {
  if (result?.status !== 201 || !exactKeys(result.data, ['ticket','expires_at']) || !opaque(result.data.ticket, 'av_') || !Number.isSafeInteger(result.data.expires_at) || result.data.expires_at <= 0) invalidResponse()
  responseHeaders(result); return Object.freeze({ ticket:result.data.ticket, expiresAt:result.data.expires_at })
}
function executeResponse(result, request) {
  if (result?.status !== 200 || !exactKeys(result.data, ['operation_ref','target_guid','resulting_auth_version']) || !opaque(result.data.operation_ref, 'op_')
      || result.data.target_guid !== request.targetGuid || result.data.resulting_auth_version !== request.expectedAuthVersion + 1 || !validVersion(result.data.resulting_auth_version)) invalidResponse()
  responseHeaders(result)
  return Object.freeze({ operationRef:result.data.operation_ref, targetGuid:result.data.target_guid, resultingAuthVersion:result.data.resulting_auth_version })
}
function queryResponse(result) {
  if (result?.status !== 200 || !exactKeys(result.data, ['operation_ref','scope','status','finished_at','failure_code','target_guid','resulting_auth_version']) || !opaque(result.data.operation_ref, 'op_') || result.data.scope !== 'users.reset_password'
      || !['processing','succeeded','failed','pending_recovery'].includes(result.data.status)) invalidResponse()
  responseHeaders(result)
  const retryText = headerValue(result.headers, 'Retry-After')
  const retryAfter = retryText == null ? null : Number(retryText)
  const terminalTime=Number.isSafeInteger(result.data.finished_at)&&result.data.finished_at>0
  const resultFields=result.data.target_guid!==null&&validGuid(result.data.target_guid)&&validVersion(result.data.resulting_auth_version)
  const validState=result.data.status==='processing' ? result.data.finished_at===null&&result.data.failure_code===null&&result.data.target_guid===null&&result.data.resulting_auth_version===null&&Number.isSafeInteger(retryAfter)&&retryAfter>=1&&retryAfter<=30
    : result.data.status==='succeeded' ? terminalTime&&result.data.failure_code===null&&resultFields&&retryText==null
    : result.data.status==='failed' ? terminalTime&&TERMINAL_OPERATION_FAILURES.has(result.data.failure_code)&&result.data.target_guid===null&&result.data.resulting_auth_version===null&&retryText==null
    : result.data.finished_at===null&&result.data.failure_code===null&&result.data.target_guid===null&&result.data.resulting_auth_version===null&&retryText==null
  if(!validState)invalidResponse()
  return Object.freeze({ operationRef:result.data.operation_ref, status:result.data.status, failureCode:result.data.failure_code, retryAfter, targetGuid:result.data.target_guid, resultingAuthVersion:result.data.resulting_auth_version })
}
const failure = (code, status, operationRef = null, retryAfter = null) => Object.freeze(Object.assign(new Error(code === 'request_failed' ? '请求失败，请稍后重试' : code), { code, status, operationRef, retryAfter }))
export function mapAdminUserEntitlementError(error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null
  const body = error?.response?.data
  const headers = error?.response?.headers
  if (status === 401 && exactKeys(body, ['detail']) && headerValue(headers,'Retry-After') == null) return failure('authentication_failed', status)
  const payload = body?.error
  const code = payload?.code
  const action = ACTION_FAILURES.has(code) && Object.hasOwn(payload ?? {}, 'type')
  const direct = DIRECT_FAILURES.has(code) && Object.hasOwn(payload ?? {}, 'kind')
  const keys = action
    ? (payload?.operation_ref === undefined ? ['code','message','type','request_id'] : ['code','message','type','request_id','operation_ref'])
    : ['code','message','kind','request_id']
  const requestID = headerValue(headers,'X-Request-ID')
  const retryText = headerValue(headers,'Retry-After')
  const retry = retryText == null ? null : Number(retryText)
  const valid = exactKeys(body,['error']) && exactKeys(payload,keys) && (action || direct)
    && (action ? payload.type === 'admin_action_error' && ACTION_FAILURES_BY_STATUS.get(status)?.has(code)
      : payload.kind === 'admin_user_entitlement_error' && DIRECT_FAILURES_BY_STATUS.get(status)?.has(code))
    && payload.message === '请求无法完成'
    && typeof payload.request_id === 'string' && payload.request_id === requestID && requestID?.trim() && headerValue(headers,'Cache-Control') === 'no-store'
    && (status === 429 ? Number.isSafeInteger(retry) && retry >= 1 : retryText == null)
    && (!action || (code === 'operation_commit_unknown' ? opaque(payload.operation_ref,'op_') : payload.operation_ref === undefined))
  return valid ? failure(code, status, payload.operation_ref ?? null, retry) : failure('request_failed', status)
}

export function createAdminUserEntitlementsApi({ patch, post, get }) {
  if (![patch,post,get].every(fn => typeof fn === 'function')) throw new TypeError('invalid_admin_user_entitlement_api_dependencies')
  const call = async fn => { try { return await fn() } catch (error) { if (error instanceof InvalidAdminUserEntitlementResponse) throw error; throw mapAdminUserEntitlementError(error) } }
  return Object.freeze({
    async changeGroup(input) { const request=normalizeGroupChangeRequest(input); const result=await call(() => patch(`/admin/v2/users/${encodeURIComponent(request.targetGuid)}/group`, { group_guid:request.groupGuid, reason:request.reason, expected_auth_version:request.expectedAuthVersion }, { headers:{'Content-Type':'application/json'} })); return userResponse(result,request.expectedAuthVersion) },
    async changePlan(input) { const request=normalizePlanChangeRequest(input); const result=await call(() => patch(`/admin/v2/users/${encodeURIComponent(request.targetGuid)}/plan`, { plan_type:request.planType, reason:request.reason, expected_auth_version:request.expectedAuthVersion }, { headers:{'Content-Type':'application/json'} })); return userResponse(result,request.expectedAuthVersion) },
    async issuePasswordReset(input) { const request=normalizePasswordResetRequest(input); return issueResponse(await call(() => post('/admin/v2/action-verifications', { action:'users.reset_password', intent:{ target_guid:request.targetGuid, expected_auth_version:request.expectedAuthVersion, new_password:request.newPassword, reason:request.reason }, current_password:request.currentPassword }))) },
    async executePasswordReset(input) { const reason=normalizeCommon({targetGuid:input?.targetGuid,reason:input?.reason,expectedAuthVersion:input?.expectedAuthVersion},['targetGuid','reason','expectedAuthVersion']); if(!validPassword(input.newPassword)||!opaque(input.ticket,'av_')||!opaque(input.idempotencyKey,'ik_')) invalidRequest(); const request={targetGuid:input.targetGuid,newPassword:input.newPassword,reason,expectedAuthVersion:input.expectedAuthVersion}; return executeResponse(await call(() => post(`/admin/v2/users/${encodeURIComponent(request.targetGuid)}/actions`, { action:'reset_password', expected_auth_version:request.expectedAuthVersion, new_password:request.newPassword, reason:request.reason }, { headers:{'Idempotency-Key':input.idempotencyKey,'X-Action-Ticket':input.ticket} })), request) },
    async queryPasswordReset({ idempotencyKey } = {}) { if (!opaque(idempotencyKey,'ik_')) invalidRequest(); return queryResponse(await call(() => get('/admin/v2/operations?scope=users.reset_password', {'Idempotency-Key':idempotencyKey}))) },
  })
}

function productionTransport(authenticatedFetch) {
  const request = async (method,path,body,headers={}) => { const response=await authenticatedFetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}); let data; try { data=await response.json() } catch { data=null }; const result={status:response.status,headers:response.headers,data}; if (!response.ok) throw { response:result }; return result }
  return { patch:(path,body,config)=>request('PATCH',path,body,config?.headers), post:(path,body,config)=>request('POST',path,body,config?.headers), get:(path,headers)=>request('GET',path,undefined,headers) }
}
async function productionApi() { const { authenticatedFetch }=await import('./request.js'); return createAdminUserEntitlementsApi(productionTransport(authenticatedFetch)) }
export async function changeAdminUserGroup(input) { return (await productionApi()).changeGroup(input) }
export async function changeAdminUserPlan(input) { return (await productionApi()).changePlan(input) }
export async function issueAdminUserPasswordReset(input) { return (await productionApi()).issuePasswordReset(input) }
export async function executeAdminUserPasswordReset(input) { return (await productionApi()).executePasswordReset(input) }
export async function queryAdminUserPasswordReset(input) { return (await productionApi()).queryPasswordReset(input) }
