<template>
  <div class="auth-page login-page">
    <AuthStatus @recovered="handleRecovered" />
    <div class="login-toolbar">
      <LocaleToggle />
      <ThemeToggle />
    </div>
    <div class="auth-card login-card surface-card">
      <div class="auth-brand login-brand">
        <img src="/logo.png" alt="" class="logo-icon" />
        <h1>{{ t('app.title') }}</h1>
        <p>{{ t('app.tagline') }}</p>
      </div>

      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" @submit.prevent>
        <el-form-item prop="username">
          <el-input
            v-model="pwdForm.username"
            :placeholder="t('login.username')"
            maxlength="20"
            :prefix-icon="User"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="pwdForm.password"
            type="password"
            :placeholder="t('login.password')"
            show-password
            :prefix-icon="Lock"
            @keyup.enter="submitPwd"
          />
        </el-form-item>
        <el-button type="primary" class="submit-btn" :loading="loading" :disabled="authBlocked" @click="submitPwd">
          {{ t('login.submit') }}
        </el-button>
        <el-button text class="register-link" :disabled="authBlocked" @click="openRegistration">{{ t('login.register') }}</el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { authErrorMessage } from '@/api/auth-errors'
import { useUserStore } from '@/stores/user'
import { safeAuthRedirect } from '@/utils/auth-redirect'
import ThemeToggle from '@/components/ThemeToggle.vue'
import LocaleToggle from '@/components/LocaleToggle.vue'
import AuthStatus from '@/components/AuthStatus.vue'
import { useI18n } from '@/composables/useI18n'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const { t } = useI18n()

const loading = ref(false)
const pwdFormRef = ref()
const authBlocked = computed(() => userStore.authState === 'uncertain')

const pwdForm = reactive({
  username: '',
  password: '',
})

const pwdRules = computed(() => ({
  username: [{ required: true, message: t('login.usernameRequired') }],
  password: [{ required: true, message: t('login.passwordRequired') }],
}))

async function submitPwd() {
  if (authBlocked.value) return
  await pwdFormRef.value?.validate()
  loading.value = true
  try {
    await userStore.loginUsername({ username: pwdForm.username, password: pwdForm.password })
    ElMessage.success(t('login.success'))
    router.replace(safeAuthRedirect(route.query.redirect, '/chat'))
  } catch (error) { ElMessage.error(authErrorMessage(error)) } finally {
    loading.value = false
  }
}

function openRegistration() {
  if (authBlocked.value) return
  router.push('/register')
}

function handleRecovered(result) {
  if (result?.state === 'authenticated') {
    router.replace(safeAuthRedirect(route.query.redirect, '/chat'))
  }
}
</script>

<style scoped lang="scss">
.login-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.logo-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.submit-btn {
  width: 100%;
  margin-top: 8px;
  height: 40px;
  border-radius: 8px;
}

.register-link { width: 100%; margin-top: 8px; }
</style>
