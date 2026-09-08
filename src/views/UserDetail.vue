<template>
  <section class="admin-page">
    <el-page-header ref="pageHeading" content="用户详情" tabindex="-1" @back="$router.push('/users')" />

    <el-alert v-if="!canRead" type="warning" :closable="false" title="暂无用户管理权限" description="权限信息不可用时不会加载用户详情。">
      <template #default><el-button link type="primary" @click="retryIdentity">重新检查身份</el-button></template>
    </el-alert>
    <el-alert v-else-if="store.detailError" type="error" show-icon :closable="false" :title="detailErrorTitle" :description="detailErrorDescription">
      <template #default><el-button link type="primary" @click="load">重试</el-button></template>
    </el-alert>
    <el-skeleton v-else-if="store.detailLoading" :rows="6" animated />

    <template v-else-if="store.selected">
      <el-card shadow="never">
        <template #header>
          <div class="title"><span>{{ store.selected.username || '未设置用户名' }}</span><span><el-tag>{{ statusLabel }}</el-tag><el-button v-if="canDeleteTarget" type="danger" plain @click="openDelete(store.selected, $event)">{{ t('deleteUser.confirm') }}</el-button></span></div>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="GUID">{{ store.selected.guid }}</el-descriptions-item>
          <el-descriptions-item label="昵称">
            <span class="nickname-row"><span>{{ store.selected.nickname || '未设置' }}</span><el-button v-if="canEditTarget" link type="primary" @click="openEdit(store.selected, $event)">{{ t('editUser.open') }}</el-button></span>
          </el-descriptions-item>
          <el-descriptions-item label="角色">{{ store.selected.role === 'admin' ? '管理员' : '用户' }}</el-descriptions-item>
          <el-descriptions-item label="套餐">{{ planLabel }}</el-descriptions-item>
          <el-descriptions-item label="邮箱">未设置</el-descriptions-item>
          <el-descriptions-item label="分组">{{ store.selected.group }}</el-descriptions-item>
          <el-descriptions-item label="金额额度">未接入</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ store.selected.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="最近登录">{{ store.selected.lastLoginAt || '从未登录' }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card v-if="showPermissions" shadow="never" class="permissions">
        <template #header>权限信息</template>
        <el-alert v-if="permissionUnavailable" type="warning" :closable="false" title="权限信息暂不可用" description="请重新检查身份后重试。">
          <template #default><el-button link type="primary" @click="retryIdentity">重新检查身份</el-button></template>
        </el-alert>
        <el-table v-else :data="permissionRows">
          <el-table-column prop="name" label="能力" />
          <el-table-column prop="baseline" label="基线" />
          <el-table-column prop="override" label="覆盖" />
          <el-table-column prop="policy_effective" label="策略结果" />
          <el-table-column prop="effective" label="当前有效" />
        </el-table>
      </el-card>
    </template>
    <p class="sr-only" role="status" aria-live="polite">{{ editAnnouncement }}</p>
    <UserNicknameEditDialog :owner="editToken" @succeeded="onEditSucceeded" @conflict="onEditConflict" @failed="onEditFailed" @closed="restoreEditFocus" />
    <UserSoftDeleteDialog @closed="restoreDeleteFocus" />
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
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useAdminUsersStore } from '@/stores/admin-users'
import { useAdminUserActionsStore, canDeleteAdminUser, reconcileDeletedDetail, refreshDeleteTargetFailClosed, restoreDeleteTriggerFocus } from '@/stores/admin-user-actions'
import { useAdminUserEditStore, canOpenAdminUserEdit } from '@/stores/admin-user-edit'
import { getAdminUser } from '@/api/admin-users'
import UserSoftDeleteDialog from '@/components/admin/UserSoftDeleteDialog.vue'
import UserNicknameEditDialog from '@/components/admin/UserNicknameEditDialog.vue'
import { useI18n } from '@/composables/useI18n'
import { ElMessage } from 'element-plus'

