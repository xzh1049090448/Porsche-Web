<template>
  <div class="profile-page page-container">
    <h1 class="page-title">{{ t('profile.title') }}</h1>
    <el-row :gutter="20">
      <el-col :xs="24" :md="14">
        <el-card shadow="never"><template #header>{{ t('profile.basicInfo') }}</template>
          <el-form :model="form" label-width="100px"><el-form-item :label="t('login.username')"><el-input :model-value="user?.username" disabled /></el-form-item><el-form-item :label="t('profile.nickname')"><el-input v-model="form.nickname" /></el-form-item><el-button type="primary" :loading="saving" @click="saveProfile">{{ t('profile.save') }}</el-button></el-form>
        </el-card>
        <el-card shadow="never" class="mt-card"><template #header>{{ t('profile.changePassword') }}</template>
          <el-form :model="pwdForm" label-width="100px"><el-form-item :label="t('profile.oldPassword')"><el-input v-model="pwdForm.oldPassword" type="password" show-password /></el-form-item><el-form-item :label="t('profile.newPassword')"><el-input v-model="pwdForm.newPassword" type="password" show-password /></el-form-item><el-form-item :label="t('profile.confirmPassword')"><el-input v-model="pwdForm.confirm" type="password" show-password /></el-form-item><el-button type="primary" @click="changePwd">{{ t('profile.changePassword') }}</el-button></el-form>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="10">
        <el-card shadow="never"><template #header>{{ t('profile.sessions') }}</template>
          <el-button size="small" @click="loadSessions">{{ t('profile.refreshSessions') }}</el-button><el-button size="small" type="warning" @click="revokeOthers">{{ t('profile.revokeOthers') }}</el-button>
          <el-table :data="sessions" size="small" style="margin-top: 12px"><el-table-column prop="loginMethod" :label="t('profile.loginMethod')" /><el-table-column prop="ip" label="IP" /><el-table-column prop="userAgent" :label="t('profile.userAgent')" /><el-table-column :label="t('profile.actions')"><template #default="{ row }"><el-tag v-if="row.current" size="small">{{ t('profile.currentSession') }}</el-tag><el-button v-else link type="danger" @click="revoke(row.guid)">{{ t('profile.revoke') }}</el-button></template></el-table-column></el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { listSessions, revokeOtherSessions, revokeSession } from '@/api/auth'
import { changePassword } from '@/api/users'
import { useI18n } from '@/composables/useI18n'

const userStore = useUserStore(); const router = useRouter(); const { t } = useI18n()
const user = computed(() => userStore.user); const saving = ref(false); const sessions = ref([])
const form = reactive({ nickname: '' }); const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })

/** Reloads server-filtered, DTO-whitelisted device sessions. */
async function loadSessions() { sessions.value = await listSessions() }
async function saveProfile() { saving.value = true; try { await userStore.updateProfile(form); ElMessage.success(t('profile.saveSuccess')) } finally { saving.value = false } }
async function changePwd() {
  if (!pwdForm.oldPassword || !pwdForm.newPassword || pwdForm.newPassword !== pwdForm.confirm) { ElMessage.warning(t('profile.passwordMismatch')); return }
  await changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword })
  userStore.clearSession(); await router.replace('/login')
}
async function revoke(guid) { await revokeSession(guid); await loadSessions() }
async function revokeOthers() { await revokeOtherSessions(); await loadSessions() }
onMounted(async () => { form.nickname = user.value?.nickname || ''; await loadSessions() })
</script>

<style scoped lang="scss">
.page-container { padding: 24px; max-width: 1100px; margin: 0 auto; height: 100%; overflow-y: auto; }
.mt-card { margin-top: 16px; }
</style>
