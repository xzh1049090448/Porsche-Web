export const ROLE_PERMISSION_PHASES = Object.freeze({
  IDLE: 'idle',
  VERIFYING: 'verifying',
  EXECUTING: 'executing',
  QUERYING: 'querying',
  SUCCEEDED: 'succeeded',
  CONFLICT: 'conflict',
  FAILED: 'failed',
  PENDING_RECOVERY: 'pending_recovery',
})

const ACTION_METHODS = Object.freeze({
  'users.promote': Object.freeze({ issue: 'issuePromote', execute: 'executePromote' }),
  'users.demote': Object.freeze({ issue: 'issueDemote', execute: 'executeDemote' }),
  'users.permissions.write': Object.freeze({ issue: 'issuePermissionWrite', execute: 'executePermissionWrite' }),
})
const CONFLICT_CODES = new Set([
  'action_verification_conflict',
  'idempotency_conflict',
  'idempotency_cross_session',
  'action_rejected',
  'target_version_conflict',
  'policy_version_conflict',
  'target_state_conflict',
  'consumer_validation_failed',
])
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

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

const safeCode = error => typeof error?.code === 'string' ? error.code : 'request_failed'
const ambiguousExecute = error => error?.code === 'operation_commit_unknown' || !Number.isInteger(error?.status)
const retryDelay = value => Math.min(30, Math.max(1, Number.isInteger(value) ? value : 1)) * 1000

function copyIntent(input) {
  const intent = {
    targetGuid: input?.targetGuid,
    expectedAuthVersion: input?.expectedAuthVersion,
    expectedPermissionsVersion: input?.expectedPermissionsVersion,
    catalogVersion: input?.catalogVersion,
    reason: input?.reason,
  }
  if (Array.isArray(input?.overrides)) intent.overrides = input.overrides.map(item => ({ ...item }))
  return Object.freeze(intent)
}

