import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { createUserDeleteWorkflow, DELETE_STATES } from '../api/admin-user-actions-state.js'
import { issueUserDelete, executeUserDelete, queryUserDelete } from '../api/admin-user-actions.js'

const SAFE_INITIAL = Object.freeze({ open: false, dialogRevision: 0, target: null, state: DELETE_STATES.IDLE, operationRef: null, failureCode: null })

export function canDeleteAdminUser({ actorRole, capabilities, target } = {}) {
  if (!Array.isArray(capabilities) || !capabilities.includes('users.delete') || !target || target.status === 'deleted') return false
  if (actorRole === 'admin') return target.role === 'user'
  if (actorRole === 'root') return target.role === 'user' || target.role === 'admin'
  return false
}

export const isDeleteBusy = state => ['verifying', 'submitting', 'querying'].includes(state)

export function canSubmitUserDelete({ state, target } = {}) {
  return [DELETE_STATES.IDLE, DELETE_STATES.FAILED].includes(state) && target?.status !== 'deleted'
}

export function clearUserDeleteConfirmationForm({ form, passwordInput, setReason, setPassword, clearValidate }) {
  form.reason = ''
  form.password = ''
  const nativePassword = passwordInput?.value?.input ?? passwordInput?.value?.$el?.querySelector?.('input')
  if (nativePassword && 'value' in nativePassword) nativePassword.value = ''
  setReason('')
  setPassword('')
  clearValidate()
}

export function scheduleUserDeleteMountClear({ token, owns, clearForm, nextTick }) {
  if (!owns(token)) return false
  nextTick(() => { if (owns(token)) clearForm() })
  return true
}

export function focusDeleteError({ token, owns, errorAlert, nextTick }) {
  if (!owns(token)) return false
  nextTick(() => { if (owns(token)) (errorAlert?.value?.$el ?? errorAlert?.value)?.focus?.() })
  return true
}

export function focusDeleteValidation({ token, owns, hasReason, reasonInput, passwordInput, nextTick }) {
  if (!owns(token)) return false
  nextTick(() => {
    if (owns(token)) (hasReason ? passwordInput?.value : reasonInput?.value)?.focus?.()
  })
  return true
}

export function settleUserDeleteDialog({ token, result, owns, close, focusError }) {
  if (!owns(token)) return false
  if (result?.state === DELETE_STATES.SUCCEEDED) close(token)
  else if (result?.state === DELETE_STATES.FAILED || result?.state === DELETE_STATES.PENDING_RECOVERY) focusError(token)
  return true
}

export function settleUserDeleteClosed({ currentToken, clearForm, emitClosed }) {
  if (currentToken) return false
  clearForm()
  emitClosed()
  return true
}

export function restoreDeleteTriggerFocus({ token, canRestore, trigger, fallback, nextTick }) {
  if (!canRestore(token)) return false
  nextTick(() => {
    if (canRestore(token)) (trigger?.isConnected ? trigger : fallback?.$el ?? fallback)?.focus?.()
  })
  return true
}

export async function reconcileDeletedList({ state, filters, guid, reload }) {
  const rows = state.rows.filter(row => row.guid !== guid)
  state.rows = rows
  state.total = Math.max(0, state.total - 1)
  if (rows.length === 0 && filters.page > 1) {
    filters.page--
    await reload()
  }
}

export function reconcileDeletedDetail({ state, guid }) {
  if (state.selected?.guid !== guid) return false
  state.selected = { ...state.selected, status: 'deleted' }
  state.permissions = null
  state.catalog = null
  return true
}

