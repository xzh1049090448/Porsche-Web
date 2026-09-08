import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { patchAdminUserEdit } from '../api/admin-user-edit.js'
import { ADMIN_USER_EDIT_STATES, createAdminUserEditWorkflow } from '../api/admin-user-edit-state.js'

const INITIAL = Object.freeze({ open: false, dialogRevision: 0, target: null, state: ADMIN_USER_EDIT_STATES.IDLE, user: null, failureCode: null, requiresTargetRefresh: false })
const MAX_INT32 = 2147483647

function safeTarget(value) {
  if (!value || typeof value.guid !== 'string' || !['user', 'admin', 'root'].includes(value.role) || !['active', 'disabled', 'deleted'].includes(value.status)
      || !Number.isInteger(value.authVersion) || value.authVersion < 1 || value.authVersion > MAX_INT32) throw new TypeError('invalid_admin_user_edit_target')
  return Object.freeze({ guid: value.guid, username: value.username ?? null, nickname: value.nickname ?? null, role: value.role, status: value.status, authVersion: value.authVersion })
}

export function canOpenAdminUserEdit({ actorRole, actorGuid, capabilities, target } = {}) {
  if (!Array.isArray(capabilities) || !capabilities.includes('users.edit') || !target || target.status === 'deleted' || target.guid === actorGuid
      || !Number.isInteger(target.authVersion) || target.authVersion < 1 || target.authVersion > MAX_INT32) return false
  return actorRole === 'admin' ? target.role === 'user' : actorRole === 'root' ? target.role === 'user' || target.role === 'admin' : false
}

export function createAdminUserEditCoordinator({ api = { patchAdminUserEdit }, createWorkflow = createAdminUserEditWorkflow, onSucceeded = () => {}, state } = {}) {
  const value = state ?? { ...INITIAL }
  let ownership = null; let sequence = 0; let workflow = null; let unsubscribe = null; let activePromise = null; let context = null
  const owns = token => token != null && token === ownership && workflow != null
  const current = token => owns(token) && context && value.target?.guid === context.targetGuid
    && context.routeGuid === value.routeGuid && context.identityEpoch === value.identityEpoch && context.permissionVersion === value.permissionVersion
  const clear = () => { unsubscribe?.(); unsubscribe = null; workflow?.dispose(); workflow = null; ownership = null; activePromise = null; context = null }
  const close = (token = ownership) => { if (!owns(token)) return false; const revision = value.dialogRevision; clear(); Object.assign(value, INITIAL, { dialogRevision: revision }); return true }
  const open = input => {
    if (!canOpenAdminUserEdit(input)) return null
    clear(); const token = Object.freeze({ editDialog: ++sequence }); const target = safeTarget(input.target)
    ownership = token; context = Object.freeze({ actorRole: input.actorRole, actorGuid: input.actorGuid, capabilities: Object.freeze([...input.capabilities]), targetGuid: target.guid, routeGuid: input.routeGuid, identityEpoch: input.identityEpoch, permissionVersion: input.permissionVersion })
    Object.assign(value, INITIAL, { open: true, dialogRevision: value.dialogRevision + 1, target, routeGuid: input.routeGuid, identityEpoch: input.identityEpoch, permissionVersion: input.permissionVersion })
    const owned = createWorkflow({ api }); workflow = owned
    unsubscribe = owned.subscribe(snapshot => {
      if (!current(token) || workflow !== owned) return
      value.state = snapshot.state; value.user = snapshot.user; value.failureCode = snapshot.failureCode
      value.requiresTargetRefresh = snapshot.state === ADMIN_USER_EDIT_STATES.CONFLICT
    })
    return token
  }
  const updateContext = (token, next) => {
    if (!owns(token)) return false
    if (Object.hasOwn(next, 'routeGuid')) value.routeGuid = next.routeGuid
    if (Object.hasOwn(next, 'identityEpoch')) value.identityEpoch = next.identityEpoch
    if (Object.hasOwn(next, 'permissionVersion')) value.permissionVersion = next.permissionVersion
    return true
  }
  const submit = (token, input) => {
    if (!current(token)) return null
    if (activePromise) return activePromise
    const owned = workflow; const request = { targetGuid: value.target.guid, nickname: input?.nickname, expectedAuthVersion: value.target.authVersion }
    activePromise = owned.start(request).then(async result => {
      if (!current(token) || workflow !== owned) return result
      if (result.state === ADMIN_USER_EDIT_STATES.SUCCEEDED) await onSucceeded(result.user, token)
      return result
    }).finally(() => { if (workflow === owned) activePromise = null })
    return activePromise
  }
  const refreshConflict = async (token, loadTarget) => {
    if (!current(token) || !value.requiresTargetRefresh || typeof loadTarget !== 'function') return false
    let next; try { next = safeTarget(await loadTarget(value.target.guid)) } catch { return false }
    if (!current(token) || next.guid !== value.target.guid || !canOpenAdminUserEdit({ actorRole: context.actorRole, actorGuid: context.actorGuid, capabilities: context.capabilities, target: next })) return false
    value.target = next; value.requiresTargetRefresh = false; workflow.reset(); return true
  }
  return { state: value, open, close, dispose: close, owns, updateContext, submit, refreshConflict }
}

export const useAdminUserEditStore = defineStore('adminUserEdit', () => {
  const state = reactive({ ...INITIAL })
  const coordinator = createAdminUserEditCoordinator({ state })
  const refs = toRefs(state)
  return { isOpen: refs.open, dialogRevision: refs.dialogRevision, target: refs.target, state: refs.state, user: refs.user, failureCode: refs.failureCode, requiresTargetRefresh: refs.requiresTargetRefresh,
    open: coordinator.open, close: coordinator.close, dispose: coordinator.dispose, owns: coordinator.owns, updateContext: coordinator.updateContext, submit: coordinator.submit, refreshConflict: coordinator.refreshConflict }
})
