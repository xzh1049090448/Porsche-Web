import { normalizeAdminUserStatusRequest } from './admin-user-status.js'

export const ADMIN_USER_STATUS_STATES = Object.freeze({
  IDLE: 'idle', SUBMITTING: 'submitting', SUCCEEDED: 'succeeded', CONFLICT: 'conflict', FAILED: 'failed', DISPOSED: 'disposed',
})

const USER_KEYS = ['guid', 'username', 'nickname', 'email', 'group', 'planType', 'role', 'status', 'authVersion', 'createdAt', 'lastLoginAt']
const SAFE_FAILURE_CODES = Object.freeze(['authentication_failed', 'forbidden', 'not_found', 'unavailable', 'auth_version_conflict', 'user_status_conflict', 'request_failed'])
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const safeFailure = error => SAFE_FAILURE_CODES.includes(error?.code) ? error.code : 'request_failed'

function safeUser(value) {
  if (!exactKeys(value, USER_KEYS) || typeof value.guid !== 'string' || !['active', 'disabled'].includes(value.status)
      || !Number.isInteger(value.authVersion)) throw new Error('invalid_admin_user_status_response')
  return Object.freeze(Object.fromEntries(USER_KEYS.map(key => [key, value[key]])))
}

export function createAdminUserStatusWorkflow({ api }) {
  if (!api || typeof api.patchAdminUserStatus !== 'function') throw new TypeError('invalid_admin_user_status_workflow_dependencies')
  let state = ADMIN_USER_STATUS_STATES.IDLE
  let user = null
  let failureCode = null
  let active = null
  let disposed = false
  let generation = 0
  const listeners = new Set()
  const snapshot = () => Object.freeze({ state, user, failureCode })
  const notify = () => {
    const value = snapshot()
    for (const listener of listeners) { try { listener(value) } catch { /* observers are isolated */ } }
    return value
  }
  const owns = attempt => !disposed && active === attempt && attempt.generation === generation
  const settle = (attempt, nextState, nextUser = null, nextFailure = null) => {
    if (!owns(attempt)) return snapshot()
    state = nextState; user = nextUser; failureCode = nextFailure; active = null
    const value = notify(); attempt.resolve(value); return value
  }
  const start = input => {
    if (disposed) return Promise.resolve(snapshot())
    if (active) return active.promise
    if (state !== ADMIN_USER_STATUS_STATES.IDLE) return Promise.resolve(snapshot())
    let request
    try { request = normalizeAdminUserStatusRequest(input) } catch {
      state = ADMIN_USER_STATUS_STATES.FAILED; user = null; failureCode = 'request_failed'
      return Promise.resolve(notify())
    }
    const attempt = { generation: ++generation, request, resolve: null, promise: null }
    attempt.promise = new Promise(resolve => { attempt.resolve = resolve })
    active = attempt; state = ADMIN_USER_STATUS_STATES.SUBMITTING; user = null; failureCode = null; notify()
    void (async () => {
      try {
        const result = safeUser(await api.patchAdminUserStatus(attempt.request))
        settle(attempt, ADMIN_USER_STATUS_STATES.SUCCEEDED, result)
      } catch (error) {
        if (['auth_version_conflict', 'user_status_conflict'].includes(error?.code)) settle(attempt, ADMIN_USER_STATUS_STATES.CONFLICT, null, error.code)
        else settle(attempt, ADMIN_USER_STATUS_STATES.FAILED, null, safeFailure(error))
      }
    })()
    return attempt.promise
  }
  const reset = () => {
    if (disposed || state === ADMIN_USER_STATUS_STATES.IDLE) return false
    const attempt = active
    generation++; active = null; state = ADMIN_USER_STATUS_STATES.IDLE; user = null; failureCode = null
    const value = notify(); if (attempt) attempt.resolve(value); return true
  }
  const dispose = () => {
    if (disposed) return
    const attempt = active
    disposed = true; generation++; active = null; state = ADMIN_USER_STATUS_STATES.DISPOSED; user = null; failureCode = 'workflow_disposed'
    const value = snapshot(); listeners.clear(); if (attempt) attempt.resolve(value)
  }
  const subscribe = listener => {
    if (typeof listener !== 'function') throw new TypeError('invalid_admin_user_status_listener')
    if (disposed) return () => {}
    listeners.add(listener)
    try { listener(snapshot()) } catch { /* observers are isolated */ }
    return () => listeners.delete(listener)
  }
  return Object.freeze({ start, reset, dispose, getSnapshot: snapshot, subscribe })
}
