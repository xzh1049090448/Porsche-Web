import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'

import {
  executeAdminUserDemote,
  executeAdminUserPermissionWrite,
  executeAdminUserPromote,
  issueAdminUserDemote,
  issueAdminUserPermissionWrite,
  issueAdminUserPromote,
  queryAdminUserRolePermission,
} from '../api/admin-user-roles-permissions.js'
import { createRolePermissionAttempt, ROLE_PERMISSION_PHASES } from '../api/admin-user-roles-permissions-state.js'

const SAFE_INITIAL = Object.freeze({
  open: false,
  dialogRevision: 0,
  action: null,
  target: null,
  phase: ROLE_PERMISSION_PHASES.IDLE,
  failureCode: null,
  operationRef: null,
  targetGuid: null,
  resultingAuthVersion: null,
  resultingPermissionsVersion: null,
  resultingRole: null,
})
const ACTION_TARGET_ROLE = Object.freeze({
  'users.promote': 'user',
  'users.demote': 'admin',
  'users.permissions.write': 'admin',
})
const GUID = /^[1-9]\d{0,18}$/
const MAX_INT64 = '9223372036854775807'
const validGuid = value => typeof value === 'string' && GUID.test(value)
  && (value.length < MAX_INT64.length || value <= MAX_INT64)
const validAuthVersion = value => Number.isInteger(value) && value >= 1 && value <= 2147483647

function safeTarget(target) {
  if (!target || !validGuid(target.guid) || !validAuthVersion(target.authVersion)
      || !['active', 'disabled'].includes(target.status) || !['user', 'admin'].includes(target.role)) throw new TypeError('invalid_role_permission_target')
  return Object.freeze({
    guid: target.guid,
    username: typeof target.username === 'string' ? target.username : null,
    role: target.role,
    status: target.status,
    authVersion: target.authVersion,
  })
}

function safeContext(scope, input) {
  const target = safeTarget(input?.target)
  if (target.role !== ACTION_TARGET_ROLE[scope] || input.routeGuid !== target.guid
      || typeof input.identityEpoch !== 'string' || input.identityEpoch.length === 0
      || !Number.isSafeInteger(input.capabilityRevision) || input.capabilityRevision < 0
      || !Number.isSafeInteger(input.permissionsVersion) || input.permissionsVersion < (scope === 'users.promote' ? 0 : 1)
      || !Number.isInteger(input.catalogVersion) || input.catalogVersion < 1) throw new TypeError('invalid_role_permission_context')
  return Object.freeze({
    target,
    routeGuid: input.routeGuid,
    identityEpoch: input.identityEpoch,
    capabilityRevision: input.capabilityRevision,
    permissionsVersion: input.permissionsVersion,
    catalogVersion: input.catalogVersion,
  })
}

