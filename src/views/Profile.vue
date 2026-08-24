<template>
  <div class="profile-page page-container">
    <h1 class="page-title">{{ t('profile.title') }}</h1>

    <el-row :gutter="20">
      <el-col :xs="24" :md="14">
        <el-card shadow="never">
          <template #header>{{ t('profile.basicInfo') }}</template>
          <el-form :model="form" label-width="100px">
            <el-form-item :label="t('profile.nickname')">
              <el-input v-model="form.nickname" />
            </el-form-item>
            <el-form-item :label="t('profile.phone')">
              <el-input v-model="form.phone" disabled />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveProfile">{{ t('profile.save') }}</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="mt-card">
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
        <el-card shadow="never">
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

        <el-card shadow="never" class="mt-card">
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { changePassword, submitRealName } from '@/api/users'
import { getUsageStats } from '@/api/billing'
import { useI18n } from '@/composables/useI18n'

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

onMounted(async () => {
  if (user.value) {
    form.nickname = user.value.nickname || ''
    form.phone = user.value.phone || ''
  }
  usage.value = await getUsageStats()
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
  await changePassword({
    oldPassword: pwdForm.oldPassword,
    newPassword: pwdForm.newPassword,
  })
  ElMessage.success(t('profile.passwordChanged'))
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdForm.confirm = ''
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
