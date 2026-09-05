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
          <el-descriptions-item label="昵称">{{ store.selected.nickname || '未设置' }}</el-descriptions-item>
          <el-descriptions-item label="角色">{{ store.selected.role === 'admin' ? '管理员' : '用户' }}</el-descriptions-item>
          <el-descriptions-item label="套餐">{{ planLabel }}</el-descriptions-item>
          <el-descriptions-item label="邮箱">未设置</el-descriptions-item>
          <el-descriptions-item label="分组">未接入</el-descriptions-item>
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
    <UserSoftDeleteDialog @closed="restoreDeleteFocus" />
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useAdminUsersStore } from '@/stores/admin-users'
import { useAdminUserActionsStore, canDeleteAdminUser } from '@/stores/admin-user-actions'
import UserSoftDeleteDialog from '@/components/admin/UserSoftDeleteDialog.vue'
import { useI18n } from '@/composables/useI18n'

const route = useRoute()
const userStore = useUserStore()
const store = useAdminUsersStore()
const actionStore = useAdminUserActionsStore()
const { t } = useI18n()
const canRead = computed(() => userStore.permissionProjection?.capabilities?.includes('users.read') === true)
const deleteCapability = 'users.delete'
const canDeleteTarget = computed(() => userStore.permissionProjection?.capabilities?.includes(deleteCapability) === true
  && canDeleteAdminUser({ actorRole: userStore.user?.role, capabilities: userStore.permissionProjection.capabilities, target: store.selected }))
const showPermissions = computed(() => canRead.value && store.selected?.status !== 'deleted' && store.selected?.role === 'admin' && userStore.user?.role === 'root')
const permissionUnavailable = computed(() => showPermissions.value && !store.permissions)
const permissionRows = computed(() => store.permissions?.capabilities || [])
const detailStatus = computed(() => store.detailError?.response?.status)
const detailErrorTitle = computed(() => ({ 401: '认证会话无效', 403: '无权限访问', 404: '用户不存在', 503: '用户信息暂不可用' }[detailStatus.value] || '用户信息暂不可用'))
const detailErrorDescription = computed(() => detailStatus.value === 403 ? '当前身份保持登录状态，可重新检查权限。' : '当前详情数据已清理，请重试或返回用户列表。')
const statusLabel = computed(() => ({ active: '启用', disabled: '禁用', deleted: '已删除' }[store.selected?.status] || store.selected?.status))
const planLabel = computed(() => ({ free: '免费版', professional: '专业版', enterprise: '企业版' }[store.selected?.planType] || store.selected?.planType))

async function load() {
  const guid = route.params.guid
  if (!canRead.value || !/^[1-9]\d{0,18}$/.test(guid) || (guid.length === 19 && guid > '9223372036854775807')) {
    store.clear()
    return
  }
  try { await store.loadDetail(guid, { isRoot: userStore.user?.role === 'root' }) } catch {}
}

async function retryIdentity() {
  try { await userStore.fetchSelf() } catch {}
}

let deleteTrigger = null
const pageHeading = ref(null)
function openDelete(target, event) {
  deleteTrigger = event?.currentTarget ?? document.activeElement
  actionStore.open(target, { onSucceeded: onDeleteSucceeded, onConflict: onDeleteConflict, onUnauthorized })
}
function onDeleteSucceeded({ guid }) {
  if (store.selected?.guid === guid) {
    store.selected = { ...store.selected, status: 'deleted' }
    store.permissions = null
    store.catalog = null
  }
}
async function onDeleteConflict(guid) { await load(); if (store.selected?.guid === guid) actionStore.updateTarget(store.selected) }
function onUnauthorized() { userStore.clearSession(); store.clear() }
function restoreDeleteFocus() { const trigger = deleteTrigger; deleteTrigger = null; nextTick(() => (trigger?.isConnected ? trigger : pageHeading.value?.$el ?? pageHeading.value)?.focus?.()) }

onMounted(load)
watch([() => route.params.guid, canRead, () => userStore.permissionRevision], load)
onBeforeUnmount(() => { actionStore.dispose(); restoreDeleteFocus() })
</script>

<style scoped>
.admin-page { max-width: 1100px; margin: 0 auto; }
.title { display: flex; justify-content: space-between; align-items: center; font-size: 20px; font-weight: 600; }
.permissions { margin-top: 20px; }
</style>