const route = useRoute()
const userStore = useUserStore()
const store = useAdminUsersStore()
const actionStore = useAdminUserActionsStore()
const editStore = useAdminUserEditStore()
const { t } = useI18n()
const canRead = computed(() => userStore.permissionProjection?.capabilities?.includes('users.read') === true)
const deleteCapability = 'users.delete'
const canDeleteTarget = computed(() => userStore.permissionProjection?.capabilities?.includes(deleteCapability) === true
  && canDeleteAdminUser({ actorRole: userStore.user?.role, capabilities: userStore.permissionProjection.capabilities, target: store.selected }))
const editInvalidatedGuid = ref(null)
const canEditTarget = computed(() => editInvalidatedGuid.value !== store.selected?.guid && canOpenAdminUserEdit({ actorRole: userStore.user?.role, actorGuid: userStore.user?.guid,
  capabilities: userStore.permissionProjection?.capabilities, target: store.selected }))
const showPermissions = computed(() => canRead.value && store.selected?.status !== 'deleted' && store.selected?.role === 'admin' && userStore.user?.role === 'root')
const permissionUnavailable = computed(() => showPermissions.value && !store.permissions)
const permissionRows = computed(() => store.permissions?.capabilities || [])
const detailStatus = computed(() => store.detailError?.response?.status)
const detailErrorTitle = computed(() => ({ 401: '认证会话无效', 403: '无权限访问', 404: '用户不存在', 503: '用户信息暂不可用' }[detailStatus.value] || '用户信息暂不可用'))
const detailErrorDescription = computed(() => detailStatus.value === 403 ? '当前身份保持登录状态，可重新检查权限。' : '当前详情数据已清理，请重试或返回用户列表。')
const statusLabel = computed(() => ({ active: '启用', disabled: '禁用', deleted: '已删除' }[store.selected?.status] || store.selected?.status))
const planLabel = computed(() => ({ free: '免费版', professional: '专业版', enterprise: '企业版' }[store.selected?.planType] || store.selected?.planType))

async function load() {
  cancelEditRefresh()
  if (editToken.value && editStore.owns(editToken.value)) editStore.close(editToken.value)
  cancelDeleteRefresh()
  if (deleteToken && actionStore.owns(deleteToken)) actionStore.close(deleteToken)
  const guid = route.params.guid
  if (!canRead.value || !/^[1-9]\d{0,18}$/.test(guid) || (guid.length === 19 && guid > '9223372036854775807')) {
    store.clear()
    return false
  }
  try {
    const detail = await store.loadDetail(guid, { isRoot: userStore.user?.role === 'root' })
    return detail?.guid === guid
  } catch { return false }
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
  cancelEditRefresh()
  if (editToken.value && editStore.owns(editToken.value)) editStore.close(editToken.value)
  deleteTrigger = event?.currentTarget ?? document.activeElement
  deleteToken = actionStore.open(target, { onSucceeded: onDeleteSucceeded, onConflict: onDeleteConflict, onUnauthorized })
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
    if (code === 'not_found') void load()
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

onMounted(load)
watch(() => route.params.guid, () => { editPermissionRefreshRequest++ })
watch([() => route.params.guid, canRead, () => userStore.identityEpoch, () => userStore.permissionRevision], load)
watch(() => store.selected, target => { if (editToken.value && editStore.owns(editToken.value)) editStore.updateContext(editToken.value, { target }) })
onBeforeUnmount(() => {
  cancelEditRefresh(); editPermissionRefreshRequest++; if (editToken.value) editStore.dispose(editToken.value); editToken.value = null; editTrigger = null; editContext = null
  cancelDeleteRefresh(); if (deleteToken) actionStore.dispose(deleteToken); deleteToken = null; deleteTrigger = null
})
</script>

<style scoped>
.admin-page { max-width: 1100px; margin: 0 auto; }
.title { display: flex; justify-content: space-between; align-items: center; font-size: 20px; font-weight: 600; }
.nickname-row { display: inline-flex; align-items: center; gap: 8px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.permissions { margin-top: 20px; }
</style>
