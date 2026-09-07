<template>
  <section class="admin-page">
    <div ref="pageHeading" class="page-heading" tabindex="-1">
      <div><p class="eyebrow">ADMINISTRATION</p><h1>用户管理</h1><p>查看当前有权访问的用户信息。</p></div>
      <el-button v-if="canCreate" type="primary" @click="openCreate($event)">{{ t('createUser.open') }}</el-button>
    </div>
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ createAnnouncement }}</p>
    <el-alert v-if="!canRead" type="warning" :closable="false" title="暂无用户管理权限" description="权限信息不可用时不会加载用户数据。"><template #default><el-button link type="primary" @click="retryIdentity">重新检查身份</el-button></template></el-alert>
    <template v-else>
      <el-card shadow="never" class="filters-card"><el-form class="filters" @submit.prevent="reloadFromFirstPage">
        <el-form-item label="搜索"><el-input v-model="filters.q" clearable placeholder="用户名、昵称或 GUID" @keyup.enter="reloadFromFirstPage" /></el-form-item>
        <el-form-item label="角色"><el-select v-model="filters.role" clearable><el-option label="用户" value="user"/><el-option label="管理员" value="admin"/><el-option label="Root" value="root"/></el-select></el-form-item>
        <el-form-item label="状态"><el-select v-model="filters.status" clearable placeholder="启用及禁用"><el-option label="启用及禁用" value=""/><el-option label="启用" value="active"/><el-option label="禁用" value="disabled"/><el-option label="已删除" value="deleted" :disabled="!canReadDeleted"/></el-select></el-form-item>
        <el-form-item label="排序"><el-select v-model="filters.sort"><el-option label="GUID" value="guid"/><el-option label="用户名" value="username"/><el-option label="创建时间" value="created_at"/><el-option label="最近登录" value="last_login_at"/></el-select></el-form-item>
        <el-form-item label="顺序"><el-select v-model="filters.order"><el-option label="降序" value="desc"/><el-option label="升序" value="asc"/></el-select></el-form-item><el-button type="primary" native-type="submit">查询</el-button>
      </el-form></el-card>
      <el-alert v-if="store.error" class="error" type="error" show-icon :closable="false" :title="errorTitle" :description="errorDescription"><template #default><el-button link type="primary" @click="reload">重试</el-button></template></el-alert>
      <el-table v-loading="store.loading" :data="store.rows" row-key="guid" empty-text="暂无用户" class="users-table">
        <el-table-column prop="guid" label="GUID" min-width="160"><template #default="{ row }"><code>{{ row.guid }}</code></template></el-table-column>
        <el-table-column label="用户名" min-width="130"><template #default="{ row }">{{ row.username ?? '未设置' }}</template></el-table-column>
        <el-table-column label="昵称" min-width="130"><template #default="{ row }">{{ row.nickname ?? '未设置' }}</template></el-table-column>
        <el-table-column label="分组" min-width="100"><template #default="{ row }">{{ row.group }}</template></el-table-column><el-table-column label="套餐" min-width="110"><template #default="{ row }">{{ planLabel(row.planType) }}</template></el-table-column><el-table-column label="金额额度" min-width="120">未接入</el-table-column>
        <el-table-column label="角色" width="100"><template #default="{ row }">{{ roleLabel(row.role) }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column><el-table-column label="最近登录" min-width="170"><template #default="{ row }">{{ row.lastLoginAt ?? '从未登录' }}</template></el-table-column>
        <el-table-column label="操作" width="150" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="$router.push(`/users/${row.guid}`)">详情</el-button><el-button v-if="canDeleteTarget(row)" link type="danger" @click="openDelete(row, $event)">{{ t('deleteUser.confirm') }}</el-button></template></el-table-column>
      </el-table>
      <el-pagination v-model:current-page="filters.page" v-model:page-size="filters.pageSize" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" :total="store.total" @current-change="reloadForPageChange" @size-change="reloadFromFirstPage" />
    </template>
    <UserCreateDialog @closed="restoreCreateFocus" />
    <UserSoftDeleteDialog @closed="restoreDeleteFocus" />
  </section>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAdminUsersStore, reconcileCreatedAdminUser } from '@/stores/admin-users'
