import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { createAdminUserCreateWorkflow, ADMIN_USER_CREATE_STATES } from '../api/admin-user-create-state.js'
import { executeAdminUserCreate, issueAdminUserCreateVerification, queryAdminUserCreate } from '../api/admin-user-create.js'
import { DEFAULT_ADMIN_GROUP_CHOICE, loadAdminGroupChoices } from '../api/admin-groups.js'
import { getAuthzCatalog } from '../api/admin-users.js'

const DEFAULT_GROUPS = Object.freeze([DEFAULT_ADMIN_GROUP_CHOICE])
const SAFE_INITIAL = Object.freeze({
  open: false,
  dialogRevision: 0,
  actorRole: null,
  capabilities: Object.freeze([]),
  role: 'user',
  state: ADMIN_USER_CREATE_STATES.IDLE,
  operationRef: null,
  failureCode: null,
  createdUser: null,
  groups: DEFAULT_GROUPS,
  groupsLoading: false,
  groupsError: false,
  catalog: null,
  catalogLoading: false,
  catalogError: false,
})

const CONFLICT_FAILURES = new Set([
  'username_conflict', 'idempotency_conflict', 'idempotency_cross_session',
  'policy_version_conflict', 'action_verification_conflict', 'action_group_not_found',
])

export function canOpenAdminUserCreate({ actorRole, capabilities } = {}) {
  return (actorRole === 'admin' || actorRole === 'root')
    && Array.isArray(capabilities) && capabilities.includes('users.create')
}

export function availableAdminUserCreateRoles(actorRole) {
  return actorRole === 'root' ? ['user', 'admin'] : actorRole === 'admin' ? ['user'] : []
}

export function canChooseAdminUserCreatePlan(capabilities, planType) {
  if (!Array.isArray(capabilities) || !capabilities.includes('users.create')) return false
  if (planType === 'free') return true
  return (planType === 'professional' || planType === 'enterprise') && capabilities.includes('users.plan.change')
}

export function canChooseAdminUserCreateGroup(capabilities, choice) {
  if (!Array.isArray(capabilities) || !capabilities.includes('users.create') || !choice) return false
  if (choice.key === 'default') return choice.guid == null || capabilities.includes('groups.read')
  return typeof choice.guid === 'string' && capabilities.includes('groups.read') && capabilities.includes('users.group.change')
}

export function buildAdminPermissionOverrides({ role, catalog, effects } = {}) {
  if (role === 'user') return Object.freeze([])
  if (role !== 'admin' || !catalog || !Array.isArray(catalog.capabilities)
      || !effects || typeof effects !== 'object' || Array.isArray(effects)) throw new Error('invalid_permission_override')
  const allowed = new Map(catalog.capabilities
    .filter(item => item?.grantable === true && item.root_only === false && item.available === true)
    .map(item => [item.name, item]))
  for (const [name, effect] of Object.entries(effects)) {
    if (!allowed.has(name) || !['inherit', 'allow', 'deny'].includes(effect)) throw new Error('invalid_permission_override')
  }
  return Object.freeze(catalog.capabilities.flatMap(item => {
    if (!allowed.has(item.name)) return []
    const effect = effects[item.name] ?? 'inherit'
    return effect === 'inherit' ? [] : [Object.freeze({ capability: item.name, effect })]
  }))
}

export const isAdminUserCreateBusy = state => [
  ADMIN_USER_CREATE_STATES.VERIFYING,
  ADMIN_USER_CREATE_STATES.SUBMITTING,
  ADMIN_USER_CREATE_STATES.UNKNOWN,
  ADMIN_USER_CREATE_STATES.QUERYING,
].includes(state)

export function canSubmitAdminUserCreate({ state, role, catalog } = {}) {
  return [ADMIN_USER_CREATE_STATES.IDLE, ADMIN_USER_CREATE_STATES.FAILED].includes(state)
    && (role === 'user' || role === 'admin' && catalog != null)
}

function nativeInput(inputRef) {
  return inputRef?.value?.input ?? inputRef?.value?.$el?.querySelector?.('input') ?? inputRef?.input ?? inputRef
}

export function clearAdminUserCreateSecrets({ form, passwordInputs = [], clearValidate = () => {} } = {}) {
  if (form) {
    form.password = ''
    form.confirmPassword = ''
    form.currentPassword = ''
  }
  for (const inputRef of passwordInputs) {
    const input = nativeInput(inputRef)
    if (input && 'value' in input) input.value = ''
  }
  clearValidate()
}

export function focusAdminUserCreateError({ token, owns, errorAlert, nextTick }) {
  if (!owns(token)) return false
  nextTick(() => { if (owns(token)) (errorAlert?.value?.$el ?? errorAlert?.value)?.focus?.() })
  return true
}

