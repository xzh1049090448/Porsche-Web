import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { patchAdminUserStatus } from '../api/admin-user-status.js'
import { ADMIN_USER_STATUS_STATES, createAdminUserStatusWorkflow } from '../api/admin-user-status-state.js'

const INITIAL = Object.freeze({ open: false, dialogRevision: 0, target: null, intendedStatus: null, state: ADMIN_USER_STATUS_STATES.IDLE, user: null, failureCode: null, requiresTargetRefresh: false })
const MAX_INT32 = 2147483647
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const IDENTITY_EPOCH = /^[A-Za-z0-9._:-]{1,128}$/

const compareDecimal = (left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0)
const validGuid = value => typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0
const validIdentityEpoch = value => typeof value === 'string' && IDENTITY_EPOCH.test(value)
const validPermissionVersion = value => Number.isSafeInteger(value) && value >= 0
const validNullableString = value => value == null || typeof value === 'string'
const requiredCapability = status => status === 'disabled' ? 'users.disable' : status === 'active' ? 'users.enable' : null
const validTransition = (current, intended) => current === 'active' && intended === 'disabled' || current === 'disabled' && intended === 'active'
const sameTarget = (value, snapshot) => value && typeof value === 'object' && !Array.isArray(value)
  && value.guid === snapshot.guid && (value.username ?? null) === snapshot.username && (value.nickname ?? null) === snapshot.nickname
  && value.role === snapshot.role && value.status === snapshot.status && value.authVersion === snapshot.authVersion

function safeTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validGuid(value.guid) || !validNullableString(value.username) || !validNullableString(value.nickname)
      || !['user', 'admin', 'root'].includes(value.role) || !['active', 'disabled', 'deleted'].includes(value.status)
      || !Number.isInteger(value.authVersion) || value.authVersion < 1 || value.authVersion >= MAX_INT32) throw new TypeError('invalid_admin_user_status_target')
  return Object.freeze({ guid: value.guid, username: value.username ?? null, nickname: value.nickname ?? null, role: value.role, status: value.status, authVersion: value.authVersion })
}

function safeOwnership(input, target) {
  if (!validGuid(input.actorGuid) || !validIdentityEpoch(input.identityEpoch) || !validPermissionVersion(input.permissionVersion)
      || !Array.isArray(input.capabilities) || input.capabilities.some(capability => typeof capability !== 'string')) throw new TypeError('invalid_admin_user_status_ownership')
  return Object.freeze({ actorRole: input.actorRole, actorGuid: input.actorGuid, capabilities: Object.freeze([...input.capabilities]),
    targetGuid: target.guid, expectedAuthVersion: target.authVersion, targetSnapshot: target, intendedStatus: input.status,
    routeGuid: input.routeGuid, identityEpoch: input.identityEpoch, permissionVersion: input.permissionVersion })
}

export function canOpenAdminUserStatus({ actorRole, actorGuid, capabilities, target, status } = {}) {
  const capability = requiredCapability(status)
  if (!validGuid(actorGuid) || !Array.isArray(capabilities) || !capability || !capabilities.includes(capability)
      || !target || typeof target !== 'object' || Array.isArray(target) || !validGuid(target.guid) || target.guid === actorGuid || !validTransition(target.status, status)
      || !Number.isInteger(target.authVersion) || target.authVersion < 1 || target.authVersion >= MAX_INT32) return false
  return actorRole === 'admin' ? target.role === 'user' : actorRole === 'root' ? target.role === 'user' || target.role === 'admin' : false
}

