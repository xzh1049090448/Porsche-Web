import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { createUserDeleteWorkflow, DELETE_STATES } from '../api/admin-user-actions-state.js'
import { issueUserDelete, executeUserDelete, queryUserDelete } from '../api/admin-user-actions.js'

const SAFE_INITIAL = Object.freeze({ open: false, target: null, state: DELETE_STATES.IDLE, operationRef: null, failureCode: null })

export function canDeleteAdminUser({ actorRole, capabilities, target } = {}) {
  if (!Array.isArray(capabilities) || !capabilities.includes('users.delete') || !target || target.status === 'deleted') return false
  if (actorRole === 'admin') return target.role === 'user'
  if (actorRole === 'root') return target.role === 'user' || target.role === 'admin'
  return false
}

function safeTarget(target) {
  if (!target || typeof target.guid !== 'string' || !Number.isInteger(target.authVersion)) throw new TypeError('invalid_delete_target')
  return Object.freeze({ guid: target.guid, username: typeof target.username === 'string' ? target.username : null, role: target.role, status: target.status, authVersion: target.authVersion })
}

export function createAdminUserActionsCoordinator({ api, createWorkflow = createUserDeleteWorkflow, randomBytes, now, schedule,
  onSucceeded = () => {}, onConflict = () => {}, onUnauthorized = () => {}, state } = {}) {
  const value = state ?? { ...SAFE_INITIAL }
  let workflow = null
  let unsubscribe = null
  let reason = ''
  let password = ''
  let callbacks = { onSucceeded, onConflict, onUnauthorized }

  const clearPrivate = () => { reason = ''; password = '' }
  const sync = snapshot => {
    value.state = snapshot.state
    value.operationRef = snapshot.operationRef
    value.failureCode = snapshot.failure?.code ?? null
  }
  const destroyWorkflow = () => {
    unsubscribe?.()
    unsubscribe = null
    workflow?.unmount()
    workflow = null
    clearPrivate()
  }
  const close = () => {
    destroyWorkflow()
    Object.assign(value, SAFE_INITIAL)
  }
  const open = (target, nextCallbacks = {}) => {
    destroyWorkflow()
    Object.assign(value, SAFE_INITIAL, { open: true, target: safeTarget(target) })
    callbacks = {
      onSucceeded: nextCallbacks.onSucceeded ?? onSucceeded,
      onConflict: nextCallbacks.onConflict ?? onConflict,
      onUnauthorized: nextCallbacks.onUnauthorized ?? onUnauthorized,
    }
    workflow = createWorkflow({ api, randomBytes, now, schedule })
    unsubscribe = workflow.subscribe(sync)
  }
  const setReason = input => { reason = typeof input === 'string' ? input : '' }
  const setPassword = input => { password = typeof input === 'string' ? input : '' }
  const updateTarget = target => {
    if (!workflow || value.state !== DELETE_STATES.FAILED || target?.guid !== value.target?.guid) return false
    value.target = safeTarget(target)
    return true
  }
  const submit = async () => {
    if (!workflow) return null
    if (value.state === DELETE_STATES.FAILED && !workflow.reset()) return null
    if (value.state !== DELETE_STATES.IDLE) return null
    const normalizedReason = reason.trim()
    if ([...normalizedReason].length < 1 || [...normalizedReason].length > 200 || password.length < 1) return null
    const target = value.target
    let passwordInput = password
    password = ''
    const running = workflow.start({ targetGuid: target.guid, expectedAuthVersion: target.authVersion, reason: normalizedReason, currentPassword: passwordInput })
    passwordInput = ''
    const result = await running
    if (result.state === DELETE_STATES.SUCCEEDED) {
      reason = ''
      await callbacks.onSucceeded({ guid: target.guid, status: 'deleted', operationRef: result.operationRef })
    } else if (result.state === DELETE_STATES.FAILED) {
      if (result.failureCode === 'authentication_failed') {
        clearPrivate()
        try { callbacks.onUnauthorized() } finally { close() }
      } else if (['target_version_conflict', 'target_state_conflict', 'action_verification_conflict'].includes(result.failureCode)) {
        await callbacks.onConflict(target.guid)
      }
    }
    return result
  }
  const reset = () => workflow?.reset() ?? false
  return { state: value, open, close, dispose: close, setReason, setPassword, updateTarget, submit, reset }
}

const productionRandomBytes = length => crypto.getRandomValues(new Uint8Array(length))
const productionSchedule = (callback, delay) => {
  const timer = setTimeout(callback, delay)
  return () => clearTimeout(timer)
}

export const useAdminUserActionsStore = defineStore('adminUserActions', () => {
  const state = reactive({ ...SAFE_INITIAL })
  const coordinator = createAdminUserActionsCoordinator({
    state,
    api: { issueUserDelete, executeUserDelete, queryUserDelete },
    randomBytes: productionRandomBytes,
    now: () => Date.now(),
    schedule: productionSchedule,
  })
  const refs = toRefs(state)
  return { isOpen: refs.open, target: refs.target, state: refs.state, operationRef: refs.operationRef, failureCode: refs.failureCode,
    open: coordinator.open, close: coordinator.close, dispose: coordinator.dispose,
    setReason: coordinator.setReason, setPassword: coordinator.setPassword, updateTarget: coordinator.updateTarget,
    submit: coordinator.submit, reset: coordinator.reset }
})
