import { normalizeAdminUserCreateRequest } from './admin-user-create.js'

export const ADMIN_USER_CREATE_STATES = Object.freeze({
  IDLE: 'idle',
  VERIFYING: 'verifying',
  SUBMITTING: 'submitting',
  UNKNOWN: 'unknown',
  QUERYING: 'querying',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  PENDING_RECOVERY: 'pending_recovery',
})

const TRANSITIONS = Object.freeze({
  [ADMIN_USER_CREATE_STATES.IDLE]: new Set([ADMIN_USER_CREATE_STATES.VERIFYING, ADMIN_USER_CREATE_STATES.SUBMITTING, ADMIN_USER_CREATE_STATES.FAILED]),
  [ADMIN_USER_CREATE_STATES.VERIFYING]: new Set([ADMIN_USER_CREATE_STATES.SUBMITTING, ADMIN_USER_CREATE_STATES.FAILED]),
  [ADMIN_USER_CREATE_STATES.SUBMITTING]: new Set([ADMIN_USER_CREATE_STATES.SUCCEEDED, ADMIN_USER_CREATE_STATES.FAILED, ADMIN_USER_CREATE_STATES.UNKNOWN]),
  [ADMIN_USER_CREATE_STATES.UNKNOWN]: new Set([ADMIN_USER_CREATE_STATES.QUERYING]),
  [ADMIN_USER_CREATE_STATES.QUERYING]: new Set([ADMIN_USER_CREATE_STATES.QUERYING, ADMIN_USER_CREATE_STATES.SUCCEEDED, ADMIN_USER_CREATE_STATES.FAILED, ADMIN_USER_CREATE_STATES.PENDING_RECOVERY]),
  [ADMIN_USER_CREATE_STATES.SUCCEEDED]: new Set(),
  [ADMIN_USER_CREATE_STATES.FAILED]: new Set(),
  [ADMIN_USER_CREATE_STATES.PENDING_RECOVERY]: new Set(),
})

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const TOKEN = /^(?:op|ik)_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const MAX_QUERY_ATTEMPTS = 5
const SAFE_FAILURE_CODES = new Set([
  'authentication_failed', 'invalid_admin_action_request', 'invalid_admin_user_create_request',
  'action_verification_rejected', 'action_operation_rejected', 'action_group_not_found', 'action_operation_not_found',
  'action_verification_conflict', 'username_conflict', 'idempotency_conflict', 'idempotency_cross_session',
  'action_rejected', 'target_version_conflict', 'policy_version_conflict', 'target_state_conflict', 'consumer_validation_failed',
  'operation_expired', 'action_inactive', 'action_rate_limited', 'action_dependency_unavailable', 'operation_commit_unknown',
  'request_failed', 'workflow_disposed',
])
const INPUT_KEYS = new Set(['username', 'nickname', 'password', 'role', 'groupGuid', 'planType', 'permissionOverrides', 'currentPassword'])
const CREATED_USER_KEYS = ['guid', 'username', 'nickname', 'email', 'group', 'planType', 'role', 'status', 'authVersion', 'createdAt', 'lastLoginAt']

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const validOpaque = (value, prefix) => typeof value === 'string' && TOKEN.test(value) && value.startsWith(prefix)

function createIdempotencyKey(randomBytes) {
  const bytes = randomBytes(32)
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error('invalid_random_source')
  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index
    const value = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0)
    encoded += BASE64URL[(value >>> 18) & 63]
    encoded += BASE64URL[(value >>> 12) & 63]
    if (remaining > 1) encoded += BASE64URL[(value >>> 6) & 63]
    if (remaining > 2) encoded += BASE64URL[value & 63]
  }
  return `ik_${encoded}`
}

function safeFailureCode(error) {
  return SAFE_FAILURE_CODES.has(error?.code) ? error.code : 'request_failed'
}

function safeOperationRef(value) {
  return validOpaque(value, 'op_') ? value : null
}

function safeCreatedUser(value) {
  if (!exactKeys(value, CREATED_USER_KEYS)
      || typeof value.guid !== 'string' || typeof value.username !== 'string'
      || !(value.nickname === null || typeof value.nickname === 'string') || value.email !== null
      || typeof value.group !== 'string' || !['free', 'professional', 'enterprise'].includes(value.planType)
      || !['user', 'admin'].includes(value.role) || value.status !== 'active' || value.authVersion !== 1
      || typeof value.createdAt !== 'string' || value.lastLoginAt !== null) throw new Error('invalid_created_user')
  return Object.freeze(Object.fromEntries(CREATED_USER_KEYS.map(key => [key, value[key]])))
}