export function settleAdminUserCreateDialog({ token, result, owns, close, focusError }) {
  if (!owns(token)) return false
  if (result?.state === ADMIN_USER_CREATE_STATES.SUCCEEDED) close(token)
  else if (result?.state === ADMIN_USER_CREATE_STATES.FAILED || result?.state === ADMIN_USER_CREATE_STATES.PENDING_RECOVERY) focusError(token)
  return true
}

export function settleAdminUserCreateClosed({ currentToken, clearForm, emitClosed }) {
  if (currentToken) return false
  clearForm()
  emitClosed()
  return true
}

export function restoreAdminUserCreateTriggerFocus({ token, canRestore, trigger, fallback, nextTick }) {
  if (!canRestore(token)) return false
  nextTick(() => {
    if (canRestore(token)) (trigger?.isConnected ? trigger : fallback?.$el ?? fallback)?.focus?.()
  })
  return true
}

export function createAdminUserCreateCoordinator({
  api,
  createWorkflow = createAdminUserCreateWorkflow,
  randomBytes,
  schedule,
  loadGroups = (capabilities, options) => loadAdminGroupChoices(capabilities, { options }),
  loadCatalog = options => getAuthzCatalog(options),
  onSucceeded = () => {},
  onConflict = () => true,
  onUnauthorized = () => {},
  state,
} = {}) {
  const value = state ?? { ...SAFE_INITIAL }
  let workflow = null
  let unsubscribe = null
  let ownership = null
  let nextOwnership = 0
  let submitPromise = null
  let preparedPromise = Promise.resolve(false)
  let groupAbort = null
  let catalogAbort = null
  let catalogRevision = 0
  let callbacks = { onSucceeded, onConflict, onUnauthorized }

  const owns = token => token != null && token === ownership && workflow != null
  const captureOwnership = () => ownership
  const sync = snapshot => {
    value.state = snapshot.state
    value.operationRef = snapshot.operationRef
    value.failureCode = snapshot.failureCode ?? null
    value.createdUser = snapshot.createdUser ?? null
  }
  const abortDirectories = () => {
    groupAbort?.abort()
    catalogAbort?.abort()
    groupAbort = null
    catalogAbort = null
    catalogRevision++
  }
  const destroyWorkflow = () => {
    abortDirectories()
    unsubscribe?.()
    unsubscribe = null
    workflow?.unmount()
    workflow = null
    ownership = null
    submitPromise = null
    preparedPromise = Promise.resolve(false)
  }
  const close = (token = ownership) => {
    if (!owns(token)) return false
    const dialogRevision = value.dialogRevision
    destroyWorkflow()
    Object.assign(value, SAFE_INITIAL, { dialogRevision })
    return true
  }

  const refreshGroups = async token => {
    if (!owns(token)) return false
    if (!value.capabilities.includes('groups.read')) {
      value.groups = DEFAULT_GROUPS
      value.groupsLoading = false
      value.groupsError = false
      return true
    }
    groupAbort?.abort()
    const controller = new AbortController()
    groupAbort = controller
    value.groups = Object.freeze([])
    value.groupsLoading = true
    value.groupsError = false
    try {
      const groups = await loadGroups(value.capabilities, { signal: controller.signal })
      if (!owns(token) || groupAbort !== controller) return false
      if (!Array.isArray(groups) || groups.length === 0) throw new Error('invalid_groups')
      value.groups = Object.freeze([...groups])
      return true
    } catch (error) {
      if (!owns(token) || groupAbort !== controller || error?.name === 'AbortError') return false
      value.groups = Object.freeze([])
      value.groupsError = true
      return false
    } finally {
      if (owns(token) && groupAbort === controller) {
        groupAbort = null
        value.groupsLoading = false
      }
    }
  }

  const refreshCatalog = async token => {
    if (!owns(token) || value.actorRole !== 'root' || value.role !== 'admin') return false
    catalogAbort?.abort()
    const controller = new AbortController()
    catalogAbort = controller
    const revision = ++catalogRevision
    value.catalog = null
    value.catalogLoading = true
    value.catalogError = false
    try {
      const catalog = await loadCatalog({ signal: controller.signal })
      if (!owns(token) || value.role !== 'admin' || catalogAbort !== controller || catalogRevision !== revision) return false
      if (!catalog || !Array.isArray(catalog.capabilities)) throw new Error('invalid_catalog')
      value.catalog = catalog
      return true
    } catch (error) {
      if (!owns(token) || catalogAbort !== controller || error?.name === 'AbortError') return false
      value.catalog = null
      value.catalogError = true
      return false
    } finally {
      if (owns(token) && catalogAbort === controller) {
        catalogAbort = null
        value.catalogLoading = false
      }
    }
  }

  const open = (context, nextCallbacks = {}) => {
    if (!canOpenAdminUserCreate(context)) return null
    destroyWorkflow()
    const token = Object.freeze({ createDialog: ++nextOwnership })
    ownership = token
    const capabilities = Object.freeze([...context.capabilities])
    Object.assign(value, SAFE_INITIAL, {
      open: true,
      dialogRevision: value.dialogRevision + 1,
      actorRole: context.actorRole,
      capabilities,
      groups: context.capabilities.includes('groups.read') ? Object.freeze([]) : DEFAULT_GROUPS,
    })
    callbacks = {
      onSucceeded: nextCallbacks.onSucceeded ?? onSucceeded,
      onConflict: nextCallbacks.onConflict ?? onConflict,
      onUnauthorized: nextCallbacks.onUnauthorized ?? onUnauthorized,
    }
    const ownedWorkflow = createWorkflow({ api, randomBytes, schedule })
    workflow = ownedWorkflow
    unsubscribe = ownedWorkflow.subscribe(snapshot => { if (owns(token) && workflow === ownedWorkflow) sync(snapshot) })
    preparedPromise = refreshGroups(token)
    return token
  }

  const whenPrepared = token => owns(token) ? preparedPromise : Promise.resolve(false)
  const setRole = async (token, role) => {
    if (!owns(token) || !availableAdminUserCreateRoles(value.actorRole).includes(role)) return false
    if (value.role === role) return role === 'user' || value.catalog != null || refreshCatalog(token)
    value.role = role
    value.catalog = null
    value.catalogError = false
    catalogAbort?.abort()
    catalogAbort = null
    catalogRevision++
    if (role === 'admin') return refreshCatalog(token)
    value.catalogLoading = false
    return true
  }

  const validGroupInput = groupGuid => {
    if (groupGuid == null) return true
    const choice = value.groups.find(group => group.guid === groupGuid)
    return canChooseAdminUserCreateGroup(value.capabilities, choice)
  }

  const submit = (token = ownership, input) => {
    if (!owns(token)) return null
    if (submitPromise) return submitPromise
    if (!canSubmitAdminUserCreate(value) || !input || input.role !== value.role
        || !canChooseAdminUserCreatePlan(value.capabilities, input.planType ?? 'free')
        || !validGroupInput(input.groupGuid)) return null
    if (value.role === 'admin') {
      try {
        const canonical = buildAdminPermissionOverrides({ role: 'admin', catalog: value.catalog, effects: Object.fromEntries((input.permissionOverrides ?? []).map(item => [item.capability, item.effect])) })
        if (JSON.stringify(canonical) !== JSON.stringify(input.permissionOverrides ?? [])) return null
      } catch { return null }
    } else if (Array.isArray(input.permissionOverrides) && input.permissionOverrides.length !== 0) return null
    const ownedWorkflow = workflow
    if (value.state === ADMIN_USER_CREATE_STATES.FAILED && !ownedWorkflow.reset()) return null
    if (value.state !== ADMIN_USER_CREATE_STATES.IDLE) return null
    const run = (async () => {
      const workflowInput = { ...input, role: value.role }
      let started
      try { started = ownedWorkflow.start(workflowInput) } finally {
        input = null
        workflowInput.password = null
        workflowInput.currentPassword = null
      }
      const result = await started
      if (!owns(token) || workflow !== ownedWorkflow) return result
      if (result?.state === ADMIN_USER_CREATE_STATES.SUCCEEDED) {
        await callbacks.onSucceeded({ createdUser: result.createdUser ?? null, operationRef: result.operationRef ?? null }, token)
      } else if (result?.state === ADMIN_USER_CREATE_STATES.FAILED) {
        if (result.failureCode === 'authentication_failed') {
          try { callbacks.onUnauthorized() } finally { close(token) }
        } else if (CONFLICT_FAILURES.has(result.failureCode)) {
          await callbacks.onConflict(result.failureCode, token)
        }
      }
      return result
    })()
    submitPromise = run
    void run.finally(() => { if (owns(token) && workflow === ownedWorkflow && submitPromise === run) submitPromise = null })
    return run
  }

  return {
    state: value,
    open,
    close,
    dispose: close,
    owns,
    captureOwnership,
    whenPrepared,
    setRole,
    refreshGroups,
    refreshCatalog,
    submit,
  }
}

const productionRandomBytes = length => crypto.getRandomValues(new Uint8Array(length))
const productionSchedule = (callback, delay) => {
  const timer = setTimeout(callback, delay)
  return () => clearTimeout(timer)
}

export const useAdminUserCreateStore = defineStore('adminUserCreate', () => {
  const state = reactive({ ...SAFE_INITIAL })
  const coordinator = createAdminUserCreateCoordinator({
    state,
    api: { issueAdminUserCreateVerification, executeAdminUserCreate, queryAdminUserCreate },
    randomBytes: productionRandomBytes,
    schedule: productionSchedule,
  })
  return {
    ...toRefs(state),
    open: coordinator.open,
    close: coordinator.close,
    dispose: coordinator.dispose,
    owns: coordinator.owns,
    captureOwnership: coordinator.captureOwnership,
    whenPrepared: coordinator.whenPrepared,
    setRole: coordinator.setRole,
    refreshGroups: coordinator.refreshGroups,
    refreshCatalog: coordinator.refreshCatalog,
    submit: coordinator.submit,
  }
})