export async function refreshDeleteTargetFailClosed({ guid, token, loadTarget, isContextCurrent = () => true, canManage, replaceTarget, invalidateTarget, onUnauthorized, onUnavailable }) {
  if (!isContextCurrent(token, guid)) return false
  let target
  try {
    target = await loadTarget(guid, token)
  } catch (error) {
    if (!isContextCurrent(token, guid)) return false
    invalidateTarget(token, guid)
    if (error?.response?.status === 401 || error?.status === 401) onUnauthorized()
    onUnavailable()
    return false
  }
  if (!isContextCurrent(token, guid)) return false
  if (!target || target.guid !== guid || !canManage(target) || !replaceTarget(token, target)) {
    invalidateTarget(token, guid)
    onUnavailable()
    return false
  }
  return true
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
  let ownership = null
  let nextOwnership = 0
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
    ownership = null
    clearPrivate()
  }
  const owns = token => token != null && token === ownership && workflow != null
  const captureOwnership = () => ownership
  const close = (token = ownership) => {
    if (!owns(token)) return false
    const dialogRevision = value.dialogRevision
    destroyWorkflow()
    Object.assign(value, SAFE_INITIAL, { dialogRevision })
    return true
  }
  const open = (target, nextCallbacks = {}) => {
    destroyWorkflow()
    const token = Object.freeze({ deleteDialog: ++nextOwnership })
    ownership = token
    Object.assign(value, SAFE_INITIAL, { open: true, dialogRevision: value.dialogRevision + 1, target: safeTarget(target) })
    callbacks = {
      onSucceeded: nextCallbacks.onSucceeded ?? onSucceeded,
      onConflict: nextCallbacks.onConflict ?? onConflict,
      onUnauthorized: nextCallbacks.onUnauthorized ?? onUnauthorized,
    }
    const ownedWorkflow = createWorkflow({ api, randomBytes, now, schedule })
    workflow = ownedWorkflow
    unsubscribe = ownedWorkflow.subscribe(snapshot => { if (owns(token) && workflow === ownedWorkflow) sync(snapshot) })
    return token
  }
  const setReason = input => { reason = typeof input === 'string' ? input : '' }
  const setPassword = input => { password = typeof input === 'string' ? input : '' }
  const updateTarget = (token, target) => {
    if (!owns(token) || value.state !== DELETE_STATES.FAILED || target?.guid !== value.target?.guid) return false
    value.target = safeTarget(target)
    return true
  }
  const invalidateTarget = (token, guid) => {
    if (!owns(token) || value.target?.guid !== guid) return false
    close(token)
    return true
  }
  const submit = async (token = ownership) => {
    if (!owns(token)) return null
    const ownedWorkflow = workflow
    if (value.state === DELETE_STATES.FAILED && !ownedWorkflow.reset()) return null
    if (value.state !== DELETE_STATES.IDLE) return null
    let normalizedReason = reason.trim()
    if ([...normalizedReason].length < 1 || [...normalizedReason].length > 200 || password.length < 1) return null
    const target = { ...value.target }
    let passwordInput = password
    password = ''
    const running = ownedWorkflow.start({ targetGuid: target.guid, expectedAuthVersion: target.authVersion, reason: normalizedReason, currentPassword: passwordInput })
    passwordInput = ''
    const result = await running
    if (!owns(token) || workflow !== ownedWorkflow) { normalizedReason = ''; return result }
    if (result.state === DELETE_STATES.SUCCEEDED) {
      reason = ''
      await callbacks.onSucceeded({ guid: target.guid, status: 'deleted', operationRef: result.operationRef }, token)
      if (!owns(token) || workflow !== ownedWorkflow) return result
    } else if (result.state === DELETE_STATES.FAILED) {
      if (result.failureCode === 'authentication_failed') {
        clearPrivate()
        try { callbacks.onUnauthorized() } finally { close(token) }
      } else if (['target_version_conflict', 'target_state_conflict', 'action_verification_conflict'].includes(result.failureCode)) {
        const refreshed = await callbacks.onConflict(target.guid, token)
        if (!owns(token) || workflow !== ownedWorkflow) return result
        if (refreshed !== true) invalidateTarget(token, target.guid)
      }
    }
    return result
  }
  const reset = (token = ownership) => owns(token) ? workflow.reset() : false
  return { state: value, open, close, dispose: close, owns, captureOwnership, setReason, setPassword, updateTarget, invalidateTarget, submit, reset }
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
  return { isOpen: refs.open, dialogRevision: refs.dialogRevision, target: refs.target, state: refs.state, operationRef: refs.operationRef, failureCode: refs.failureCode,
    open: coordinator.open, close: coordinator.close, dispose: coordinator.dispose, owns: coordinator.owns, captureOwnership: coordinator.captureOwnership,
    setReason: coordinator.setReason, setPassword: coordinator.setPassword, updateTarget: coordinator.updateTarget, invalidateTarget: coordinator.invalidateTarget,
    submit: coordinator.submit, reset: coordinator.reset }
})