function isAmbiguousCreate(error) {
  return error?.code === 'operation_commit_unknown' || !Number.isInteger(error?.status)
}

function boundedRetrySeconds(value) {
  return Math.min(30, Math.max(1, Number.isInteger(value) ? value : 1))
}

/**
 * Creates one memory-only managed-user creation attempt. schedule(callback,
 * delayMs) must return a cancellation function without invoking callback inline.
 */
export function createAdminUserCreateWorkflow({ api, randomBytes, schedule }) {
  if (!api || typeof api.issueAdminUserCreateVerification !== 'function'
      || typeof api.executeAdminUserCreate !== 'function' || typeof api.queryAdminUserCreate !== 'function'
      || typeof randomBytes !== 'function' || typeof schedule !== 'function') {
    throw new TypeError('invalid_admin_user_create_workflow_dependencies')
  }

  let state = ADMIN_USER_CREATE_STATES.IDLE
  let operationRef = null
  let failureCode = null
  let createdUser = null
  let activeRequest = null
  let currentPassword = null
  let ticket = null
  let idempotencyKey = null
  let scope = null
  let activeRun = null
  let resolveRun = null
  let cancelScheduled = null
  let queryInFlight = false
  let queryAttempts = 0
  let disposed = false
  let generation = 0
  const listeners = new Set()

  const snapshot = () => Object.freeze({ state, operationRef, failureCode, createdUser })
  const notify = () => {
    const value = snapshot()
    for (const listener of listeners) {
      try { listener(value) } catch { /* observers cannot control workflow state */ }
    }
  }
  const transition = next => {
    if (!TRANSITIONS[state].has(next)) throw new Error('invalid_admin_user_create_transition')
    state = next
    notify()
  }
  const clearTransient = () => {
    activeRequest = null
    currentPassword = null
    ticket = null
    idempotencyKey = null
    scope = null
    queryAttempts = 0
  }
  const clearSchedule = () => {
    const cancel = cancelScheduled
    cancelScheduled = null
    if (typeof cancel === 'function') {
      try { cancel() } catch { /* cancellation cannot retain workflow secrets */ }
    }
  }
  const settle = next => {
    generation++
    queryInFlight = false
    clearSchedule()
    clearTransient()
    if (!disposed && state !== next) transition(next)
    const value = snapshot()
    const resolve = resolveRun
    resolveRun = null
    if (resolve) resolve(value)
    return value
  }
  const fail = error => {
    failureCode = safeFailureCode(error)
    operationRef = safeOperationRef(error?.operationRef)
    createdUser = null
    return settle(ADMIN_USER_CREATE_STATES.FAILED)
  }

  const scheduleNextQuery = (runGeneration, delay) => {
    clearSchedule()
    let invokedSynchronously = false
    let consumed = false
    let scheduling = true
    let cancel
    try {
      cancel = schedule(() => {
        if (scheduling) {
          invokedSynchronously = true
          return
        }
        if (consumed) return
        consumed = true
        if (!disposed && runGeneration === generation) void query(runGeneration)
      }, delay)
    } catch {
      return fail(null)
    } finally {
      scheduling = false
    }
    if (typeof cancel !== 'function' || invokedSynchronously) {
      if (typeof cancel === 'function') {
        try { cancel() } catch { /* invalid scheduler is already failing closed */ }
      }
      return fail(null)
    }
    cancelScheduled = cancel
    return null
  }

  const query = async runGeneration => {
    if (disposed || runGeneration !== generation || queryInFlight) return null
    queryInFlight = true
    queryAttempts++
    try {
      const result = await api.queryAdminUserCreate({ scope, idempotencyKey })
      if (disposed || runGeneration !== generation) return null
      operationRef = safeOperationRef(result?.operationRef)
      if (operationRef == null || result?.scope !== scope) return fail(null)
      if (result.status === 'processing') {
        if (queryAttempts >= MAX_QUERY_ATTEMPTS) return settle(ADMIN_USER_CREATE_STATES.PENDING_RECOVERY)
        transition(ADMIN_USER_CREATE_STATES.QUERYING)
        return scheduleNextQuery(runGeneration, boundedRetrySeconds(result.retryAfter) * 1000)
      }
      if (result.status === 'succeeded') return settle(ADMIN_USER_CREATE_STATES.SUCCEEDED)
      if (result.status === 'failed') {
        failureCode = safeFailureCode({ code: result.failureCode })
        createdUser = null
        return settle(ADMIN_USER_CREATE_STATES.FAILED)
      }
      if (result.status === 'pending_recovery') return settle(ADMIN_USER_CREATE_STATES.PENDING_RECOVERY)
      return fail(null)
    } catch (error) {
      if (disposed || runGeneration !== generation) return null
      return fail(error)
    } finally {
      queryInFlight = false
    }
  }

  const run = async (runGeneration, input) => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(key => !INPUT_KEYS.has(key))) throw null
      activeRequest = normalizeAdminUserCreateRequest({
        username: input.username,
        nickname: input.nickname,
        password: input.password,
        role: input.role,
        groupGuid: input.groupGuid,
        planType: input.planType,
        permissionOverrides: input.permissionOverrides,
      })
      currentPassword = input.currentPassword ?? null
      if (activeRequest.role === 'admin' && (typeof currentPassword !== 'string' || currentPassword.length === 0)) throw null
      if (activeRequest.role === 'user') currentPassword = null
      scope = activeRequest.role === 'admin' ? 'users.create_admin' : 'users.create'
      idempotencyKey = createIdempotencyKey(randomBytes)
    } catch (error) {
      input = null
      return fail(error)
    }
    input = null

    if (activeRequest.role === 'admin') {
      transition(ADMIN_USER_CREATE_STATES.VERIFYING)
      try {
        const issued = await api.issueAdminUserCreateVerification({ request: activeRequest, currentPassword })
        currentPassword = null
        if (disposed || runGeneration !== generation) return null
        ticket = issued?.ticket
      } catch (error) {
        currentPassword = null
        if (disposed || runGeneration !== generation) return null
        return fail(error)
      }
    }

    transition(ADMIN_USER_CREATE_STATES.SUBMITTING)
    try {
      const result = await api.executeAdminUserCreate({ request: activeRequest, ticket, idempotencyKey })
      ticket = null
      if (disposed || runGeneration !== generation) return null
      if (!exactKeys(result, ['operationRef', 'user', 'permissionsVersion']) || !validOpaque(result.operationRef, 'op_')
          || (activeRequest.role === 'user' ? result.permissionsVersion !== null : result.permissionsVersion !== '1')) return fail(null)
      let safeUser
      try { safeUser = safeCreatedUser(result.user) } catch { return fail(null) }
      if (safeUser.username !== activeRequest.username || safeUser.nickname !== activeRequest.nickname
          || safeUser.role !== activeRequest.role || safeUser.planType !== activeRequest.plan_type
          || (activeRequest.group_guid === null && safeUser.group !== 'default')) return fail(null)
      operationRef = result.operationRef
      createdUser = safeUser
      return settle(ADMIN_USER_CREATE_STATES.SUCCEEDED)
    } catch (error) {
      ticket = null
      if (disposed || runGeneration !== generation) return null
      if (!isAmbiguousCreate(error)) return fail(error)
      operationRef = safeOperationRef(error?.operationRef)
      activeRequest = null
      currentPassword = null
      createdUser = null
      transition(ADMIN_USER_CREATE_STATES.UNKNOWN)
      transition(ADMIN_USER_CREATE_STATES.QUERYING)
      return query(runGeneration)
    }
  }

  const start = input => {
    if (disposed) return Promise.resolve(snapshot())
    if (activeRun) return activeRun
    if (state !== ADMIN_USER_CREATE_STATES.IDLE) return Promise.resolve(snapshot())
    const runGeneration = ++generation
    activeRun = new Promise(resolve => { resolveRun = resolve })
    void run(runGeneration, input)
    return activeRun
  }

  const reset = () => {
    if (disposed || state === ADMIN_USER_CREATE_STATES.IDLE) return false
    generation++
    queryInFlight = false
    clearSchedule()
    clearTransient()
    operationRef = null
    failureCode = null
    createdUser = null
    state = ADMIN_USER_CREATE_STATES.IDLE
    notify()
    const resolve = resolveRun
    resolveRun = null
    activeRun = null
    if (resolve) resolve(snapshot())
    return true
  }

  const unmount = () => {
    if (disposed) return
    disposed = true
    generation++
    queryInFlight = false
    clearSchedule()
    clearTransient()
    operationRef = null
    failureCode = 'workflow_disposed'
    createdUser = null
    state = ADMIN_USER_CREATE_STATES.FAILED
    listeners.clear()
    const resolve = resolveRun
    resolveRun = null
    activeRun = null
    if (resolve) resolve(snapshot())
  }

  const subscribe = listener => {
    if (typeof listener !== 'function') throw new TypeError('invalid_admin_user_create_listener')
    if (disposed) return () => {}
    listeners.add(listener)
    try { listener(snapshot()) } catch { /* observers cannot control workflow state */ }
    return () => listeners.delete(listener)
  }

  return Object.freeze({ start, reset, unmount, getSnapshot: snapshot, subscribe })
}