import { useAdminUserCreateStore, canOpenAdminUserCreate, reconcileAdminUserCreateConflict, restoreAdminUserCreateTriggerFocus } from '@/stores/admin-user-create'
import { useAdminUserActionsStore, canDeleteAdminUser, reconcileDeletedList, refreshDeleteTargetFailClosed, restoreDeleteTriggerFocus } from '@/stores/admin-user-actions'
import { getAdminUser } from '@/api/admin-users'
import UserSoftDeleteDialog from '@/components/admin/UserSoftDeleteDialog.vue'
import UserCreateDialog from '@/components/admin/UserCreateDialog.vue'
import { useI18n } from '@/composables/useI18n'
import { ElMessage } from 'element-plus'
const userStore = useUserStore(); const store = useAdminUsersStore(); const actionStore = useAdminUserActionsStore(); const createStore = useAdminUserCreateStore(); const { t } = useI18n()
const canRead = computed(() => userStore.permissionProjection?.capabilities?.includes('users.read') === true)
const canReadDeleted = computed(() => userStore.permissionProjection?.capabilities?.includes('users.deleted.read') === true)
const canCreate = computed(() => userStore.permissionProjection?.capabilities?.includes('users.create') === true
  && canOpenAdminUserCreate({ actorRole: userStore.user?.role, capabilities: userStore.permissionProjection.capabilities }))
const deleteCapability = 'users.delete'
const filters = reactive({ page: 1, pageSize: 20, q: '', role: '', status: '', sort: 'guid', order: 'desc' })
const statusLabel = status => ({ active: '启用', disabled: '禁用', deleted: '已删除' }[status] || status); const statusType = status => ({ active: 'success', disabled: 'warning', deleted: 'info' }[status]); const roleLabel = role => ({ user: '用户', admin: '管理员', root: 'Root' }[role] || role); const planLabel = plan => ({ free: '免费版', professional: '专业版', enterprise: '企业版' }[plan] || plan)
const errorStatus = computed(() => store.error?.response?.status); const errorTitle = computed(() => ({ 401: '认证会话无效', 403: '无权限访问', 404: '用户不存在', 503: '用户信息暂不可用' }[errorStatus.value] || '用户信息暂不可用')); const errorDescription = computed(() => errorStatus.value === 403 ? '当前身份保持登录状态，可重新检查权限。' : '当前页面数据已清理，请重试。')
async function reload() {
  listContextRevision++
  if (deleteToken && actionStore.owns(deleteToken)) actionStore.close(deleteToken)
  if (!canRead.value) return
  try {
    const result = await store.loadList({ ...filters })
    if (result) filters.page = result.page
  } catch {}
}
function reloadForPageChange(page) {
  if (store.loading && store.recoveredPage === page) return
  return reload()
}
function reloadFromFirstPage() { filters.page = 1; return reload() }; async function retryIdentity() { try { await userStore.fetchSelf() } catch {} }
const canDeleteTarget = target => userStore.permissionProjection?.capabilities?.includes(deleteCapability) === true
  && canDeleteAdminUser({ actorRole: userStore.user?.role, capabilities: userStore.permissionProjection.capabilities, target })
