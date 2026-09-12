<template>
  <section class="admin-page console-page user-detail-page">
    <header ref="pageHeading" class="page-header" tabindex="-1"><div class="page-header__copy"><p class="page-header__eyebrow">ADMINISTRATION</p><h1>用户详情</h1><p class="page-header__description">查看用户身份、套餐和权限状态。</p></div><div class="page-header__actions"><el-button @click="$router.push('/users')">返回用户列表</el-button></div></header>

    <el-alert v-if="!canRead" type="warning" :closable="false" title="暂无用户管理权限" description="权限信息不可用时不会加载用户详情。">
      <template #default><el-button link type="primary" @click="retryIdentity">重新检查身份</el-button></template>
    </el-alert>
    <el-alert v-else-if="store.detailError" type="error" show-icon :closable="false" :title="detailErrorTitle" :description="detailErrorDescription">
      <template #default><el-button link type="primary" @click="retryDetail">重试</el-button></template>
    </el-alert>
    <el-skeleton v-else-if="store.detailLoading" :rows="6" animated />

    <template v-else-if="store.selected">
      <el-card shadow="never" class="surface-card detail-surface">
        <template #header>
          <div class="title"><span class="title-name">{{ store.selected.username || '未设置用户名' }}</span><span class="title-actions detail-action-toolbar"><span class="status-badge" :class="`status-badge--${statusTone}`"><span class="status-badge__dot" aria-hidden="true" />{{ statusLabel }}</span><el-button v-if="canPromoteTarget" plain @click="openRolePermission('users.promote', store.selected, $event)">提升为管理员</el-button><el-button v-if="canPermissionsTarget" plain @click="openRolePermission('users.permissions.write', store.selected, $event)">权限设置</el-button><el-button v-if="canDemoteTarget" plain @click="openRolePermission('users.demote', store.selected, $event)">降级为普通用户</el-button><el-button v-if="canPasswordResetTarget" plain @click="openPasswordReset(store.selected, $event)">重置密码</el-button><el-button v-if="canStatusTarget" :type="nextStatus === 'disabled' ? 'danger' : 'primary'" plain @click="openStatus(store.selected, $event)">{{ nextStatus === 'disabled' ? '禁用' : '启用' }}</el-button><el-button v-if="canDeleteTarget" type="danger" plain @click="openDelete(store.selected, $event)">{{ t('deleteUser.confirm') }}</el-button></span></div>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="GUID">{{ store.selected.guid }}</el-descriptions-item>
          <el-descriptions-item label="昵称">
            <span class="nickname-row"><span>{{ store.selected.nickname || '未设置' }}</span><el-button v-if="canEditTarget" link type="primary" @click="openEdit(store.selected, $event)">{{ t('editUser.open') }}</el-button></span>
          </el-descriptions-item>
          <el-descriptions-item label="角色">{{ store.selected.role === 'admin' ? '管理员' : '用户' }}</el-descriptions-item>
          <el-descriptions-item label="套餐"><span class="nickname-row"><span>{{ planLabel }}</span><el-button v-if="canPlanChangeTarget" link type="primary" @click="openPlanChange(store.selected, $event)">变更</el-button></span></el-descriptions-item>
          <el-descriptions-item label="邮箱">未设置</el-descriptions-item>
          <el-descriptions-item label="分组"><span class="nickname-row"><span>{{ store.selected.group }}</span><el-button v-if="canGroupChangeTarget" link type="primary" @click="openGroupChange(store.selected, $event)">变更</el-button></span></el-descriptions-item>
          <el-descriptions-item label="金额额度">未接入</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ store.selected.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="最近登录">{{ store.selected.lastLoginAt || '从未登录' }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card v-if="showPermissions" shadow="never" class="permissions surface-card">
        <template #header>权限信息</template>
        <el-alert v-if="permissionUnavailable" type="warning" :closable="false" title="权限信息暂不可用" description="请重新检查身份后重试。">
          <template #default><el-button link type="primary" @click="retryIdentity">重新检查身份</el-button></template>
        </el-alert>
        <div v-else class="responsive-table"><el-table :data="permissionRows">
          <el-table-column prop="name" label="能力" />
          <el-table-column prop="baseline" label="基线" />
          <el-table-column prop="override" label="覆盖" />
          <el-table-column prop="policy_effective" label="策略结果" />
          <el-table-column prop="effective" label="当前有效" />
        </el-table></div>
      </el-card>
    </template>
    <p class="sr-only" role="status" aria-live="polite">{{ editAnnouncement }} {{ statusAnnouncement }} {{ entitlementAnnouncement }} {{ rolePermissionAnnouncement }}</p>
    <UserStatusDialog :owner="statusToken" @succeeded="onStatusSucceeded" @conflict="onStatusConflict" @failed="onStatusFailed" @closed="restoreStatusFocus" />
    <UserNicknameEditDialog :owner="editToken" @succeeded="onEditSucceeded" @conflict="onEditConflict" @failed="onEditFailed" @closed="restoreEditFocus" />
    <UserSoftDeleteDialog @closed="restoreDeleteFocus" />
    <UserPasswordResetDialog :owner="passwordResetToken" @succeeded="onPasswordResetSucceeded" @conflict="() => refreshEntitlementConflict('password')" @failed="code => onEntitlementFailed('password', code)" @closed="token => restoreEntitlementFocus('password', token)" />
    <UserGroupChangeDialog :owner="groupChangeToken" @succeeded="(user, token) => onDirectEntitlementSucceeded('group', user, token)" @conflict="() => refreshEntitlementConflict('group')" @failed="code => onEntitlementFailed('group', code)" @closed="token => restoreEntitlementFocus('group', token)" />
    <UserPlanChangeDialog :owner="planChangeToken" @succeeded="(user, token) => onDirectEntitlementSucceeded('plan', user, token)" @conflict="() => refreshEntitlementConflict('plan')" @failed="code => onEntitlementFailed('plan', code)" @closed="token => restoreEntitlementFocus('plan', token)" />
    <UserPromoteDialog v-if="rolePermissionToken && rolePermissionStore.action === 'users.promote'" :owner="rolePermissionToken" :catalog="store.catalog" @succeeded="onRolePermissionSucceeded" @conflict="onRolePermissionConflict" @failed="onRolePermissionFailed" @closed="restoreRolePermissionFocus" />
    <UserDemoteDialog v-if="rolePermissionToken && rolePermissionStore.action === 'users.demote'" :owner="rolePermissionToken" @succeeded="onRolePermissionSucceeded" @conflict="onRolePermissionConflict" @failed="onRolePermissionFailed" @closed="restoreRolePermissionFocus" />
    <UserPermissionsDialog v-if="rolePermissionToken && rolePermissionStore.action === 'users.permissions.write'" :owner="rolePermissionToken" :catalog="store.catalog" :policy="store.permissions" @succeeded="onRolePermissionSucceeded" @conflict="onRolePermissionConflict" @failed="onRolePermissionFailed" @closed="restoreRolePermissionFocus" />
  </section>
</template>

<script>
export function reconcileAdminUserEditSuccess({ state, user, targetGuid, expectedAuthVersion, isCurrent }) {
  if (typeof isCurrent !== 'function' || !isCurrent() || !user || user.guid !== targetGuid || user.authVersion !== expectedAuthVersion
      || state.selected?.guid !== targetGuid || state.selected.authVersion !== expectedAuthVersion) return false
  state.selected = user
  if (Array.isArray(state.rows)) state.rows = state.rows.map(row => row?.guid === targetGuid && row.authVersion === expectedAuthVersion ? user : row)
  return true
}

export function reconcileAdminUserEditRefresh({ state, target, targetGuid, isCurrent }) {
  if (typeof isCurrent !== 'function' || !isCurrent() || !target || target.guid !== targetGuid || state.selected?.guid !== targetGuid) return false
  state.selected = target
  if (Array.isArray(state.rows)) state.rows = state.rows.map(row => row?.guid === targetGuid ? target : row)
  return true
}

export async function recoverAdminUserEditForbidden({ refreshIdentity, refreshTarget, isCurrent, canRestore, restore } = {}) {
  if (![refreshIdentity, refreshTarget, isCurrent, canRestore, restore].every(value => typeof value === 'function')) return false
  try { await refreshIdentity() } catch { return false }
  if (!isCurrent()) return false
  let target
  try { target = await refreshTarget() } catch { return false }
  if (!isCurrent() || !canRestore(target)) return false
  restore(target)
  return true
}

export function createAdminUserDetailLoadSingleflight() {
  let active = null
  const cancel = () => { active = null }
  const run = ({ guid, identityEpoch, permissionVersion, load } = {}) => {
    const canonicalGuid = typeof guid === 'string' && /^[1-9]\d{0,18}$/.test(guid) && (guid.length < 19 || guid <= '9223372036854775807')
    if (!canonicalGuid || typeof identityEpoch !== 'string' || identityEpoch.length === 0 || !Number.isSafeInteger(permissionVersion) || permissionVersion < 0 || typeof load !== 'function') {
      return Promise.reject(new TypeError('invalid_admin_user_detail_load'))
    }
    if (active?.guid === guid && active.identityEpoch === identityEpoch && active.permissionVersion === permissionVersion) return active.promise
    const flight = { guid, identityEpoch, permissionVersion, promise: null }
    active = flight
    flight.promise = Promise.resolve().then(load).finally(() => { if (active === flight) active = null })
    return flight.promise
  }
  return Object.freeze({ run, cancel })
}

export function createAdminUserEditConflictSingleflight() {
  let active = null
  const cancel = () => { active = null }
  const run = ({ token, context, isCurrent, execute } = {}) => {
    if (!token || !context || typeof isCurrent !== 'function' || typeof execute !== 'function' || !isCurrent(token, context)) return Promise.resolve(false)
    if (active?.token === token && active.context === context) return active.promise
    const flight = { token, context, promise: null }
    const current = () => active === flight && isCurrent(token, context)
    active = flight
    flight.promise = Promise.resolve().then(() => execute(current)).then(
      result => current() ? result : false,
      error => { if (!current()) return false; throw error },
    ).finally(() => { if (active === flight) active = null })
    return flight.promise
  }
  return Object.freeze({ run, cancel })
}

const eligibleRolePermissionTarget = ({ actorRole, actorGuid, capabilities, routeGuid, target, capability, role }) => actorRole === 'root'
  && actorGuid !== target?.guid && routeGuid === target?.guid && target?.role === role && ['active', 'disabled'].includes(target?.status)
  && Array.isArray(capabilities) && capabilities.includes(capability)
export const canOpenPromote = input => eligibleRolePermissionTarget({ ...input, capability: 'users.promote', role: 'user' })
export const canOpenDemote = input => eligibleRolePermissionTarget({ ...input, capability: 'users.demote', role: 'admin' })
export const canOpenPermissions = input => eligibleRolePermissionTarget({ ...input, capability: 'users.permissions.write', role: 'admin' })

export function reconcileRolePermissionSuccess({ state, context, result, fresh, isCurrent } = {}) {
  if (typeof isCurrent !== 'function' || !isCurrent() || !state || !context || !result || !fresh?.target) return false
  if (state.selected?.guid !== context.targetGuid || state.selected.role !== context.targetRole || state.selected.authVersion !== context.authVersion
      || result.targetGuid !== context.targetGuid || result.resultingRole !== context.resultingRole
      || result.resultingAuthVersion !== context.authVersion + 1 || result.resultingPermissionsVersion !== context.permissionsVersion + 1
      || fresh.target.guid !== context.targetGuid || fresh.target.role !== result.resultingRole || fresh.target.authVersion !== result.resultingAuthVersion
      || !['active', 'disabled'].includes(fresh.target.status)) return false
  if (result.resultingRole === 'admin') {
    if (!fresh.permissions || fresh.permissions.user_guid !== context.targetGuid || fresh.permissions.role !== 'admin'
        || fresh.permissions.permissions_version !== String(result.resultingPermissionsVersion)) return false
  } else if (fresh.permissions !== null) return false
  state.selected = fresh.target
  if (Array.isArray(state.rows)) state.rows = state.rows.map(row => row?.guid === context.targetGuid && row.role === context.targetRole && row.authVersion === context.authVersion ? fresh.target : row)
  state.permissions = fresh.permissions
  return true
}
</script>

<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import * as adminUsersStores from '@/stores/admin-users'
import { useAdminUserActionsStore, canDeleteAdminUser, reconcileDeletedDetail, refreshDeleteTargetFailClosed, restoreDeleteTriggerFocus } from '@/stores/admin-user-actions'
import { useAdminUserEditStore, canOpenAdminUserEdit } from '@/stores/admin-user-edit'
import { useAdminUserStatusStore, canOpenAdminUserStatus } from '@/stores/admin-user-status'
import { useAdminUserPasswordResetStore } from '@/stores/admin-user-password-reset'
import { useAdminUserGroupChangeStore } from '@/stores/admin-user-group-change'
import { useAdminUserPlanChangeStore } from '@/stores/admin-user-plan-change'
import { canOpenPasswordReset, canOpenGroupChange, canOpenPlanChange } from '@/stores/admin-user-entitlements'
import { getAdminUser } from '@/api/admin-users'
import UserSoftDeleteDialog from '@/components/admin/UserSoftDeleteDialog.vue'
import UserNicknameEditDialog from '@/components/admin/UserNicknameEditDialog.vue'
import UserStatusDialog from '@/components/admin/UserStatusDialog.vue'
import UserPasswordResetDialog from '@/components/admin/UserPasswordResetDialog.vue'
import UserGroupChangeDialog from '@/components/admin/UserGroupChangeDialog.vue'
import UserPlanChangeDialog from '@/components/admin/UserPlanChangeDialog.vue'
import { useI18n } from '@/composables/useI18n'
import { ElMessage } from 'element-plus'

const route = useRoute()
const userStore = useUserStore()
const store = adminUsersStores.useAdminUsersStore()
const rolePermissionStore = adminUsersStores.useAdminUserRolePermissionsStore?.() ?? { action:null, owns:()=>false, close:()=>false, dispose(){}, updateContext:()=>false }
const UserPromoteDialog = defineAsyncComponent(() => import('@/components/admin/UserPromoteDialog.vue'))
const UserDemoteDialog = defineAsyncComponent(() => import('@/components/admin/UserDemoteDialog.vue'))
const UserPermissionsDialog = defineAsyncComponent(() => import('@/components/admin/UserPermissionsDialog.vue'))
const actionStore = useAdminUserActionsStore()
const editStore = useAdminUserEditStore()
const statusStore = useAdminUserStatusStore()
const passwordResetStore = useAdminUserPasswordResetStore()
const groupChangeStore = useAdminUserGroupChangeStore()
const planChangeStore = useAdminUserPlanChangeStore()
const detailLoadFlight = createAdminUserDetailLoadSingleflight()
const { t } = useI18n()
const canRead = computed(() => userStore.permissionProjection?.capabilities?.includes('users.read') === true)
const deleteCapability = 'users.delete'
const canDeleteTarget = computed(() => userStore.permissionProjection?.capabilities?.includes(deleteCapability) === true
  && canDeleteAdminUser({ actorRole: userStore.user?.role, capabilities: userStore.permissionProjection.capabilities, target: store.selected }))
const editInvalidatedGuid = ref(null)
const canEditTarget = computed(() => editInvalidatedGuid.value !== store.selected?.guid && canOpenAdminUserEdit({ actorRole: userStore.user?.role, actorGuid: userStore.user?.guid,
  capabilities: userStore.permissionProjection?.capabilities, target: store.selected }))
const statusInvalidatedGuid = ref(null)
const nextStatus = computed(() => store.selected?.status === 'active' ? 'disabled' : store.selected?.status === 'disabled' ? 'active' : null)
const statusCapability = computed(() => nextStatus.value === 'disabled' ? 'users.disable' : nextStatus.value === 'active' ? 'users.enable' : null)
const statusRouteCurrent = computed(() => typeof route.params.guid === 'string' && /^[1-9]\d{0,18}$/.test(route.params.guid)
  && (route.params.guid.length < 19 || route.params.guid <= '9223372036854775807') && route.params.guid === store.selected?.guid)
const canStatusTarget = computed(() => statusRouteCurrent.value && statusInvalidatedGuid.value !== store.selected?.guid && userStore.permissionProjection?.capabilities?.includes(statusCapability.value) === true
  && canOpenAdminUserStatus({ actorRole:userStore.user?.role, actorGuid:userStore.user?.guid,
  capabilities:userStore.permissionProjection?.capabilities, target:store.selected, status:nextStatus.value }))
const entitlementInput = computed(() => ({ actorRole:userStore.user?.role, actorGuid:userStore.user?.guid, capabilities:userStore.permissionProjection?.capabilities, target:store.selected }))
const canPasswordResetTarget = computed(() => statusRouteCurrent.value && canOpenPasswordReset(entitlementInput.value))
const canGroupChangeTarget = computed(() => statusRouteCurrent.value && canOpenGroupChange(entitlementInput.value))
const canPlanChangeTarget = computed(() => statusRouteCurrent.value && canOpenPlanChange(entitlementInput.value))
const rolePermissionInput = computed(() => ({ ...entitlementInput.value, routeGuid:route.params.guid }))
const catalogReady = computed(() => store.catalog?.catalog_version === 1)
const permissionsReady = computed(() => store.permissions?.permissions_version && /^([1-9]\d*)$/.test(store.permissions.permissions_version))
const canPromoteTarget = computed(() => catalogReady.value && canOpenPromote(rolePermissionInput.value))
const canPermissionsTarget = computed(() => catalogReady.value && permissionsReady.value && canOpenPermissions(rolePermissionInput.value))
const canDemoteTarget = computed(() => catalogReady.value && permissionsReady.value && canOpenDemote(rolePermissionInput.value))
const showPermissions = computed(() => canRead.value && store.selected?.status !== 'deleted' && store.selected?.role === 'admin' && userStore.user?.role === 'root')
const permissionUnavailable = computed(() => showPermissions.value && !store.permissions)
const permissionRows = computed(() => store.permissions?.capabilities || [])
const detailStatus = computed(() => store.detailError?.response?.status)
const detailErrorTitle = computed(() => ({ 401: '认证会话无效', 403: '无权限访问', 404: '用户不存在', 503: '用户信息暂不可用' }[detailStatus.value] || '用户信息暂不可用'))
const detailErrorDescription = computed(() => detailStatus.value === 403 ? '当前身份保持登录状态，可重新检查权限。' : '当前详情数据已清理，请重试或返回用户列表。')
const statusLabel = computed(() => ({ active: '启用', disabled: '禁用', deleted: '已删除' }[store.selected?.status] || store.selected?.status))
const statusTone = computed(() => ({ active: 'active', disabled: 'warning', deleted: 'gone' }[store.selected?.status] || 'warning'))
const planLabel = computed(() => ({ free: '免费版', professional: '专业版', enterprise: '企业版' }[store.selected?.planType] || store.selected?.planType))

function closeDetailInteractions() {
  cancelEditRefresh(); if (editToken.value && editStore.owns(editToken.value)) editStore.close(editToken.value)
  cancelStatusRefresh(); if (statusToken.value && statusStore.owns(statusToken.value)) statusStore.close(statusToken.value)
  cancelDeleteRefresh(); if (deleteToken && actionStore.owns(deleteToken)) actionStore.close(deleteToken)
  closeEntitlementInteractions()
  closeRolePermissionInteraction()
}
function load() {
  const guid = route.params.guid
  if (!canRead.value || !/^[1-9]\d{0,18}$/.test(guid) || (guid.length === 19 && guid > '9223372036854775807')) {
    detailLoadFlight.cancel()
    closeDetailInteractions()
    store.clear()
    return Promise.resolve(false)
  }
  const identityEpoch = userStore.identityEpoch
  const permissionVersion = userStore.permissionRevision
  return detailLoadFlight.run({ guid, identityEpoch, permissionVersion, load: async () => {
    closeDetailInteractions()
    const detail = await store.loadDetail(guid, { isRoot: userStore.user?.role === 'root' })
    const intended = detail?.status === 'active' ? 'disabled' : detail?.status === 'disabled' ? 'active' : null
    if (statusInvalidatedGuid.value === guid && canOpenAdminUserStatus({ actorRole:userStore.user?.role, actorGuid:userStore.user?.guid,
      capabilities:userStore.permissionProjection?.capabilities, target:detail, status:intended })) statusInvalidatedGuid.value = null
    return detail?.guid === guid
  } })
}
function retryDetail() {
  void load().catch(() => {})
}

async function retryIdentity() {
  try { await userStore.fetchSelf() } catch {}
}

let deleteTrigger = null
const pageHeading = ref(null)
let deleteToken = null
let deleteRefreshRequest = 0
let deleteRefreshAbort = null
function cancelDeleteRefresh() { deleteRefreshRequest++; deleteRefreshAbort?.abort(); deleteRefreshAbort = null }
function openDelete(target, event) {
  closeRolePermissionInteraction()
  closeEntitlementInteractions()
  cancelStatusRefresh()
  if (statusToken.value && statusStore.owns(statusToken.value)) statusStore.close(statusToken.value)
  cancelEditRefresh()
  if (editToken.value && editStore.owns(editToken.value)) editStore.close(editToken.value)
  deleteTrigger = event?.currentTarget ?? document.activeElement
  deleteToken = actionStore.open(target, { onSucceeded: onDeleteSucceeded, onConflict: onDeleteConflict, onUnauthorized })
}

let statusTrigger = null
const statusToken = ref(null)
const statusAnnouncement = ref('')
let statusContext = null
let statusRefreshRequest = 0
let statusRefreshAbort = null
let statusConflictFlight = null
function cancelStatusRefresh() { statusRefreshRequest++; statusRefreshAbort?.abort(); statusRefreshAbort = null; statusConflictFlight = null }
function statusBaseCurrent(token, captured = statusContext) {
  return Boolean(captured && token === statusToken.value && statusStore.owns(token) && route.params.guid === captured.targetGuid
    && userStore.identityEpoch === captured.identityEpoch && userStore.permissionRevision === captured.permissionVersion)
}
function openStatus(target, event) {
  closeRolePermissionInteraction()
  closeEntitlementInteractions()
  const intendedStatus = target.status === 'active' ? 'disabled' : target.status === 'disabled' ? 'active' : null
  cancelStatusRefresh(); cancelEditRefresh(); cancelDeleteRefresh()
  if (editToken.value && editStore.owns(editToken.value)) editStore.close(editToken.value)
  if (deleteToken && actionStore.owns(deleteToken)) actionStore.close(deleteToken)
  statusTrigger = event?.currentTarget ?? document.activeElement; statusAnnouncement.value = ''
  const context = Object.freeze({ targetGuid:target.guid, authVersion:target.authVersion, targetStatus:target.status, intendedStatus,
    identityEpoch:userStore.identityEpoch, permissionVersion:userStore.permissionRevision })
  const token = statusStore.open({ actorRole:userStore.user?.role, actorGuid:userStore.user?.guid, capabilities:userStore.permissionProjection?.capabilities,
    target, status:intendedStatus, routeGuid:route.params.guid, identityEpoch:context.identityEpoch, permissionVersion:context.permissionVersion })
  if (!token) return false
  statusToken.value = token; statusContext = context; return true
}
function onStatusSucceeded(user, token) {
  const captured = statusContext
  if (!statusBaseCurrent(token, captured) || store.selected?.guid !== captured.targetGuid || store.selected.status !== captured.targetStatus
      || store.selected.authVersion !== captured.authVersion || user?.guid !== captured.targetGuid || user.status !== captured.intendedStatus || user.authVersion !== captured.authVersion + 1) return false
  store.selected = user
  if (Array.isArray(store.rows)) store.rows = store.rows.map(row => row?.guid === captured.targetGuid && row.status === captured.targetStatus && row.authVersion === captured.authVersion ? user : row)
  statusAnnouncement.value = `${user.username || user.guid} 已${user.status === 'disabled' ? '禁用' : '启用'}`
  return true
}
function onStatusConflict(token) {
  const captured = statusContext
  if (!statusBaseCurrent(token, captured)) return false
  if (statusConflictFlight?.token === token && statusConflictFlight.context === captured) return statusConflictFlight.promise
  const requestId = ++statusRefreshRequest
  statusRefreshAbort?.abort(); const controller = new AbortController(); statusRefreshAbort = controller
  let flight
  flight = (async () => {
    let fresh = null; let freshApplied = false; let refreshError = null
    try {
      const refreshed = await statusStore.refreshConflict(token, async guid => {
        try {
          fresh = await getAdminUser(guid, { signal:controller.signal })
          return fresh
        } catch (error) { refreshError = error; throw error }
      }, () => {
        const responseCurrent = requestId === statusRefreshRequest && statusContext === captured && statusBaseCurrent(token, captured) && statusStore.isOpen
        if (fresh && responseCurrent && store.selected?.guid === captured.targetGuid && store.selected.authVersion === captured.authVersion) {
          store.selected = fresh
          if (Array.isArray(store.rows)) store.rows = store.rows.map(row => row?.guid === captured.targetGuid && row.authVersion === captured.authVersion ? fresh : row)
          freshApplied = true
        }
      })
      const contextCurrent = requestId === statusRefreshRequest && statusContext === captured && statusBaseCurrent(token, captured) && statusStore.isOpen
      if (freshApplied && refreshed && contextCurrent) statusContext = Object.freeze({ ...captured, authVersion:fresh.authVersion, targetStatus:fresh.status })
      if (refreshError?.response?.status === 401 && contextCurrent) return onStatusFailed('authentication_failed', token)
      if (!refreshed && contextCurrent && statusStore.owns(token)) statusStore.close(token)
      if (contextCurrent) statusAnnouncement.value = refreshed ? '用户信息已刷新，请重新确认操作。' : '用户状态已变化，操作已关闭。'
      return refreshed
    } finally {
      if (requestId === statusRefreshRequest && statusRefreshAbort === controller) statusRefreshAbort = null
      if (statusConflictFlight?.promise === flight) statusConflictFlight = null
    }
  })()
  statusConflictFlight = { token, context:captured, promise:flight }
  return flight
}
function onStatusFailed(code, token) {
  if (!statusBaseCurrent(token)) return false
  if (code === 'authentication_failed') { statusStore.close(token); userStore.clearSession(); store.clear(); return true }
  if (['forbidden','not_found'].includes(code)) {
    const captured = statusContext; statusInvalidatedGuid.value = captured.targetGuid; statusStore.close(token)
    void (async () => {
      if (code === 'forbidden') { try { await userStore.fetchSelf() } catch { return } }
      if (route.params.guid !== captured.targetGuid) return
      try { await load() } catch { return }
      const intended = store.selected?.status === 'active' ? 'disabled' : store.selected?.status === 'disabled' ? 'active' : null
      if (canOpenAdminUserStatus({ actorRole:userStore.user?.role, actorGuid:userStore.user?.guid, capabilities:userStore.permissionProjection?.capabilities, target:store.selected, status:intended })) statusInvalidatedGuid.value = null
    })()
    return true
  }
  return ['unavailable','request_too_large','request_failed'].includes(code)
}
function restoreStatusFocus(token) {
  if (!token || token !== statusToken.value || statusStore.owns(token)) return false
  const trigger = statusTrigger; statusTrigger = null; statusToken.value = null; statusContext = null
  nextTick(() => { if (statusToken.value) return; (trigger?.isConnected ? trigger : pageHeading.value?.$el ?? pageHeading.value)?.focus?.() })
  return true
}

let editTrigger = null
const editToken = ref(null)
const editAnnouncement = ref('')
let editContext = null
let editRefreshRequest = 0
let editRefreshAbort = null
let editPermissionRefreshRequest = 0
const editConflictFlight = createAdminUserEditConflictSingleflight()
function cancelEditRefresh() { editRefreshRequest++; editRefreshAbort?.abort(); editRefreshAbort = null; editConflictFlight.cancel() }
function editBaseCurrent(token, captured = editContext) {
  return Boolean(captured && token === editToken.value && editStore.owns(token) && route.params.guid === captured.targetGuid
    && userStore.identityEpoch === captured.identityEpoch && userStore.permissionRevision === captured.permissionVersion)
}
function openEdit(target, event) {
  closeRolePermissionInteraction()
  closeEntitlementInteractions()
  cancelStatusRefresh()
  if (statusToken.value && statusStore.owns(statusToken.value)) statusStore.close(statusToken.value)
  cancelEditRefresh()
  editPermissionRefreshRequest++
  cancelDeleteRefresh()
  if (deleteToken && actionStore.owns(deleteToken)) actionStore.close(deleteToken)
  editTrigger = event?.currentTarget ?? document.activeElement
  editAnnouncement.value = ''
  const context = Object.freeze({ targetGuid: target.guid, authVersion: target.authVersion, identityEpoch: userStore.identityEpoch, permissionVersion: userStore.permissionRevision })
  const token = editStore.open({ actorRole: userStore.user?.role, actorGuid: userStore.user?.guid, capabilities: userStore.permissionProjection?.capabilities,
    target, routeGuid: route.params.guid, identityEpoch: context.identityEpoch, permissionVersion: context.permissionVersion })
  if (!token) return false
  editToken.value = token
  editContext = context
  return true
}
function onEditSucceeded(user, token) {
  const captured = editContext
  const applied = reconcileAdminUserEditSuccess({ state: store, user, targetGuid: captured?.targetGuid, expectedAuthVersion: captured?.authVersion,
    isCurrent: () => editBaseCurrent(token, captured) })
  if (applied) editAnnouncement.value = t('editUser.success', { username: user.username || user.guid })
  return applied
}
function onEditConflict(token) {
  const captured = editContext
  return editConflictFlight.run({ token, context: captured, isCurrent: editBaseCurrent, execute: async flightCurrent => {
    const requestId = ++editRefreshRequest
    editRefreshAbort?.abort()
    const controller = new AbortController()
    editRefreshAbort = controller
    editAnnouncement.value = t('editUser.conflictRefreshing')
    try {
      let fresh = null
      let refreshError = null
      const isCurrent = () => flightCurrent() && requestId === editRefreshRequest && store.selected?.guid === captured.targetGuid && store.selected.authVersion === captured.authVersion
      const refreshed = await editStore.refreshConflict(token, async guid => {
        try { fresh = await getAdminUser(guid, { signal: controller.signal }); return fresh } catch (error) { refreshError = error; throw error }
      })
      if (!refreshed || !fresh || !isCurrent()) {
        if (isCurrent() && refreshError?.response?.status === 401) onEditFailed('authentication_failed', token)
        else if (isCurrent() && editStore.owns(token)) { editInvalidatedGuid.value = captured.targetGuid; editStore.close(token); ElMessage.warning(t('editUser.failures.request_failed')) }
        return false
      }
      editContext = Object.freeze({ ...captured, authVersion: fresh.authVersion })
      const applied = reconcileAdminUserEditRefresh({ state: store, target: fresh, targetGuid: captured.targetGuid,
        isCurrent: () => flightCurrent() && requestId === editRefreshRequest && editBaseCurrent(token, editContext) })
      if (!applied && flightCurrent() && editStore.owns(token)) { editInvalidatedGuid.value = captured.targetGuid; editStore.close(token) }
      return applied
    } finally { if (requestId === editRefreshRequest && editRefreshAbort === controller) editRefreshAbort = null }
  } })
}
function onEditFailed(code, token) {
  if (!editBaseCurrent(token)) return false
  if (code === 'authentication_failed') {
    editStore.close(token)
    userStore.clearSession()
    store.clear()
    return true
  }
  if (['forbidden', 'not_found'].includes(code)) {
    const captured = editContext
    const requestId = ++editPermissionRefreshRequest
    editInvalidatedGuid.value = captured.targetGuid
    editStore.close(token)
    if (code === 'not_found') void load().catch(() => {})
    else void recoverAdminUserEditForbidden({
      refreshIdentity: () => userStore.fetchSelf(),
      refreshTarget: async () => await load() ? store.selected : null,
      isCurrent: () => requestId === editPermissionRefreshRequest && route.params.guid === captured.targetGuid && editInvalidatedGuid.value === captured.targetGuid,
      canRestore: target => canOpenAdminUserEdit({ actorRole: userStore.user?.role, actorGuid: userStore.user?.guid,
        capabilities: userStore.permissionProjection?.capabilities, target }),
      restore: () => { editInvalidatedGuid.value = null },
    })
    return true
  }
  return code === 'unavailable' || code === 'request_failed'
}
function restoreEditFocus(token) {
  if (!token || token !== editToken.value || editStore.owns(token)) return false
  const trigger = editTrigger
  editTrigger = null
  editToken.value = null
  editContext = null
  nextTick(() => {
    if (editToken.value) return
    const destination = trigger?.isConnected ? trigger : pageHeading.value?.$el ?? pageHeading.value
    destination?.focus?.()
  })
  return true
}
function onDeleteSucceeded({ guid }, token) {
  if (!actionStore.owns(token) || route.params.guid !== guid || store.selected?.guid !== guid) return false
  return reconcileDeletedDetail({ state: store, guid })
}
async function onDeleteConflict(guid, token) {
  const requestId = ++deleteRefreshRequest
  deleteRefreshAbort?.abort()
  deleteRefreshAbort = new AbortController()
  const routeGuid = route.params.guid
  const selectedGuid = store.selected?.guid
  const isContextCurrent = () => requestId === deleteRefreshRequest && route.params.guid === routeGuid && routeGuid === guid
    && store.selected?.guid === selectedGuid && selectedGuid === guid && actionStore.owns(token)
  try { return await refreshDeleteTargetFailClosed({
    guid, token, loadTarget: targetGuid => getAdminUser(targetGuid, { signal: deleteRefreshAbort.signal }), isContextCurrent,
    canManage: target => canDeleteAdminUser({ actorRole: userStore.user?.role, capabilities: userStore.permissionProjection?.capabilities, target }),
    replaceTarget: (owner, target) => {
      if (!isContextCurrent() || !actionStore.updateTarget(owner, target)) return false
      if (!isContextCurrent()) return false
      store.selected = target
      return true
    }, invalidateTarget: actionStore.invalidateTarget,
    onUnauthorized, onUnavailable: () => ElMessage.warning(t('deleteUser.targetRefreshFailed')),
  }) } finally { if (requestId === deleteRefreshRequest) deleteRefreshAbort = null }
}
function onUnauthorized() { userStore.clearSession(); store.clear() }
function restoreDeleteFocus() {
  const token = deleteToken
  const trigger = deleteTrigger
  deleteTrigger = null
  if (!token) return
  restoreDeleteTriggerFocus({ token, canRestore: owner => deleteToken === owner && !actionStore.captureOwnership(), trigger, fallback: pageHeading.value, nextTick })
}

const entitlementAnnouncement = ref('')
const passwordResetToken = ref(null); const groupChangeToken = ref(null); const planChangeToken = ref(null)
const entitlementTokens = { password:passwordResetToken, group:groupChangeToken, plan:planChangeToken }
const entitlementStores = { password:passwordResetStore, group:groupChangeStore, plan:planChangeStore }
const entitlementPredicates = { password:canOpenPasswordReset, group:canOpenGroupChange, plan:canOpenPlanChange }
const entitlementContexts = { password:null, group:null, plan:null }
const entitlementTriggers = { password:null, group:null, plan:null }
let entitlementConflictFlight = null
function closeEntitlementInteractions(except=null) {
  if (entitlementConflictFlight?.kind !== except) entitlementConflictFlight = null
  for (const kind of ['password','group','plan']) {
    if (kind === except) continue
    const token = entitlementTokens[kind].value
    if (token && entitlementStores[kind].owns(token)) entitlementStores[kind].close(token)
  }
}
function openEntitlement(kind,target,event) {
  closeRolePermissionInteraction()
  cancelStatusRefresh(); cancelEditRefresh(); cancelDeleteRefresh()
  entitlementConflictFlight = null
  if (statusToken.value && statusStore.owns(statusToken.value)) statusStore.close(statusToken.value)
  if (editToken.value && editStore.owns(editToken.value)) editStore.close(editToken.value)
  if (deleteToken && actionStore.owns(deleteToken)) actionStore.close(deleteToken)
  closeEntitlementInteractions(kind)
  entitlementTriggers[kind] = event?.currentTarget ?? document.activeElement
  entitlementAnnouncement.value = ''
  const context = Object.freeze({ targetGuid:target.guid, authVersion:target.authVersion, identityEpoch:userStore.identityEpoch, permissionVersion:userStore.permissionRevision })
  const token = entitlementStores[kind].open({ actorRole:userStore.user?.role, actorGuid:userStore.user?.guid, capabilities:userStore.permissionProjection?.capabilities,
    target, routeGuid:route.params.guid, identityEpoch:context.identityEpoch, permissionVersion:context.permissionVersion })
  if (!token) return false
  entitlementTokens[kind].value=token; entitlementContexts[kind]=context; return true
}
const openPasswordReset=(target,event)=>openEntitlement('password',target,event)
const openGroupChange=(target,event)=>openEntitlement('group',target,event)
const openPlanChange=(target,event)=>openEntitlement('plan',target,event)
function entitlementCurrent(kind,token=entitlementTokens[kind].value,captured=entitlementContexts[kind]) {
  return Boolean(token && captured && token===entitlementTokens[kind].value && entitlementStores[kind].owns(token) && route.params.guid===captured.targetGuid
    && userStore.identityEpoch===captured.identityEpoch && userStore.permissionRevision===captured.permissionVersion)
}
function applyEntitlementUser(kind,user,token,captured=entitlementContexts[kind]) {
  if (!entitlementCurrent(kind,token,captured) || !user || user.guid!==captured.targetGuid || user.authVersion!==captured.authVersion+1
      || store.selected?.guid!==captured.targetGuid || store.selected.authVersion!==captured.authVersion) return false
  store.selected=user
  if(Array.isArray(store.rows))store.rows=store.rows.map(row=>row?.guid===captured.targetGuid&&row.authVersion===captured.authVersion?user:row)
  entitlementAnnouncement.value=`${user.username||user.guid} 的${kind==='group'?'分组':kind==='plan'?'套餐':'密码'}已更新`
  return true
}
function onDirectEntitlementSucceeded(kind,user,token){return applyEntitlementUser(kind,user,token)}
async function onPasswordResetSucceeded(result,token){
  const captured=entitlementContexts.password
  if(!entitlementCurrent('password',token,captured)||result?.targetGuid!==captured.targetGuid||result.resultingAuthVersion!==captured.authVersion+1)return false
  let fresh;try{fresh=await getAdminUser(captured.targetGuid)}catch{if(passwordResetStore.owns(token))passwordResetStore.close(token);ElMessage.warning('密码已重置，用户详情刷新失败，请手动重试。');return false}
  const applied=applyEntitlementUser('password',fresh,token,captured)&&fresh.authVersion===result.resultingAuthVersion
  if(passwordResetStore.owns(token))passwordResetStore.close(token)
  return applied
}
function refreshEntitlementConflict(kind){
  const token=entitlementTokens[kind].value,captured=entitlementContexts[kind]
  if(!entitlementCurrent(kind,token,captured))return Promise.resolve(false)
  if(entitlementConflictFlight?.kind===kind&&entitlementConflictFlight.token===token&&entitlementConflictFlight.context===captured)return entitlementConflictFlight.promise
  const flight={kind,token,context:captured,promise:null};entitlementConflictFlight=flight
  flight.promise=(async()=>{let fresh
    const refreshed=await entitlementStores[kind].refreshConflict(token,async guid=>{fresh=await getAdminUser(guid);return fresh})
    if(entitlementConflictFlight!==flight||!refreshed||!fresh||!entitlementCurrent(kind,token,captured)){if(entitlementStores[kind].owns(token))entitlementStores[kind].close(token);return false}
    if(store.selected?.guid===captured.targetGuid&&store.selected.authVersion===captured.authVersion){store.selected=fresh;if(Array.isArray(store.rows))store.rows=store.rows.map(row=>row?.guid===captured.targetGuid&&row.authVersion===captured.authVersion?fresh:row)}
    entitlementContexts[kind]=Object.freeze({...captured,authVersion:fresh.authVersion});return true
  })().finally(()=>{if(entitlementConflictFlight===flight)entitlementConflictFlight=null})
  return flight.promise
}
function onEntitlementFailed(kind,code){
  const token=entitlementTokens[kind].value;if(!entitlementCurrent(kind,token))return false
  if(code==='authentication_failed'){entitlementStores[kind].close(token);userStore.clearSession();store.clear();return true}
  if(code==='user_entitlement_forbidden'||code==='action_verification_rejected'||code==='action_operation_rejected'){entitlementStores[kind].close(token);void userStore.fetchSelf().then(()=>load()).catch(()=>{});return true}
  if(code==='user_not_found'||code==='group_not_found'||code==='action_target_not_found'){entitlementStores[kind].close(token);void load().catch(()=>{});return true}
  return true
}
function anotherEntitlementOwns(kind){return ['password','group','plan'].some(other=>other!==kind&&entitlementTokens[other].value&&entitlementStores[other].owns(entitlementTokens[other].value))}
function restoreEntitlementFocus(kind,token){
  if(!token||token!==entitlementTokens[kind].value||entitlementStores[kind].owns(token))return false
  const trigger=entitlementTriggers[kind];entitlementTriggers[kind]=null;entitlementTokens[kind].value=null;entitlementContexts[kind]=null
  nextTick(()=>{if(!entitlementTokens[kind].value&&!anotherEntitlementOwns(kind))(trigger?.isConnected?trigger:pageHeading.value?.$el??pageHeading.value)?.focus?.()});return true
}

const rolePermissionToken = ref(null)
const rolePermissionAnnouncement = ref('')
let rolePermissionContext = null
let rolePermissionTrigger = null
let rolePermissionRefresh = null
let rolePermissionRequest = 0
let rolePermissionConflictUsed = false
function cancelRolePermissionRefresh() {
  rolePermissionRequest++
  rolePermissionRefresh?.controller.abort()
  rolePermissionRefresh = null
}
function closeRolePermissionInteraction() {
  cancelRolePermissionRefresh()
  const token = rolePermissionToken.value
  if (token && rolePermissionStore.owns(token)) rolePermissionStore.close(token)
  rolePermissionToken.value = null
  rolePermissionContext = null
  rolePermissionTrigger = null
  rolePermissionConflictUsed = false
}
function rolePermissionVersion(target) {
  if (target?.role === 'user') return 0
  const version = Number(store.permissions?.permissions_version)
  return Number.isSafeInteger(version) && version >= 1 ? version : null
}
function rolePermissionCurrent(token, captured = rolePermissionContext, requireOwner = true) {
  if (!token || !captured || token !== rolePermissionToken.value || (requireOwner && !rolePermissionStore.owns(token))) return false
  return route.params.guid === captured.targetGuid && userStore.identityEpoch === captured.identityEpoch
    && userStore.permissionRevision === captured.capabilityRevision && store.selected?.guid === captured.targetGuid
    && store.selected.role === captured.targetRole && store.selected.status === captured.targetStatus
    && store.selected.authVersion === captured.authVersion && rolePermissionVersion(store.selected) === captured.permissionsVersion
    && store.catalog?.catalog_version === captured.catalogVersion
}
function openRolePermission(scope, target, event) {
  const predicate = scope === 'users.promote' ? canOpenPromote : scope === 'users.demote' ? canOpenDemote : canOpenPermissions
  const input = { ...rolePermissionInput.value, target }
  if (!predicate(input)) return false
  const permissionsVersion = rolePermissionVersion(target)
  const catalogVersion = store.catalog?.catalog_version
  if (!Number.isSafeInteger(permissionsVersion) || !Number.isInteger(catalogVersion) || catalogVersion < 1) return false
  closeDetailInteractions()
  rolePermissionTrigger = event?.currentTarget ?? document.activeElement
  rolePermissionAnnouncement.value = ''
  rolePermissionConflictUsed = false
  const context = Object.freeze({
    targetGuid:target.guid, targetRole:target.role, targetStatus:target.status, authVersion:target.authVersion,
    permissionsVersion, catalogVersion, identityEpoch:userStore.identityEpoch, capabilityRevision:userStore.permissionRevision,
    resultingRole:scope === 'users.demote' ? 'user' : 'admin', scope,
  })
  const open = scope === 'users.promote' ? rolePermissionStore.openPromote : scope === 'users.demote' ? rolePermissionStore.openDemote : rolePermissionStore.openPermissions
  const token = open.call(rolePermissionStore, {
    target, routeGuid:route.params.guid, identityEpoch:context.identityEpoch, capabilityRevision:context.capabilityRevision,
    permissionsVersion, catalogVersion,
  })
  if (!token) return false
  rolePermissionToken.value = token
  rolePermissionContext = context
  return true
}
function onRolePermissionSucceeded(result, token) {
  const captured = rolePermissionContext
  if (!rolePermissionCurrent(token, captured) || result?.targetGuid !== captured.targetGuid || result.resultingRole !== captured.resultingRole
      || result.resultingAuthVersion !== captured.authVersion + 1 || result.resultingPermissionsVersion !== captured.permissionsVersion + 1) return false
  const requestId = ++rolePermissionRequest
  const controller = new AbortController()
  const receipt = { token, context:captured, controller, promise:null }
  rolePermissionRefresh = receipt
  const isCurrent = () => rolePermissionRefresh === receipt && requestId === rolePermissionRequest && rolePermissionCurrent(token, captured, false)
  receipt.promise = store.refreshRolePermissionTarget(captured.targetGuid, { signal:controller.signal }).then(fresh => {
    const applied = reconcileRolePermissionSuccess({ state:store, context:captured, result, fresh, isCurrent })
    if (applied) rolePermissionAnnouncement.value = captured.scope === 'users.promote' ? '用户已提升为管理员。' : captured.scope === 'users.demote' ? '管理员已降级为普通用户。' : '管理员权限已更新。'
    return applied
  }).catch(error => {
    if (isCurrent() && error?.response?.status === 401) { userStore.clearSession(); store.clear() }
    else if (isCurrent()) rolePermissionAnnouncement.value = '操作已完成，但用户详情刷新失败，请手动重试。'
    return false
  }).finally(() => {
    if (rolePermissionRefresh === receipt) {
      rolePermissionRefresh = null
      if (!rolePermissionStore.owns(token)) restoreRolePermissionFocus(token)
    }
  })
  return receipt.promise
}
function applyRolePermissionConflictFresh(fresh, token, captured, current) {
  if (!current() || !fresh?.target || fresh.target.guid !== captured.targetGuid || !['user','admin'].includes(fresh.target.role)
      || !['active','disabled'].includes(fresh.target.status) || !Number.isInteger(fresh.target.authVersion)) return false
  if (fresh.target.role === 'admin') {
    if (!fresh.permissions || fresh.permissions.user_guid !== captured.targetGuid || fresh.permissions.role !== 'admin') return false
  } else if (fresh.permissions !== null) return false
  store.selected = fresh.target
  if (Array.isArray(store.rows)) store.rows = store.rows.map(row => row?.guid === captured.targetGuid && row.role === captured.targetRole && row.authVersion === captured.authVersion ? fresh.target : row)
  store.permissions = fresh.permissions
  return true
}
function onRolePermissionConflict(token) {
  const captured = rolePermissionContext
  if (!rolePermissionCurrent(token, captured)) return Promise.resolve(false)
  if (rolePermissionRefresh?.token === token && rolePermissionRefresh.context === captured) return rolePermissionRefresh.promise
  if (rolePermissionConflictUsed) return Promise.resolve(false)
  rolePermissionConflictUsed = true
  const requestId = ++rolePermissionRequest
  const controller = new AbortController()
  const receipt = { token, context:captured, controller, promise:null }
  rolePermissionRefresh = receipt
  const current = () => rolePermissionRefresh === receipt && requestId === rolePermissionRequest && rolePermissionCurrent(token, captured)
  receipt.promise = store.refreshRolePermissionTarget(captured.targetGuid, { signal:controller.signal }).then(fresh => {
    const ownedBeforeApply = current()
    const applied = applyRolePermissionConflictFresh(fresh, token, captured, current)
    if (ownedBeforeApply && rolePermissionStore.owns(token)) rolePermissionStore.close(token)
    if (applied) rolePermissionAnnouncement.value = '用户状态已刷新，请重新发起操作。'
    return applied
  }).catch(error => {
    if (current() && error?.response?.status === 401) onRolePermissionFailed('authentication_failed', token)
    else if (current() && rolePermissionStore.owns(token)) rolePermissionStore.close(token)
    return false
  }).finally(() => { if (rolePermissionRefresh === receipt) rolePermissionRefresh = null })
  return receipt.promise
}
function onRolePermissionFailed(code, token) {
  if (!rolePermissionCurrent(token)) return false
  if (code === 'authentication_failed') {
    rolePermissionStore.close(token); cancelRolePermissionRefresh(); userStore.clearSession(); store.clear(); return true
  }
  if (['forbidden','not_found','action_target_not_found','action_operation_rejected'].includes(code)) {
    rolePermissionStore.close(token); cancelRolePermissionRefresh(); void load().catch(() => {}); return true
  }
  return true
}
function restoreRolePermissionFocus(token) {
  if (!token || token !== rolePermissionToken.value || rolePermissionStore.owns(token)) return false
  if (rolePermissionRefresh?.token === token) return true
  const trigger = rolePermissionTrigger
  rolePermissionTrigger = null
  rolePermissionToken.value = null
  rolePermissionContext = null
  nextTick(() => { if (!rolePermissionToken.value) (trigger?.isConnected ? trigger : pageHeading.value?.$el ?? pageHeading.value)?.focus?.() })
  return true
}

onMounted(() => { void load().catch(() => {}) })
watch(() => route.params.guid, () => { editPermissionRefreshRequest++ })
watch([() => route.params.guid, canRead, () => userStore.identityEpoch, () => userStore.permissionRevision], () => { void load().catch(() => {}) })
watch(() => store.selected, target => {
  if (editToken.value && editStore.owns(editToken.value)) editStore.updateContext(editToken.value, { target })
  if (statusToken.value && statusStore.owns(statusToken.value)) statusStore.updateContext(statusToken.value, { target })
  for(const kind of ['password','group','plan']){const token=entitlementTokens[kind].value;if(token&&entitlementStores[kind].owns(token))entitlementStores[kind].updateContext(token,{target})}
  if (rolePermissionToken.value && rolePermissionStore.owns(rolePermissionToken.value)) rolePermissionStore.updateContext(rolePermissionToken.value, {
    target, routeGuid:route.params.guid, identityEpoch:userStore.identityEpoch, capabilityRevision:userStore.permissionRevision,
    permissionsVersion:rolePermissionVersion(target), catalogVersion:store.catalog?.catalog_version,
  })
})
watch(() => statusStore.isOpen, (open, previous) => { if (!open && previous) cancelStatusRefresh() })
onBeforeUnmount(() => {
  cancelEditRefresh(); editPermissionRefreshRequest++; if (editToken.value) editStore.dispose(editToken.value); editToken.value = null; editTrigger = null; editContext = null
  cancelStatusRefresh(); if (statusToken.value) statusStore.dispose(statusToken.value); statusToken.value = null; statusTrigger = null; statusContext = null
  cancelDeleteRefresh(); if (deleteToken) actionStore.dispose(deleteToken); deleteToken = null; deleteTrigger = null
  closeEntitlementInteractions(); for(const kind of ['password','group','plan']){entitlementTokens[kind].value=null;entitlementContexts[kind]=null;entitlementTriggers[kind]=null}
  cancelRolePermissionRefresh(); if (rolePermissionToken.value) rolePermissionStore.dispose(rolePermissionToken.value); rolePermissionToken.value=null; rolePermissionContext=null; rolePermissionTrigger=null
})
</script>

<style scoped>
.admin-page { max-width: 1100px; overflow: auto; }
.detail-surface { overflow: hidden; }
.title { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 20px; font-weight: 600; }
.title-name { min-width: 0; overflow-wrap: anywhere; }
.title-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.title-actions :deep(.el-button + .el-button) { margin-left: 0; }
.nickname-row { display: inline-flex; align-items: center; gap: 8px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.permissions { margin-top: 20px; }
.responsive-table { width: 100%; overflow-x: auto; }
@media (max-width: 768px) { .title { align-items: flex-start; } .title-actions { width: 100%; justify-content: flex-start; } .detail-action-toolbar :deep(.el-button) { flex: 1 1 auto; } .detail-surface :deep(.el-descriptions__body) { overflow-x: auto; } }
</style>
