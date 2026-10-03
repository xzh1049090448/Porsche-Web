<template>
  <div class="auth-page register-page">
    <div class="register-toolbar" role="group" :aria-label="t('app.title')">
      <LocaleToggle />
      <ThemeToggle />
    </div>
    <div class="auth-card register-card surface-card">
      <div class="auth-brand">
        <img :src="brandLogo" alt="" class="logo-icon" />
        <h1>{{ t('app.title') }}</h1>
        <p>{{ t('app.tagline') }}</p>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" @submit.prevent>
        <el-form-item prop="username"><el-input v-model="form.username" :placeholder="t('login.username')" maxlength="20" /></el-form-item>
        <el-form-item prop="nickname"><el-input v-model="form.nickname" :placeholder="t('profile.nickname')" maxlength="50" /></el-form-item>
        <el-form-item prop="password"><el-input v-model="form.password" type="password" show-password :placeholder="t('login.password')" /></el-form-item>
        <el-form-item prop="confirm"><el-input v-model="form.confirm" type="password" show-password :placeholder="t('profile.confirmPassword')" @keyup.enter="submit" /></el-form-item>
        <el-button type="primary" class="submit-btn" :loading="loading" @click="submit">{{ t('login.register') }}</el-button>
        <el-button text class="login-link" @click="router.push('/login')">{{ t('login.backToLogin') }}</el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { authErrorMessage } from '@/api/auth-errors'
import { useRouter } from 'vue-router'
import { register } from '@/api/auth'
import { useI18n } from '@/composables/useI18n'
import { useDocumentTheme } from '@/composables/useDocumentTheme.js'
import LocaleToggle from '@/components/LocaleToggle.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const { t } = useI18n()
// 深色主题的卡片背景是 #111827，深海军蓝的 logo_refined.png 对比度仅 1.10:1，故改用近白字标。
const theme = useDocumentTheme()
const brandLogo = computed(() => (theme.value === 'dark' ? '/dark_logo.png' : '/logo_refined.png'))
const formRef = ref()
const loading = ref(false)
const form = reactive({ username: '', nickname: '', password: '', confirm: '' })
const rules = computed(() => ({
  username: [{ required: true, message: t('login.usernameRequired') }],
  password: [{ required: true, message: t('login.passwordRequired') }],
  confirm: [{ validator: (_, value, callback) => callback(value === form.password ? undefined : new Error(t('profile.passwordMismatch'))) }],
}))

/** Registers without retaining credentials, then sends the user to login. */
async function submit() {
  await formRef.value?.validate()
  loading.value = true
  try {
    await register({ username: form.username, password: form.password, nickname: form.nickname || undefined })
    ElMessage.success(t('login.registerSuccess'))
    await router.replace('/login')
  } catch (error) { ElMessage.error(authErrorMessage(error)) } finally { loading.value = false }
}
</script>

<style scoped lang="scss">
.register-toolbar { position: absolute; top: 16px; right: 16px; display: flex; align-items: center; gap: 4px; }
.logo-icon { width: auto; height: 40px; object-fit: contain; }
.submit-btn, .login-link { width: 100%; margin-top: 8px; }
</style>