export function createRolePermissionAttempt({ api, randomBytes, schedule } = {}) {
  if (!api || typeof api.query !== 'function' || typeof randomBytes !== 'function' || typeof schedule !== 'function') {
    throw new TypeError('invalid_role_permission_attempt_dependencies')
  }
  let phase = ROLE_PERMISSION_PHASES.IDLE
  let scope = null
  let operationRef = null
  let failureCode = null
  let resultValues = null
  let intent = null
  let password = null
  let ticket = null
  let idempotencyKey = null
  let activeRun = null
  let resolveRun = null
  let cancelScheduled = null
  let queryInFlight = false
  let disposed = false
  let generation = 0
  const listeners = new Set()

  const snapshot = () => Object.freeze({
    phase,
    scope,
    operationRef,
    failureCode,
    targetGuid: resultValues?.targetGuid ?? null,
    resultingAuthVersion: resultValues?.resultingAuthVersion ?? null,
    resultingPermissionsVersion: resultValues?.resultingPermissionsVersion ?? null,
    resultingRole: resultValues?.resultingRole ?? null,
  })
  const notify = () => {
    const value = snapshot()
    for (const listener of listeners) {
      try { listener(value) } catch { /* observers cannot alter attempt ownership */ }
    }
    return value
  }
  const transition = next => { phase = next; return notify() }
  const clearSchedule = () => {
    const cancel = cancelScheduled
    cancelScheduled = null
    if (typeof cancel === 'function') {
      try { cancel() } catch { /* cancellation cannot retain secrets */ }
    }
  }
  const clearSecrets = () => { password = null; ticket = null; idempotencyKey = null }
  const finish = (next, code = null, result = null) => {
    clearSchedule()
    queryInFlight = false
    clearSecrets()
    intent = null
    failureCode = code
    resultValues = result
    if (result?.operationRef) operationRef = result.operationRef
    const value = transition(next)
    const resolve = resolveRun
    resolveRun = null
    resolve?.(value)
    return value
  }
  const fail = error => finish(CONFLICT_CODES.has(safeCode(error)) ? ROLE_PERMISSION_PHASES.CONFLICT : ROLE_PERMISSION_PHASES.FAILED, safeCode(error))

  const query = async runGeneration => {
    if (disposed || generation !== runGeneration || queryInFlight) return null
    queryInFlight = true
    try {
      const result = await api.query({ scope, idempotencyKey })
      if (disposed || generation !== runGeneration) return null
      operationRef = result.operationRef ?? operationRef
      if (result.status === 'processing') {
        transition(ROLE_PERMISSION_PHASES.QUERYING)
        const delay = retryDelay(result.retryAfter)
        clearSchedule()
        let scheduling = true
        let synchronous = false
        let consumed = false
        let cancel
        try {
          cancel = schedule(() => {
            if (scheduling) { synchronous = true; return }
            if (consumed) return
            consumed = true
            if (!disposed && generation === runGeneration) void query(runGeneration)
          }, delay)
        } catch {
          return fail(null)
        } finally {
          scheduling = false
        }
        if (typeof cancel !== 'function' || synchronous) {
          try { cancel?.() } catch { /* invalid scheduler already fails closed */ }
          return fail(null)
        }
        cancelScheduled = cancel
        return null
      }
      if (result.status === 'succeeded') return finish(ROLE_PERMISSION_PHASES.SUCCEEDED, null, result)
      if (result.status === 'pending_recovery') return finish(ROLE_PERMISSION_PHASES.PENDING_RECOVERY, null, result)
      if (result.status === 'failed') return finish(CONFLICT_CODES.has(result.failureCode) ? ROLE_PERMISSION_PHASES.CONFLICT : ROLE_PERMISSION_PHASES.FAILED, result.failureCode ?? 'request_failed')
      return fail(null)
    } catch (error) {
      if (disposed || generation !== runGeneration) return null
      return fail(error)
    } finally {
      queryInFlight = false
    }
  }

  const run = async (runGeneration, methods) => {
    try {
      idempotencyKey = createIdempotencyKey(randomBytes)
    } catch {
      return fail(null)
    }
    try {
      const issued = await api[methods.issue]({ ...intent, currentPassword: password })
      password = null
      if (disposed || generation !== runGeneration) return null
      ticket = issued.ticket
    } catch (error) {
      password = null
      if (disposed || generation !== runGeneration) return null
      return fail(error)
    }

    transition(ROLE_PERMISSION_PHASES.EXECUTING)
    try {
      const result = await api[methods.execute]({ ...intent, ticket, idempotencyKey })
      ticket = null
      if (disposed || generation !== runGeneration) return null
      operationRef = result.operationRef
      return finish(ROLE_PERMISSION_PHASES.SUCCEEDED, null, result)
    } catch (error) {
      ticket = null
      if (disposed || generation !== runGeneration) return null
      if (!ambiguousExecute(error)) return fail(error)
      operationRef = typeof error?.operationRef === 'string' ? error.operationRef : null
      transition(ROLE_PERMISSION_PHASES.QUERYING)
      return query(runGeneration)
    }
  }

  const start = (nextScope, input) => {
    if (disposed) return Promise.resolve(snapshot())
    if (activeRun) return activeRun
    if (phase !== ROLE_PERMISSION_PHASES.IDLE) return Promise.resolve(snapshot())
    const methods = ACTION_METHODS[nextScope]
    if (!methods || typeof api[methods.issue] !== 'function' || typeof api[methods.execute] !== 'function') throw new TypeError('invalid_role_permission_attempt_action')
    scope = nextScope
    intent = copyIntent(input)
    password = input?.currentPassword
    operationRef = null
    failureCode = null
    resultValues = null
    const runGeneration = ++generation
    activeRun = new Promise(resolve => { resolveRun = resolve })
    transition(ROLE_PERMISSION_PHASES.VERIFYING)
    void run(runGeneration, methods)
    return activeRun
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    generation++
    clearSchedule()
    clearSecrets()
    intent = null
    queryInFlight = false
    failureCode = 'workflow_disposed'
    phase = ROLE_PERMISSION_PHASES.FAILED
    const value = notify()
    const resolve = resolveRun
    resolveRun = null
    activeRun = null
    listeners.clear()
    resolve?.(value)
  }
  const subscribe = listener => {
    if (typeof listener !== 'function') throw new TypeError('invalid_role_permission_listener')
    if (disposed) return () => {}
    listeners.add(listener)
    listener(snapshot())
    return () => listeners.delete(listener)
  }
  return Object.freeze({ start, dispose, getSnapshot: snapshot, subscribe })
}