let deleteTrigger = null
let createTrigger = null
const pageHeading = ref(null)
const createAnnouncement = ref('')
let deleteToken = null
let createToken = null
let listContextRevision = 0
let createIdentityRefreshDepth = 0
function openCreate(event) {
  if (!canCreate.value) return
  createAnnouncement.value = ''
  createTrigger = event?.currentTarget ?? document.activeElement
  createToken = createStore.openDialog({ actorRole: userStore.user?.role, capabilities: userStore.permissionProjection.capabilities }, {
    onSucceeded: onCreateSucceeded,
    onConflict: onCreateConflict,
    onUnauthorized,
  })
}
async function onCreateSucceeded({ createdUser }, token) {
  if (!createStore.owns(token)) return false
  await reconcileCreatedAdminUser({ state: store, filters, createdUser, reload })
  if (!createStore.owns(token)) return false
  createAnnouncement.value = createdUser
    ? t('createUser.successKnown', { username: createdUser.username, guid: createdUser.guid })
    : t('createUser.successRecovered')
  ElMessage.success(createAnnouncement.value)
  return true
}
async function refreshCreateIdentity() {
  createIdentityRefreshDepth++
  try { return await userStore.fetchSelf() } finally { createIdentityRefreshDepth-- }
}
function refreshCreateAuthorization(code, token = createToken) {
  return reconcileAdminUserCreateConflict({
    code,
    token,
    createStore,
    refreshIdentity: refreshCreateIdentity,
    currentContext: () => ({ actorRole: userStore.user?.role, capabilities: userStore.permissionProjection?.capabilities }),
  })
}
async function onCreateConflict(code, token) { return refreshCreateAuthorization(code, token) }
function openDelete(target, event) {
  deleteTrigger = event?.currentTarget ?? document.activeElement
  deleteToken = actionStore.open(target, { onSucceeded: onDeleteSucceeded, onConflict: onDeleteConflict, onUnauthorized })
}
async function onDeleteSucceeded({ guid }, token) {
  if (!actionStore.owns(token)) return false
  await reconcileDeletedList({ state: store, filters, guid, reload })
  return actionStore.owns(token)
}
async function onDeleteConflict(guid, token) {
  const contextRevision = listContextRevision
  return refreshDeleteTargetFailClosed({
    guid, token, loadTarget: getAdminUser, isContextCurrent: () => listContextRevision === contextRevision && actionStore.owns(token),
    canManage: target => canDeleteTarget(target),
    replaceTarget: (owner, target) => {
      if (listContextRevision !== contextRevision || !actionStore.updateTarget(owner, target)) return false
      const index = store.rows.findIndex(row => row.guid === guid)
      if (index >= 0) store.rows[index] = target
      return true
    },
    invalidateTarget: actionStore.invalidateTarget,
    onUnauthorized, onUnavailable: () => ElMessage.warning(t('deleteUser.targetRefreshFailed')),
  })
}
function onUnauthorized() { userStore.clearSession(); store.clear() }
function restoreDeleteFocus() {
  const token = deleteToken
  const trigger = deleteTrigger
  deleteTrigger = null
  if (!token) return
  restoreDeleteTriggerFocus({ token, canRestore: owner => deleteToken === owner && !actionStore.captureOwnership(), trigger, fallback: pageHeading.value, nextTick })
}
function restoreCreateFocus() {
  const token = createToken
  const trigger = createTrigger
  createTrigger = null
  if (!token) return
  restoreAdminUserCreateTriggerFocus({ token, canRestore: owner => createToken === owner && !createStore.captureOwnership(), trigger, fallback: pageHeading.value, nextTick })
}
watch(() => store.recoveryRevision, () => {
  if (store.recoveredPage !== null) filters.page = store.recoveredPage
})
watch([canRead, () => userStore.permissionRevision], ([enabled]) => { if (enabled) void reload(); else store.clear() }, { immediate: true })
watch(() => userStore.permissionRevision, () => {
  if (!createIdentityRefreshDepth && createToken && createStore.owns(createToken)) void refreshCreateAuthorization('permission_revision', createToken)
}, { flush: 'sync' })
watch(canCreate, enabled => { if (!enabled && createToken && createStore.owns(createToken)) createStore.closeDialog(createToken) }, { flush: 'sync' })
onBeforeUnmount(() => {
  if (createToken) createStore.disposeDialog(createToken)
  if (deleteToken) actionStore.dispose(deleteToken)
  createToken = null; createTrigger = null; deleteToken = null; deleteTrigger = null
})
</script>
<style scoped>
.admin-page{max-width:1400px;margin:0 auto;padding:24px;overflow:auto;height:100%}.page-heading{margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:16px}.eyebrow{color:var(--text-secondary);font-size:12px;letter-spacing:.12em;margin:0}h1{margin:4px 0;font-size:28px}.filters-card,.error{margin-bottom:16px}.filters{display:flex;flex-wrap:wrap;gap:0 12px}.filters :deep(.el-form-item){margin-right:0}.users-table{width:100%}.el-pagination{margin-top:20px;justify-content:flex-end}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:768px){.admin-page{padding:16px}.page-heading{align-items:flex-start}.filters{display:block}.filters :deep(.el-form-item){margin-bottom:12px}.users-table{font-size:12px}.el-pagination{justify-content:center}}
</style>
