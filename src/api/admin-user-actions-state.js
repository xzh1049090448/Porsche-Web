export const DELETE_STATES = Object.freeze({
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
  [DELETE_STATES.IDLE]: new Set([DELETE_STATES.VERIFYING]),
  [DELETE_STATES.VERIFYING]: new Set([DELETE_STATES.SUBMITTING, DELETE_STATES.FAILED]),
  [DELETE_STATES.SUBMITTING]: new Set([DELETE_STATES.SUCCEEDED, DELETE_STATES.FAILED, DELETE_STATES.UNKNOWN]),
  [DELETE_STATES.UNKNOWN]: new Set([DELETE_STATES.QUERYING]),
  [DELETE_STATES.QUERYING]: new Set([DELETE_STATES.QUERYING, DELETE_STATES.SUCCEEDED, DELETE_STATES.FAILED, DELETE_STATES.PENDING_RECOVERY]),
  [DELETE_STATES.SUCCEEDED]: new Set(),
  [DELETE_STATES.FAILED]: new Set([DELETE_STATES.IDLE]),
  [DELETE_STATES.PENDING_RECOVERY]: new Set(),
})

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

function safeFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : 'request_failed'
  return Object.freeze({
    code,
    message: typeof error?.message === 'string' && code !== 'request_failed' ? error.message : '请求失败，请稍后重试',
    status: Number.isInteger(error?.status) ? error.status : null,
    operationRef: typeof error?.operationRef === 'string' ? error.operationRef : null,
    retryAfter: Number.isSafeInteger(error?.retryAfter) ? error.retryAfter : null,
  })
}

function isAmbiguousExecute(error) {
  return error?.code === 'operation_commit_unknown' || !Number.isInteger(error?.status)
}

function boundedRetrySeconds(value) {
  return Math.min(30, Math.max(1, Number.isInteger(value) ? value : 1))
}

/**
 * Creates one memory-only workflow. schedule(callback, delayMs) must return a
 * cancellation function and must not invoke callback before returning.
 */
