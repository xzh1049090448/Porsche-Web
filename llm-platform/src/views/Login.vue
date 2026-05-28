<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <span class="logo-icon">AI</span>
        <h1>国内大模型聚合平台</h1>
        <p>聚合国内主流大模型 · 跨境电商专属知识库</p>
      </div>

      <el-tabs v-model="loginType" class="login-tabs">
        <el-tab-pane label="验证码登录" name="sms">
          <el-form ref="smsFormRef" :model="smsForm" :rules="smsRules" @submit.prevent>
            <el-form-item prop="phone">
              <el-input
                v-model="smsForm.phone"
                placeholder="请输入手机号"
                maxlength="11"
                :prefix-icon="Iphone"
              />
            </el-form-item>
            <el-form-item prop="code">
              <div class="code-row">
                <el-input
                  v-model="smsForm.code"
                  placeholder="验证码"
                  maxlength="6"
                  :prefix-icon="Message"
                />
                <el-button :disabled="countdown > 0" @click="sendCode">
                  {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
                </el-button>
              </div>
            </el-form-item>
            <el-button type="primary" class="submit-btn" :loading="loading" @click="submitSms">
              登录
            </el-button>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="密码登录" name="password">
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
              />
            </el-form-item>
            <el-button type="primary" class="submit-btn" :loading="loading" @click="submitPwd">
              登录
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="demo-tip"
        title="登录说明"
        :description="loginTip"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Iphone, Message, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { sendSmsCode } from '@/api/auth'
import { USE_MOCK } from '@/api/request'

const loginTip = computed(() =>
  USE_MOCK
    ? '本地 Mock：任意 11 位手机号，验证码 123456；密码登录密码 demo123。'
    : '已对接 ai-gateway：先点「获取验证码」，弹窗或接口会返回 dev_code（需后端 SMS_DEV_MODE=true）；密码登录须先注册账号。'
)

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const loginType = ref('sms')
const loading = ref(false)
const countdown = ref(0)
const smsFormRef = ref()
const pwdFormRef = ref()

const smsForm = reactive({ phone: '', code: '' })
const pwdForm = reactive({ phone: '', password: '' })

const smsRules = {
  phone: [
    { required: true, message: '请输入手机号' },
    { pattern: /^1\d{10}$/, message: '手机号格式不正确' },
  ],
  code: [{ required: true, message: '请输入验证码' }],
}

const pwdRules = {
  phone: [
    { required: true, message: '请输入手机号' },
    { pattern: /^1\d{10}$/, message: '手机号格式不正确' },
  ],
  password: [{ required: true, message: '请输入密码' }],
}

async function sendCode() {
  await smsFormRef.value?.validateField('phone')
  const res = await sendSmsCode(smsForm.phone)
  if (res?.dev_code) {
    smsForm.code = String(res.dev_code)
    ElMessage.success(`验证码已发送（开发环境：${res.dev_code}）`)
  } else {
    ElMessage.success(res?.message || '验证码已发送')
  }
  countdown.value = 60
  const t = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) clearInterval(t)
  }, 1000)
}

async function submitSms() {
  await smsFormRef.value?.validate()
  loading.value = true
  try {
    await userStore.loginSms({ ...smsForm })
    ElMessage.success('登录成功')
    router.replace(route.query.redirect || '/')
  } finally {
    loading.value = false
  }
}

async function submitPwd() {
  await pwdFormRef.value?.validate()
  loading.value = true
  try {
    await userStore.loginPassword({ ...pwdForm })
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
  background: linear-gradient(160deg, #e8f4ff 0%, #f0f9eb 50%, #f5f7fa 100%);
  padding: 24px;
}

.login-card {
  width: min(420px, 100%);
  padding: 32px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}

.login-brand {
  text-align: center;
  margin-bottom: 24px;

  h1 {
    margin: 12px 0 4px;
    font-size: 22px;
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
}

.logo-icon {
  display: inline-flex;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #409eff, #67c23a);
  color: #fff;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
}

.code-row {
  display: flex;
  gap: 8px;
  width: 100%;

  .el-input {
    flex: 1;
  }
}

.submit-btn {
  width: 100%;
  margin-top: 8px;
}

.demo-tip {
  margin-top: 20px;
}
</style>
