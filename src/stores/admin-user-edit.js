import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { patchAdminUserEdit } from '../api/admin-user-edit.js'
import { ADMIN_USER_EDIT_STATES, createAdminUserEditWorkflow } from '../api/admin-user-edit-state.js'

const INITIAL = Object.freeze({ open: false, dialogRevision: 0, target: null, state: ADMIN_USER_EDIT_STATES.IDLE, user: null, failureCode: null, requiresTargetRefresh: false })
const MAX_INT32 = 2147483647
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const IDENTITY_EPOCH = /^[A-Za-z0-9._:-]{1,128}$/

const compareDecimal = (left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0)
const validGuid = value => typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0
const validIdentityEpoch = value => typeof value === 'string' && IDENTITY_EPOCH.test(value)
const validPermissionVersion = value => Number.isSafeInteger(value) && value >= 0

function safeTarget(value) {
  if (!value || !validGuid(value.guid) || !['user', 'admin', 'root'].includes(value.role) || !['active', 'disabled', 'deleted'].includes(value.status)
      || !Number.isInteger(value.authVersion) || value.authVersion < 1 || value.authVersion > MAX_INT32) throw new TypeError('invalid_admin_user_edit_target')
  return Object.freeze({ guid: value.guid, username: value.username ?? null, nickname: value.nickname ?? null, role: value.role, status: value.status, authVersion: value.authVersion })
}

function safeOwnership(input, target) {
  if (!validGuid(input.actorGuid) || !validIdentityEpoch(input.identityEpoch) || !validPermissionVersion(input.permissionVersion)
      || !Array.isArray(input.capabilities) || input.capabilities.some(capability => typeof capability !== 'string')) throw new TypeError('invalid_admin_user_edit_ownership')
  return Object.freeze({ actorRole: input.actorRole, actorGuid: input.actorGuid, capabilities: Object.freeze([...input.capabilities]), targetGuid: target.guid,
    expectedAuthVersion: target.authVersion, targetSnapshot: target, routeGuid: input.routeGuid, identityEpoch: input.identityEpoch, permissionVersion: input.permissionVersion })
}

export function canOpenAdminUserEdit({ actorRole, actorGuid, capabilities, target } = {}) {
  if (!Array.isArray(capabilities) || !capabilities.includes('users.edit') || !target || !validGuid(target.guid) || target.status === 'deleted' || target.guid === actorGuid
      || !Number.isInteger(target.authVersion) || target.authVersion < 1 || target.authVersion > MAX_INT32) return false
  return actorRole === 'admin' ? target.role === 'user' : actorRole === 'root' ? target.role === 'user' || target.role === 'admin' : false
}

