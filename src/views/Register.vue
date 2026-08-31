<template>
  <div class="register-page">
    <div class="register-card">
      <h1>{{ t('login.register') }}</h1>
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
import { useRouter } from 'vue-router'
import { register } from '@/api/auth'
import { useI18n } from '@/composables/useI18n'

const router = useRouter()
const { t } = useI18n()
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
  } finally { loading.value = false }
}
</script>

<style scoped lang="scss">
.register-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--login-bg); }
.register-card { width: min(420px, 100%); padding: 32px; background: var(--component-bg); border: 1px solid var(--border); border-radius: 12px; }
.submit-btn, .login-link { width: 100%; margin-top: 8px; }
</style>