export function createUserDeleteWorkflow({ api, randomBytes, now, schedule }) {
  if (!api || typeof api.issueUserDelete !== 'function' || typeof api.executeUserDelete !== 'function'
      || typeof api.queryUserDelete !== 'function' || typeof randomBytes !== 'function'
      || typeof now !== 'function' || typeof schedule !== 'function') throw new TypeError('invalid_user_delete_workflow_dependencies')

  let state = DELETE_STATES.IDLE
  let updatedAt = now()
  let operationRef = null
  let failure = null
  let activeIntent = null
  let activePassword = null
  let ticket = null
  let idempotencyKey = null
  let activeRun = null
  let resolveRun = null
  let cancelScheduled = null
  let disposed = false
  let generation = 0
  const listeners = new Set()

  const snapshot = () => Object.freeze({ state, operationRef, failure, updatedAt })
  const publicResult = () => Object.freeze({ state, operationRef, failureCode: failure?.code ?? null })
  const notify = () => {
    const value = snapshot()
    for (const listener of listeners) listener(value)
  }
  const transition = next => {
    if (!TRANSITIONS[state].has(next)) throw new Error('invalid_user_delete_transition')
    state = next
    updatedAt = now()
    notify()
  }
  const clearTransient = () => {
    activePassword = null
    ticket = null
    idempotencyKey = null
    activeIntent = null
  }
  const clearSchedule = () => {
    const cancel = cancelScheduled
    cancelScheduled = null
    if (typeof cancel === 'function') {
      try { cancel() } catch { /* cancellation cannot retain workflow secrets */ }
    }
  }
  const complete = next => {
    generation++
    clearSchedule()
    clearTransient()
    if (!disposed && state !== next) transition(next)
    const result = publicResult()
    const resolve = resolveRun
    resolveRun = null
    if (resolve) resolve(result)
    return result
  }
  const fail = error => {
    failure = safeFailure(error)
    operationRef = failure.operationRef
    return complete(DELETE_STATES.FAILED)
  }

  const query = async runGeneration => {
    if (disposed || runGeneration !== generation) return complete(DELETE_STATES.IDLE)
    try {
      const result = await api.queryUserDelete({ idempotencyKey })
      if (disposed || runGeneration !== generation) return complete(DELETE_STATES.IDLE)
      operationRef = result.operationRef
      if (result.status === 'processing') {
        transition(DELETE_STATES.QUERYING)
        const delay = boundedRetrySeconds(result.retryAfter) * 1000
        clearSchedule()
        let invokedSynchronously = false
        let scheduling = true
        let cancel
        try {
          cancel = schedule(() => {
            if (scheduling) {
              invokedSynchronously = true
              return
            }
            if (!disposed && runGeneration === generation) void query(runGeneration)
          }, delay)
        } catch {
          generation++
          return fail(null)
        } finally {
          scheduling = false
        }
        if (typeof cancel !== 'function' || invokedSynchronously) {
          if (typeof cancel === 'function') {
            try { cancel() } catch { /* invalid scheduler is already failing closed */ }
          }
          generation++
          return fail(null)
        }
        cancelScheduled = cancel
        return null
      }
      if (result.status === 'succeeded') return complete(DELETE_STATES.SUCCEEDED)
      if (result.status === 'failed') {
        failure = safeFailure({ code: result.failureCode, message: '请求无法完成', status: 409, operationRef: result.operationRef })
        return complete(DELETE_STATES.FAILED)
      }
      if (result.status === 'pending_recovery') return complete(DELETE_STATES.PENDING_RECOVERY)
      return fail(null)
    } catch (error) {
      if (disposed || runGeneration !== generation) return complete(DELETE_STATES.IDLE)
      return fail(error)
    }
  }

  const run = async (runGeneration, userInput) => {
    activeIntent = {
      targetGuid: userInput?.targetGuid,
      expectedAuthVersion: userInput?.expectedAuthVersion,
      reason: userInput?.reason,
    }
    activePassword = userInput?.currentPassword
    userInput = null
    transition(DELETE_STATES.VERIFYING)
    try {
      idempotencyKey = createIdempotencyKey(randomBytes)
    } catch {
      return fail(null)
    }
    try {
      const issued = await api.issueUserDelete({ ...activeIntent, currentPassword: activePassword })
      activePassword = null
      if (disposed || runGeneration !== generation) return complete(DELETE_STATES.IDLE)
      ticket = issued.ticket
    } catch (error) {
      activePassword = null
      if (disposed || runGeneration !== generation) return complete(DELETE_STATES.IDLE)
      return fail(error)
    }

    transition(DELETE_STATES.SUBMITTING)
    try {
      const result = await api.executeUserDelete({ ...activeIntent, ticket, idempotencyKey })
      ticket = null
      if (disposed || runGeneration !== generation) return complete(DELETE_STATES.IDLE)
      operationRef = result.operationRef
      return complete(DELETE_STATES.SUCCEEDED)
    } catch (error) {
      ticket = null
      if (disposed || runGeneration !== generation) return complete(DELETE_STATES.IDLE)
      if (!isAmbiguousExecute(error)) return fail(error)
      operationRef = typeof error?.operationRef === 'string' ? error.operationRef : null
      transition(DELETE_STATES.UNKNOWN)
      transition(DELETE_STATES.QUERYING)
      return query(runGeneration)
    }
  }

  const start = userInput => {
    if (activeRun) return activeRun
    if (disposed || state !== DELETE_STATES.IDLE) return Promise.resolve(publicResult())
    const runGeneration = ++generation
    activeRun = new Promise(resolve => { resolveRun = resolve })
    void run(runGeneration, userInput)
    return activeRun
  }

  const reset = () => {
    if (disposed || state !== DELETE_STATES.FAILED) return false
    failure = null
    operationRef = null
    activeRun = null
    transition(DELETE_STATES.IDLE)
    return true
  }

  const unmount = () => {
    if (disposed) return
    disposed = true
    generation++
    clearSchedule()
    clearTransient()
    failure = null
    operationRef = null
    state = DELETE_STATES.IDLE
    updatedAt = now()
    listeners.clear()
    const resolve = resolveRun
    resolveRun = null
    if (resolve) resolve(publicResult())
  }

  const subscribe = listener => {
    if (typeof listener !== 'function') throw new TypeError('invalid_user_delete_listener')
    if (disposed) return () => {}
    listeners.add(listener)
    listener(snapshot())
    return () => listeners.delete(listener)
  }

  return Object.freeze({ start, reset, unmount, getSnapshot: snapshot, subscribe })
}