export function createAdminUserStatusCoordinator({ api = { patchAdminUserStatus }, createWorkflow = createAdminUserStatusWorkflow, onSucceeded = () => {}, state } = {}) {
  const value = state ?? { ...INITIAL }
  let ownership = null
  let sequence = 0
  let workflow = null
  let unsubscribe = null
  let activePromise = null
  let context = null
  let conflictRefreshPromise = null
  let conflictRefreshAttempted = false
  const owns = token => token != null && token === ownership && workflow != null
  const current = token => owns(token) && context && value.open && value.target === context.targetSnapshot
    && value.target?.guid === context.targetGuid && value.target.status === context.targetSnapshot.status
    && value.target.authVersion === context.expectedAuthVersion && value.intendedStatus === context.intendedStatus
  const clear = () => {
    unsubscribe?.(); unsubscribe = null
    workflow?.dispose(); workflow = null
    ownership = null; activePromise = null; context = null; conflictRefreshPromise = null; conflictRefreshAttempted = false
  }
  const close = (token = ownership) => {
    if (!owns(token)) return false
    const revision = value.dialogRevision
    clear(); Object.assign(value, INITIAL, { dialogRevision: revision }); return true
  }
  const open = input => {
    if (ownership) close(ownership)
    if (!canOpenAdminUserStatus(input)) return null
    let target; let nextContext
    try { target = safeTarget(input.target) } catch { return null }
    if (!validGuid(input.routeGuid) || input.routeGuid !== target.guid) return null
    try { nextContext = safeOwnership(input, target) } catch { return null }
    const token = Object.freeze({ statusDialog: ++sequence })
    ownership = token; context = nextContext; conflictRefreshAttempted = false
    Object.assign(value, INITIAL, { open: true, dialogRevision: value.dialogRevision + 1, target, intendedStatus: input.status })
    const owned = createWorkflow({ api }); workflow = owned
    unsubscribe = owned.subscribe(snapshot => {
      if (!current(token) || workflow !== owned || snapshot.state === ADMIN_USER_STATUS_STATES.SUCCEEDED) return
      value.state = snapshot.state; value.user = snapshot.user; value.failureCode = snapshot.failureCode
      value.requiresTargetRefresh = snapshot.state === ADMIN_USER_STATUS_STATES.CONFLICT
    })
    return token
  }
  const updateContext = (token, next) => {
    if (!owns(token) || !next || typeof next !== 'object') return false
    const routeGuid = Object.hasOwn(next, 'routeGuid') ? next.routeGuid : context.routeGuid
    const identityEpoch = Object.hasOwn(next, 'identityEpoch') ? next.identityEpoch : context.identityEpoch
    const permissionVersion = Object.hasOwn(next, 'permissionVersion') ? next.permissionVersion : context.permissionVersion
    const targetChanged = Object.hasOwn(next, 'target') && !sameTarget(next.target, context.targetSnapshot)
    const changed = routeGuid !== context.routeGuid || identityEpoch !== context.identityEpoch || permissionVersion !== context.permissionVersion || targetChanged
    if (changed) { close(token); return false }
    if (!validGuid(routeGuid) || !validIdentityEpoch(identityEpoch) || !validPermissionVersion(permissionVersion)) return false
    if (Object.hasOwn(next, 'target')) { try { safeTarget(next.target) } catch { return false } }
    return true
  }
  const failOwned = (token, owned) => {
    owned.reset()
    const failure = Object.freeze({ state: ADMIN_USER_STATUS_STATES.FAILED, user: null, failureCode: 'request_failed' })
    if (current(token) && workflow === owned) Object.assign(value, failure, { requiresTargetRefresh: false })
    return failure
  }
  const submit = (token, input) => {
    if (!current(token)) return null
    if (activePromise) return activePromise
    const owned = workflow
    const targetGuid = context.targetGuid
    const intendedStatus = context.intendedStatus
    const expectedAuthVersion = context.expectedAuthVersion
    activePromise = owned.start({ targetGuid, status: intendedStatus, reason: input?.reason, expectedAuthVersion }).then(async result => {
      if (!current(token) || workflow !== owned) return result
      if (result.state === ADMIN_USER_STATUS_STATES.SUCCEEDED) {
        if (result.user?.guid !== targetGuid || result.user.status !== intendedStatus || result.user.authVersion !== expectedAuthVersion + 1) return failOwned(token, owned)
        try { await onSucceeded(result.user, token) } catch { return failOwned(token, owned) }
        if (current(token) && workflow === owned) Object.assign(value, { state: ADMIN_USER_STATUS_STATES.SUCCEEDED, user: result.user, failureCode: null, requiresTargetRefresh: false })
      }
      return result
    }).finally(() => { if (workflow === owned) activePromise = null })
    return activePromise
  }
  const reset = token => {
    if (!current(token) || activePromise || value.state !== ADMIN_USER_STATUS_STATES.FAILED) return false
    return workflow.reset()
  }
  const refreshConflict = (token, loadTarget, onFresh = () => {}) => {
    if (conflictRefreshPromise && current(token)) return conflictRefreshPromise
    if (!current(token) || conflictRefreshAttempted || !value.requiresTargetRefresh || typeof loadTarget !== 'function') return Promise.resolve(false)
    conflictRefreshAttempted = true
    const owned = workflow
    const ownedContext = context
    let flight
    flight = (async () => {
      try {
        let next
        try { next = safeTarget(await loadTarget(ownedContext.targetGuid)) } catch { return false }
        if (!current(token) || workflow !== owned || context !== ownedContext || next.guid !== ownedContext.targetGuid) return false
        try { onFresh(next) } catch { return false }
        if (!canOpenAdminUserStatus({ actorRole: ownedContext.actorRole, actorGuid: ownedContext.actorGuid, capabilities: ownedContext.capabilities, target: next, status: ownedContext.intendedStatus })) {
          close(token); return false
        }
        context = Object.freeze({ ...ownedContext, expectedAuthVersion: next.authVersion, targetSnapshot: next })
        value.target = next; value.requiresTargetRefresh = false; owned.reset(); return true
      } finally {
        if (conflictRefreshPromise === flight) conflictRefreshPromise = null
      }
    })()
    conflictRefreshPromise = flight
    return flight
  }
  return { state: value, open, close, dispose: close, owns, updateContext, submit, reset, refreshConflict }
}

export const useAdminUserStatusStore = defineStore('adminUserStatus', () => {
  const state = reactive({ ...INITIAL })
  const coordinator = createAdminUserStatusCoordinator({ state })
  const refs = toRefs(state)
  return {
    isOpen: refs.open, dialogRevision: refs.dialogRevision, target: refs.target, intendedStatus: refs.intendedStatus,
    state: refs.state, user: refs.user, failureCode: refs.failureCode, requiresTargetRefresh: refs.requiresTargetRefresh,
    open: coordinator.open, close: coordinator.close, dispose: coordinator.dispose, owns: coordinator.owns,
    updateContext: coordinator.updateContext, submit: coordinator.submit, reset: coordinator.reset, refreshConflict: coordinator.refreshConflict,
  }
})
