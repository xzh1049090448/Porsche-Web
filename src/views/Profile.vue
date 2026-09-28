<template>
  <div class="profile-page page-container console-page">
    <PageHeader :title="t('profile.title')" />

    <el-alert v-if="userStore.profileError" title="个人资料暂时不可用，登录仍然有效" type="warning" :closable="false"><el-button @click="loadProfile">重试资料</el-button></el-alert>
    <el-row :gutter="20">
      <el-col :xs="24" :md="14">
        <el-card shadow="never" class="surface-card">
          <template #header>{{ t('profile.basicInfo') }}</template>
          <el-form :model="form" label-width="100px">
            <el-form-item :label="t('profile.nickname')">
              <el-input v-model="form.nickname" />
            </el-form-item>
            <el-form-item :label="t('login.username')"><el-input :model-value="user?.username" disabled /></el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveProfile">{{ t('profile.save') }}</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="mt-card surface-card">
          <template #header>{{ t('profile.changePassword') }}</template>
          <el-form :model="pwdForm" label-width="100px">
            <el-form-item :label="t('profile.oldPassword')">
              <el-input v-model="pwdForm.oldPassword" type="password" show-password />
            </el-form-item>
            <el-form-item :label="t('profile.newPassword')">
              <el-input v-model="pwdForm.newPassword" type="password" show-password />
            </el-form-item>
            <el-form-item :label="t('profile.confirmPassword')">
              <el-input v-model="pwdForm.confirm" type="password" show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="changePwd">{{ t('profile.changePassword') }}</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="10">
        <el-card shadow="never" class="surface-card">
          <template #header>
            <span>{{ t('profile.verify') }}</span>
            <el-tag v-if="user?.verified" type="success" size="small" style="margin-left: 8px">
              {{ t('profile.verified') }}
            </el-tag>
          </template>
          <el-alert
            v-if="user?.verified"
            type="success"
            :closable="false"
            show-icon
            :title="t('profile.verifiedTip')"
          />
          <el-form v-else :model="verifyForm" label-width="80px">
            <el-form-item :label="t('profile.realName')">
              <el-input v-model="verifyForm.name" :placeholder="t('profile.realNamePlaceholder')" />
            </el-form-item>
            <el-form-item :label="t('profile.idCard')">
              <el-input
                v-model="verifyForm.idCard"
                :placeholder="t('profile.idCardPlaceholder')"
                maxlength="18"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="verifying" @click="submitVerify">
                {{ t('profile.submitVerify') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="mt-card surface-card">
          <template #header>{{ t('profile.usageOverview') }}</template>
          <el-descriptions :column="1" border>
            <el-descriptions-item :label="t('profile.totalTokens')">
              {{ usage.totalTokens?.toLocaleString() }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('profile.remainingQuota')">
              {{ usage.remainingQuota }} / {{ usage.dailyLimit }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('profile.currentPlan')">{{ planLabel }}</el-descriptions-item>
          </el-descriptions>
          <el-button type="primary" link style="margin-top: 12px" @click="$router.push('/billing')">
            {{ t('profile.viewBilling') }}
          </el-button>
        </el-card>
      </el-col>
    </el-row>
    <el-card shadow="never" class="mt-card surface-card">
      <template #header>{{ t('profile.sessions') }}</template>
      <el-button :loading="sessionsLoading" @click="loadSessions">{{ t('profile.refreshSessions') }}</el-button>
      <el-button type="warning" :disabled="sessionsLoading" @click="revokeOthers">{{ t('profile.revokeOthers') }}</el-button>
      <el-table :data="sessions">
        <el-table-column prop="loginMethod" :label="t('profile.loginMethod')" />
        <el-table-column prop="ip" label="IP" />
        <el-table-column prop="userAgent" :label="t('profile.userAgent')" />
        <el-table-column :label="t('profile.actions')"><template #default="{ row }">
          <el-tag v-if="row.current">{{ t('profile.currentSession') }}</el-tag>
          <el-button link type="danger" @click="revoke(row)">{{ t('profile.revoke') }}</el-button>
        </template></el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useRouter } from 'vue-router'
import { authSession } from '@/api/request'
import { authErrorMessage } from '@/api/auth-errors'
import { listSessions, revokeOtherSessions, revokeSession } from '@/api/auth'
import { changePassword, submitRealName } from '@/api/users'
import { getUsageStats } from '@/api/billing'
import { useI18n } from '@/composables/useI18n'
import PageHeader from '@/components/shell/PageHeader.vue'

const userStore = useUserStore()
const { t } = useI18n()
const user = computed(() => userStore.user)
const saving = ref(false)
const verifying = ref(false)
const usage = ref({})

const form = reactive({ nickname: '', phone: '' })
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })
const verifyForm = reactive({ name: '', idCard: '' })

const planLabel = computed(() => {
  const p = usage.value.plan || user.value?.plan
  if (p === 'professional' || p === 'pro') return t('plan.pro')
  if (p === 'enterprise') return t('plan.enterprise')
  return t('plan.free')
})

const router = useRouter()
const sessions = ref([])
const sessionsLoading = ref(false)
async function loadProfile() {
  try {
    await userStore.fetchProfile()
    form.nickname = user.value?.nickname || ''
    form.phone = user.value?.phone || ''
  } catch { /* Retried independently through the visible profile warning. */ }
}
async function loadSessions() {
  sessionsLoading.value = true
  try { sessions.value = await listSessions() }
  catch (error) { if (error.code !== 'identity_changed') ElMessage.error(authErrorMessage(error)) }
  finally { sessionsLoading.value = false }
}
async function revoke(row) {
  try {
    await revokeSession(row.guid, row.current)
    if (row.current) await router.replace('/login')
    else await loadSessions()
  } catch (error) { ElMessage.error(authErrorMessage(error)) }
}
async function revokeOthers() {
  try { await revokeOtherSessions(); await loadSessions() }
  catch (error) { ElMessage.error(authErrorMessage(error)) }
}
onMounted(async () => {
  const context = authSession.capture()
  await Promise.allSettled([loadProfile(), loadSessions(), (async () => {
    const result = await getUsageStats()
    authSession.assertCurrent(context)
    usage.value = result
  })()])
})

async function saveProfile() {
  saving.value = true
  try {
    await userStore.updateProfile({ ...form })
    ElMessage.success(t('profile.saveSuccess'))
  } finally {
    saving.value = false
  }
}

async function changePwd() {
  if (!pwdForm.oldPassword || !pwdForm.newPassword) {
    ElMessage.warning(t('profile.fillPassword'))
    return
  }
  if (pwdForm.newPassword !== pwdForm.confirm) {
    ElMessage.warning(t('profile.passwordMismatch'))
    return
  }
  try {
  await changePassword({
    oldPassword: pwdForm.oldPassword,
    newPassword: pwdForm.newPassword,
  })
  ElMessage.success(t('profile.passwordChanged'))
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdForm.confirm = ''
  await router.replace('/login')
  } catch (error) { ElMessage.error(authErrorMessage(error)) }
}

async function submitVerify() {
  verifying.value = true
  try {
    await submitRealName({ ...verifyForm })
    await userStore.fetchProfile()
    ElMessage.success(t('profile.verifySuccess'))
  } finally {
    verifying.value = false
  }
}
</script>

<style scoped lang="scss">
.page-container {
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.mt-card {
  margin-top: 16px;
}
</style>
