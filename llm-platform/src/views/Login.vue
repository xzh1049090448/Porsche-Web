<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <span class="logo-icon">AI</span>
        <h1>国内大模型聚合平台</h1>
        <p>聚合国内主流大模型 · 跨境电商专属知识库</p>
      </div>

      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" @submit.prevent>
        <el-form-item prop="phone">
          <el-input
            v-model="pwdForm.phone"
            placeholder="手机号"
            maxlength="11"
            :prefix-icon="Iphone"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="pwdForm.password"
            type="password"
            placeholder="密码"
            show-password
            :prefix-icon="Lock"
            @keyup.enter="submitPwd"
          />
        </el-form-item>
        <el-button type="primary" class="submit-btn" :loading="loading" @click="submitPwd">
          登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Iphone, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const loading = ref(false)
const pwdFormRef = ref()

const pwdForm = reactive({
  phone: '',
  password: '',
})

const pwdRules = {
  phone: [
    { required: true, message: '请输入手机号' },
    { pattern: /^1\d{10}$/, message: '手机号格式不正确' },
  ],
  password: [{ required: true, message: '请输入密码' }],
}

async function submitPwd() {
  await pwdFormRef.value?.validate()
  loading.value = true
  try {
    await userStore.loginPassword({ phone: pwdForm.phone, password: pwdForm.password })
    ElMessage.success('登录成功')
    router.replace(route.query.redirect || '/')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--app-bg);
  padding: 24px;
}

.login-card {
  width: min(420px, 100%);
  padding: 32px;
  background: var(--component-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
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
  display: inline-flex;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #fff;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
}

.submit-btn {
  width: 100%;
  margin-top: 8px;
  height: 40px;
  border-radius: 8px;
}
</style>
