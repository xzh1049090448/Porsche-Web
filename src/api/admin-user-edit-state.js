import { normalizeAdminUserEditRequest } from './admin-user-edit.js'

export const ADMIN_USER_EDIT_STATES = Object.freeze({
  IDLE: 'idle', SUBMITTING: 'submitting', SUCCEEDED: 'succeeded', CONFLICT: 'conflict', FAILED: 'failed', DISPOSED: 'disposed',
})

const USER_KEYS = ['guid', 'username', 'nickname', 'email', 'group', 'planType', 'role', 'status', 'authVersion', 'createdAt', 'lastLoginAt']
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const safeFailure = error => error?.code === 'auth_version_conflict' ? 'auth_version_conflict'
  : error?.code === 'authentication_failed' ? 'authentication_failed' : 'request_failed'

function safeUser(value) {
  if (!exactKeys(value, USER_KEYS) || typeof value.guid !== 'string' || !(value.nickname === null || typeof value.nickname === 'string')) throw new Error('invalid_admin_user_edit_response')
  return Object.freeze(Object.fromEntries(USER_KEYS.map(key => [key, value[key]])))
}

export function createAdminUserEditWorkflow({ api }) {
  if (!api || typeof api.patchAdminUserEdit !== 'function') throw new TypeError('invalid_admin_user_edit_workflow_dependencies')
  let state = ADMIN_USER_EDIT_STATES.IDLE
  let user = null
  let failureCode = null
  let active = null
  let disposed = false
  let generation = 0
  const listeners = new Set()
  const snapshot = () => Object.freeze({ state, user, failureCode })
  const notify = () => { const value = snapshot(); for (const listener of listeners) { try { listener(value) } catch { /* observers are isolated */ } } return value }
  const owns = attempt => !disposed && active === attempt && attempt.generation === generation
  const settle = (attempt, next, nextUser = null, nextFailure = null) => {
    if (!owns(attempt)) return snapshot()
    state = next; user = nextUser; failureCode = nextFailure; active = null
    const value = notify(); attempt.resolve(value); return value
  }
  const start = input => {
    if (disposed) return Promise.resolve(snapshot())
    if (active) return active.promise
    if (state !== ADMIN_USER_EDIT_STATES.IDLE) return Promise.resolve(snapshot())
    let request
    try { request = normalizeAdminUserEditRequest(input) } catch {
      state = ADMIN_USER_EDIT_STATES.FAILED; failureCode = 'request_failed'; return Promise.resolve(notify())
    }
    const attempt = { generation: ++generation, request, resolve: null, promise: null }
    attempt.promise = new Promise(resolve => { attempt.resolve = resolve })
    active = attempt; state = ADMIN_USER_EDIT_STATES.SUBMITTING; user = null; failureCode = null; notify()
    void (async () => {
      try { const result = safeUser(await api.patchAdminUserEdit(attempt.request)); settle(attempt, ADMIN_USER_EDIT_STATES.SUCCEEDED, result) }
      catch (error) { if (error?.code === 'auth_version_conflict') settle(attempt, ADMIN_USER_EDIT_STATES.CONFLICT, null, 'auth_version_conflict'); else settle(attempt, ADMIN_USER_EDIT_STATES.FAILED, null, safeFailure(error)) }
    })()
    return attempt.promise
  }
  const reset = () => {
    if (disposed || state === ADMIN_USER_EDIT_STATES.IDLE) return false
    const attempt = active; generation++; active = null; state = ADMIN_USER_EDIT_STATES.IDLE; user = null; failureCode = null
    const value = notify(); if (attempt) attempt.resolve(value); return true
  }
  const dispose = () => {
    if (disposed) return
    const attempt = active; disposed = true; generation++; active = null; state = ADMIN_USER_EDIT_STATES.DISPOSED; user = null; failureCode = 'workflow_disposed'
    const value = snapshot(); listeners.clear(); if (attempt) attempt.resolve(value)
  }
  const subscribe = listener => { if (typeof listener !== 'function') throw new TypeError('invalid_admin_user_edit_listener'); if (disposed) return () => {}; listeners.add(listener); try { listener(snapshot()) } catch { /* observers are isolated */ }; return () => listeners.delete(listener) }
  return Object.freeze({ start, reset, dispose, getSnapshot: snapshot, subscribe })
}