export function createAdminUserEditCoordinator({ api = { patchAdminUserEdit }, createWorkflow = createAdminUserEditWorkflow, onSucceeded = () => {}, state } = {}) {
  const value = state ?? { ...INITIAL }
  let ownership = null; let sequence = 0; let workflow = null; let unsubscribe = null; let activePromise = null; let context = null
  const owns = token => token != null && token === ownership && workflow != null
  const current = token => owns(token) && context && context.routeGuid === context.targetGuid && value.target === context.targetSnapshot
    && value.target?.guid === context.targetGuid && value.target.authVersion === context.expectedAuthVersion
    && context.routeGuid === value.routeGuid && context.identityEpoch === value.identityEpoch && context.permissionVersion === value.permissionVersion
  const clear = () => { unsubscribe?.(); unsubscribe = null; workflow?.dispose(); workflow = null; ownership = null; activePromise = null; context = null }
  const close = (token = ownership) => { if (!owns(token)) return false; const revision = value.dialogRevision; clear(); Object.assign(value, INITIAL, { dialogRevision: revision }); return true }
  const open = input => {
    if (!canOpenAdminUserEdit(input)) return null
    let target; let nextContext
    try { target = safeTarget(input.target) } catch { return null }
    if (!validGuid(input.routeGuid) || input.routeGuid !== target.guid) return null
    try { nextContext = safeOwnership(input, target) } catch { return null }
    clear(); const token = Object.freeze({ editDialog: ++sequence })
    ownership = token; context = nextContext
    Object.assign(value, INITIAL, { open: true, dialogRevision: value.dialogRevision + 1, target, routeGuid: input.routeGuid, identityEpoch: input.identityEpoch, permissionVersion: input.permissionVersion })
    const owned = createWorkflow({ api }); workflow = owned
    unsubscribe = owned.subscribe(snapshot => {
      if (!current(token) || workflow !== owned) return
      if (snapshot.state === ADMIN_USER_EDIT_STATES.SUCCEEDED) return
      value.state = snapshot.state; value.user = snapshot.user; value.failureCode = snapshot.failureCode
      value.requiresTargetRefresh = snapshot.state === ADMIN_USER_EDIT_STATES.CONFLICT
    })
    return token
  }
  const updateContext = (token, next) => {
    if (!owns(token) || !next || typeof next !== 'object') return false
    let target = null
    if (Object.hasOwn(next, 'target')) { try { target = safeTarget(next.target) } catch { return false } }
    const routeGuid = Object.hasOwn(next, 'routeGuid') ? next.routeGuid : value.routeGuid
    const identityEpoch = Object.hasOwn(next, 'identityEpoch') ? next.identityEpoch : value.identityEpoch
    const permissionVersion = Object.hasOwn(next, 'permissionVersion') ? next.permissionVersion : value.permissionVersion
    if (!validGuid(routeGuid) || !validIdentityEpoch(identityEpoch) || !validPermissionVersion(permissionVersion)) return false
    const changed = routeGuid !== value.routeGuid || identityEpoch !== value.identityEpoch || permissionVersion !== value.permissionVersion
      || target !== null
    if (changed) close(token)
    return true
  }
  const submit = (token, input) => {
    if (!current(token)) return null
    if (activePromise) return activePromise
    const owned = workflow; const request = { targetGuid: context.targetGuid, nickname: input?.nickname, expectedAuthVersion: context.expectedAuthVersion }
    activePromise = owned.start(request).then(async result => {
      if (!current(token) || workflow !== owned) return result
      if (result.state === ADMIN_USER_EDIT_STATES.SUCCEEDED) {
        if (result.user?.guid !== request.targetGuid || result.user.authVersion !== request.expectedAuthVersion) {
          owned.reset()
          const failure = Object.freeze({ state: ADMIN_USER_EDIT_STATES.FAILED, user: null, failureCode: 'request_failed' })
          if (current(token) && workflow === owned) Object.assign(value, failure, { requiresTargetRefresh: false })
          return failure
        }
        try { await onSucceeded(result.user, token) } catch {
          owned.reset()
          const failure = Object.freeze({ state: ADMIN_USER_EDIT_STATES.FAILED, user: null, failureCode: 'request_failed' })
          if (current(token) && workflow === owned) Object.assign(value, failure, { requiresTargetRefresh: false })
          return failure
        }
        if (current(token) && workflow === owned) Object.assign(value, { state: ADMIN_USER_EDIT_STATES.SUCCEEDED, user: result.user, failureCode: null, requiresTargetRefresh: false })
      }
      return result
    }).finally(() => { if (workflow === owned) activePromise = null })
    return activePromise
  }
  const refreshConflict = async (token, loadTarget) => {
    if (!current(token) || !value.requiresTargetRefresh || typeof loadTarget !== 'function') return false
    let next; try { next = safeTarget(await loadTarget(value.target.guid)) } catch { return false }
    if (!current(token) || next.guid !== value.target.guid || !canOpenAdminUserEdit({ actorRole: context.actorRole, actorGuid: context.actorGuid, capabilities: context.capabilities, target: next })) return false
    context = Object.freeze({ ...context, targetGuid: next.guid, expectedAuthVersion: next.authVersion, targetSnapshot: next })
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