export function createAdminUserRolePermissionsCoordinator({ state, api, createWorkflow = createRolePermissionAttempt, randomBytes, schedule } = {}) {
  const value = state ?? { ...SAFE_INITIAL }
  let owner = null
  let context = null
  let workflow = null
  let unsubscribe = null
  let active = null
  let sequence = 0

  const resetPublic = revision => Object.assign(value, SAFE_INITIAL, { dialogRevision: revision })
  const owns = token => token != null && token === owner && workflow != null
  const sync = (token, snapshot) => {
    if (!owns(token)) return
    value.phase = snapshot.phase
    value.failureCode = snapshot.failureCode
    value.operationRef = snapshot.operationRef
    value.targetGuid = snapshot.targetGuid
    value.resultingAuthVersion = snapshot.resultingAuthVersion
    value.resultingPermissionsVersion = snapshot.resultingPermissionsVersion
    value.resultingRole = snapshot.resultingRole
  }
  const destroy = () => {
    unsubscribe?.()
    unsubscribe = null
    workflow?.dispose()
    workflow = null
    owner = null
    context = null
    active = null
  }
  const open = (scope, input) => {
    const nextContext = safeContext(scope, input)
    destroy()
    const token = Object.freeze({ rolePermissionDialog: ++sequence })
    owner = token
    context = nextContext
    const revision = (value.dialogRevision ?? 0) + 1
    resetPublic(revision)
    Object.assign(value, { open: true, action: scope, target: nextContext.target })
    const ownedWorkflow = createWorkflow({ api, randomBytes, schedule })
    workflow = ownedWorkflow
    unsubscribe = ownedWorkflow.subscribe(snapshot => sync(token, snapshot))
    return token
  }
  const close = (token = owner) => {
    if (!owns(token)) return false
    const revision = value.dialogRevision
    destroy()
    resetPublic(revision)
    return true
  }
  const dispose = () => {
    const revision = value.dialogRevision ?? 0
    destroy()
    resetPublic(revision)
  }
  const updateContext = (token, next = {}) => {
    if (!owns(token)) return false
    const target = next.target ?? context.target
    const drift = (Object.hasOwn(next, 'routeGuid') && next.routeGuid !== context.routeGuid)
      || (Object.hasOwn(next, 'identityEpoch') && next.identityEpoch !== context.identityEpoch)
      || (Object.hasOwn(next, 'capabilityRevision') && next.capabilityRevision !== context.capabilityRevision)
      || (Object.hasOwn(next, 'permissionsVersion') && next.permissionsVersion !== context.permissionsVersion)
      || (Object.hasOwn(next, 'catalogVersion') && next.catalogVersion !== context.catalogVersion)
      || target.guid !== context.target.guid || target.authVersion !== context.target.authVersion
      || target.role !== context.target.role || target.status !== context.target.status
    if (!drift) return true
    close(token)
    return false
  }
  // Pinia instruments action arguments for devtools. Accept a one-shot reader
  // so the password value is created inside this action and never becomes an
  // action argument or reactive store field.
  const submit = (token, consumeInput) => {
    if (!owns(token) || typeof consumeInput !== 'function') return null
    if (active) return active
    let supplied = consumeInput()
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return null
    const request = {
      targetGuid: context.target.guid,
      expectedAuthVersion: context.target.authVersion,
      expectedPermissionsVersion: context.permissionsVersion,
      catalogVersion: context.catalogVersion,
      reason: supplied.reason,
      currentPassword: supplied.currentPassword,
    }
    if (value.action !== 'users.demote') request.overrides = Array.isArray(supplied.overrides) ? supplied.overrides.map(item => ({ ...item })) : supplied.overrides
    supplied = null
    const ownedWorkflow = workflow
    const ownedContext = context
    active = ownedWorkflow.start(value.action, request).finally(() => {
      if (workflow === ownedWorkflow && context === ownedContext) active = null
    })
    return active
  }
  return Object.freeze({
    openPromote: input => open('users.promote', input),
    openDemote: input => open('users.demote', input),
    openPermissions: input => open('users.permissions.write', input),
    submit,
    close,
    dispose,
    owns,
    updateContext,
  })
}

const productionApi = Object.freeze({
  issuePromote: issueAdminUserPromote,
  executePromote: executeAdminUserPromote,
  issueDemote: issueAdminUserDemote,
  executeDemote: executeAdminUserDemote,
  issuePermissionWrite: issueAdminUserPermissionWrite,
  executePermissionWrite: executeAdminUserPermissionWrite,
  query: queryAdminUserRolePermission,
})
const productionRandomBytes = length => crypto.getRandomValues(new Uint8Array(length))
const productionSchedule = (callback, delay) => {
  const timer = setTimeout(callback, delay)
  return () => clearTimeout(timer)
}

export function createAdminUserRolePermissionsStore(id = 'adminUserRolePermissions', dependencies = {}) {
  return defineStore(id, () => {
    const state = reactive({ ...SAFE_INITIAL })
    const coordinator = createAdminUserRolePermissionsCoordinator({
      state,
      api: dependencies.api ?? productionApi,
      createWorkflow: dependencies.createWorkflow,
      randomBytes: dependencies.randomBytes ?? productionRandomBytes,
      schedule: dependencies.schedule ?? productionSchedule,
    })
    const refs = toRefs(state)
    return {
      isOpen: refs.open,
      dialogRevision: refs.dialogRevision,
      action: refs.action,
      target: refs.target,
      phase: refs.phase,
      failureCode: refs.failureCode,
      operationRef: refs.operationRef,
      targetGuid: refs.targetGuid,
      resultingAuthVersion: refs.resultingAuthVersion,
      resultingPermissionsVersion: refs.resultingPermissionsVersion,
      resultingRole: refs.resultingRole,
      openPromote: coordinator.openPromote,
      openDemote: coordinator.openDemote,
      openPermissions: coordinator.openPermissions,
      submit: coordinator.submit,
      close: coordinator.close,
      dispose: coordinator.dispose,
      owns: coordinator.owns,
      updateContext: coordinator.updateContext,
    }
  })
}

export const useAdminUserRolePermissionsStore = createAdminUserRolePermissionsStore()
