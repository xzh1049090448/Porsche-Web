<template>
  <div class="login-page">
    <div class="login-toolbar">
      <LocaleToggle />
      <ThemeToggle />
    </div>
    <div class="login-card">
      <div class="login-brand">
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
        <el-button type="primary" class="submit-btn" :loading="loading" @click="submitPwd">
          {{ t('login.submit') }}
        </el-button>
        <el-button text class="register-link" @click="router.push('/register')">{{ t('login.register') }}</el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'
import LocaleToggle from '@/components/LocaleToggle.vue'
import { useI18n } from '@/composables/useI18n'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const { t } = useI18n()

const loading = ref(false)
const pwdFormRef = ref()

const pwdForm = reactive({
  username: '',
  password: '',
})

const pwdRules = computed(() => ({
  username: [{ required: true, message: t('login.usernameRequired') }],
  password: [{ required: true, message: t('login.passwordRequired') }],
}))

async function submitPwd() {
  await pwdFormRef.value?.validate()
  loading.value = true
  try {
    await userStore.loginUsername({ username: pwdForm.username, password: pwdForm.password })
    ElMessage.success(t('login.success'))
    router.replace(route.query.redirect || '/')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.login-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--login-bg);
  padding: 24px;
}

.login-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.login-card {
  width: min(420px, 100%);
  padding: 32px;
  background: var(--component-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--elevated-shadow);
}

.login-brand {
  text-align: center;
  margin-bottom: 24px;

  h1 {
    margin: 12px 0 4px;
    font-size: 20px;
    font-weight: 600;
    line-height: 28px;
    color: var(--text-primary);
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 22px;
  }
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
