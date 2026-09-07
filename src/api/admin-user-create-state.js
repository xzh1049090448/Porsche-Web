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
  let activeAttempt = null
  let disposed = false
  let generation = 0
  const listeners = new Set()

  const snapshot = () => Object.freeze({ state, operationRef, failureCode, createdUser })
  const owns = attempt => !disposed && activeAttempt === attempt && !attempt.aborted && !attempt.settled
    && attempt.generation === generation
  const notify = (expectedGeneration, value = snapshot()) => {
    if (generation !== expectedGeneration) return false
    for (const listener of listeners) {
      try { listener(value) } catch { /* observers cannot control workflow state */ }
      if (generation !== expectedGeneration) return false
    }
    return true
  }
  const transition = (attempt, next) => {
    if (!owns(attempt)) return false
    if (!TRANSITIONS[state].has(next)) throw new Error('invalid_admin_user_create_transition')
    state = next
    return notify(attempt.generation) && owns(attempt)
  }
  const clearAttempt = attempt => {
    attempt.request = null
    attempt.currentPassword = null
    attempt.ticket = null
    attempt.idempotencyKey = null
    attempt.scope = null
    attempt.queryAttempts = 0
    attempt.queryInFlight = false
  }
  const takeSchedule = attempt => {
    const cancel = attempt.cancelScheduled
    attempt.cancelScheduled = null
    return cancel
  }
  const cancelSchedule = attempt => {
    const cancel = takeSchedule(attempt)
    if (typeof cancel === 'function') {
      try { cancel() } catch { /* cancellation cannot retain workflow secrets */ }
    }
  }
  const settle = (attempt, next) => {
    if (!owns(attempt)) return null
    if (!TRANSITIONS[state].has(next)) throw new Error('invalid_admin_user_create_transition')
    attempt.settled = true
    generation++
    const notificationGeneration = generation
    const cancel = takeSchedule(attempt)
    clearAttempt(attempt)
    state = next
    const value = snapshot()
    const resolve = attempt.resolve
    attempt.resolve = null
    if (resolve) resolve(value)
    if (typeof cancel === 'function') {
      try { cancel() } catch { /* terminal state and cleared secrets are already fixed */ }
    }
    notify(notificationGeneration, value)
    return value
  }
  const fail = (attempt, error) => {
    if (!owns(attempt)) return null
    failureCode = safeFailureCode(error)
    operationRef = safeOperationRef(error?.operationRef)
    createdUser = null
    return settle(attempt, ADMIN_USER_CREATE_STATES.FAILED)
  }

  const scheduleNextQuery = (attempt, delay) => {
    if (!owns(attempt)) return null
    cancelSchedule(attempt)
    if (!owns(attempt)) return null
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
        if (owns(attempt)) void query(attempt)
      }, delay)
    } catch {
      return fail(attempt, null)
    } finally {
      scheduling = false
    }
    if (typeof cancel !== 'function' || invokedSynchronously) {
      if (typeof cancel === 'function') {
        try { cancel() } catch { /* invalid scheduler is already failing closed */ }
      }
      return fail(attempt, null)
    }
    if (!owns(attempt)) {
      try { cancel() } catch { /* abandoned attempts cannot retain callbacks */ }
      return null
    }
    attempt.cancelScheduled = cancel
    return null
  }

  const query = async attempt => {
    if (!owns(attempt) || attempt.queryInFlight) return null
    attempt.queryInFlight = true
    attempt.queryAttempts++
    try {
      const result = await api.queryAdminUserCreate({ scope: attempt.scope, idempotencyKey: attempt.idempotencyKey })
      if (!owns(attempt)) return null
      operationRef = safeOperationRef(result?.operationRef)
      if (operationRef == null || result?.scope !== attempt.scope) return fail(attempt, null)
      if (result.status === 'processing') {
        if (attempt.queryAttempts >= MAX_QUERY_ATTEMPTS) return settle(attempt, ADMIN_USER_CREATE_STATES.PENDING_RECOVERY)
        if (!transition(attempt, ADMIN_USER_CREATE_STATES.QUERYING)) return null
        return scheduleNextQuery(attempt, boundedRetrySeconds(result.retryAfter) * 1000)
      }
      if (result.status === 'succeeded') return settle(attempt, ADMIN_USER_CREATE_STATES.SUCCEEDED)
      if (result.status === 'failed') {
        failureCode = safeFailureCode({ code: result.failureCode })
        createdUser = null
        return settle(attempt, ADMIN_USER_CREATE_STATES.FAILED)
      }
      if (result.status === 'pending_recovery') return settle(attempt, ADMIN_USER_CREATE_STATES.PENDING_RECOVERY)
      return fail(attempt, null)
    } catch (error) {
      if (!owns(attempt)) return null
      return fail(attempt, error)
    } finally {
      attempt.queryInFlight = false
    }
  }

  const run = async (attempt, input) => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(key => !INPUT_KEYS.has(key))) throw null
      attempt.request = normalizeAdminUserCreateRequest({
        username: input.username,
        nickname: input.nickname,
        password: input.password,
        role: input.role,
        groupGuid: input.groupGuid,
        planType: input.planType,
        permissionOverrides: input.permissionOverrides,
      })
      attempt.currentPassword = input.currentPassword ?? null
      if (attempt.request.role === 'admin' && (typeof attempt.currentPassword !== 'string' || attempt.currentPassword.length === 0)) throw null
      if (attempt.request.role === 'user') attempt.currentPassword = null
      attempt.scope = attempt.request.role === 'admin' ? 'users.create_admin' : 'users.create'
      attempt.idempotencyKey = createIdempotencyKey(randomBytes)
    } catch (error) {
      input = null
      return fail(attempt, error)
    }
    input = null

    if (attempt.request.role === 'admin') {
      if (!transition(attempt, ADMIN_USER_CREATE_STATES.VERIFYING)) return null
      try {
        const issued = await api.issueAdminUserCreateVerification({
          request: attempt.request, currentPassword: attempt.currentPassword,
        })
        attempt.currentPassword = null
        if (!owns(attempt)) return null
        attempt.ticket = issued?.ticket
      } catch (error) {
        attempt.currentPassword = null
        if (!owns(attempt)) return null
        return fail(attempt, error)
      }
    }

    if (!transition(attempt, ADMIN_USER_CREATE_STATES.SUBMITTING)) return null
    try {
      const result = await api.executeAdminUserCreate({
        request: attempt.request, ticket: attempt.ticket, idempotencyKey: attempt.idempotencyKey,
      })
      attempt.ticket = null
      if (!owns(attempt)) return null
      if (!exactKeys(result, ['operationRef', 'user', 'permissionsVersion']) || !validOpaque(result.operationRef, 'op_')
          || (attempt.request.role === 'user' ? result.permissionsVersion !== null : result.permissionsVersion !== '1')) return fail(attempt, null)
      let safeUser
      try { safeUser = safeCreatedUser(result.user) } catch { return fail(attempt, null) }
      if (safeUser.username !== attempt.request.username || safeUser.nickname !== attempt.request.nickname
          || safeUser.role !== attempt.request.role || safeUser.planType !== attempt.request.plan_type
          || (attempt.request.group_guid === null && safeUser.group !== 'default')) return fail(attempt, null)
      operationRef = result.operationRef
      createdUser = safeUser
      return settle(attempt, ADMIN_USER_CREATE_STATES.SUCCEEDED)
    } catch (error) {
      attempt.ticket = null
      if (!owns(attempt)) return null
      if (!isAmbiguousCreate(error)) return fail(attempt, error)
      operationRef = safeOperationRef(error?.operationRef)
      attempt.request = null
      attempt.currentPassword = null
      createdUser = null
      if (!transition(attempt, ADMIN_USER_CREATE_STATES.UNKNOWN)) return null
      if (!transition(attempt, ADMIN_USER_CREATE_STATES.QUERYING)) return null
      return query(attempt)
    }
  }

  const start = input => {
    if (disposed) return Promise.resolve(snapshot())
    if (activeAttempt) return activeAttempt.promise
    if (state !== ADMIN_USER_CREATE_STATES.IDLE) return Promise.resolve(snapshot())
    const attempt = {
      generation: ++generation,
      request: null,
      currentPassword: null,
      ticket: null,
      idempotencyKey: null,
      scope: null,
      promise: null,
      resolve: null,
      cancelScheduled: null,
      queryInFlight: false,
      queryAttempts: 0,
      aborted: false,
      settled: false,
    }
    attempt.promise = new Promise(resolve => { attempt.resolve = resolve })
    activeAttempt = attempt
    const promise = attempt.promise
    void run(attempt, input)
    return promise
  }

  const reset = () => {
    if (disposed || state === ADMIN_USER_CREATE_STATES.IDLE) return false
    const attempt = activeAttempt
    generation++
    const notificationGeneration = generation
    activeAttempt = null
    let cancel = null
    let resolve = null
    if (attempt) {
      attempt.aborted = true
      cancel = takeSchedule(attempt)
      clearAttempt(attempt)
      resolve = attempt.resolve
      attempt.resolve = null
    }
    operationRef = null
    failureCode = null
    createdUser = null
    state = ADMIN_USER_CREATE_STATES.IDLE
    const value = snapshot()
    if (resolve) resolve(value)
    if (typeof cancel === 'function') {
      try { cancel() } catch { /* reset state and cleared secrets are already fixed */ }
    }
    notify(notificationGeneration, value)
    return true
  }

  const unmount = () => {
    if (disposed) return
    const attempt = activeAttempt
    disposed = true
    generation++
    activeAttempt = null
    let cancel = null
    let resolve = null
    if (attempt) {
      attempt.aborted = true
      cancel = takeSchedule(attempt)
      clearAttempt(attempt)
      resolve = attempt.resolve
      attempt.resolve = null
    }
    operationRef = null
    failureCode = 'workflow_disposed'
    createdUser = null
    state = ADMIN_USER_CREATE_STATES.FAILED
    listeners.clear()
    const value = snapshot()
    if (resolve) resolve(value)
    if (typeof cancel === 'function') {
      try { cancel() } catch { /* disposed state and cleared secrets are already fixed */ }
    }
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
