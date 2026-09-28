<template>
  <el-alert v-if="store.authState === 'uncertain'" type="warning" :closable="false" show-icon
    :title="statusCopy.title">
    <p>{{ statusCopy.detail }}</p>
    <el-button size="small" :loading="checking" :disabled="checking" @click="recover">检查恢复状态</el-button>
  </el-alert>
</template>
<script setup>
import { computed, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { authSession } from '@/api/request'

const CAPABILITY_COPY = {
  auth_capability_unavailable: '请使用支持安全认证能力的现代浏览器。',
  auth_insecure_context: '请通过 HTTPS 安全上下文访问本站。',
  auth_web_locks_unavailable: '当前浏览器需要支持 Web Locks。',
  auth_broadcast_channel_unavailable: '当前浏览器需要支持 BroadcastChannel。',
  auth_storage_unavailable: '请允许本站使用站点存储。',
}
const ALLOWED_RESULT_CODES = new Set([
  'auth_recovery_unsupported',
  ...Object.keys(CAPABILITY_COPY),
])
const store = useUserStore()
const emit = defineEmits(['recovered'])
const checking = ref(false)
const resultCode = ref(null)
const statusCopy = computed(() => {
  const code = resultCode.value || store.authIssue || 'auth_uncertain'
  if (CAPABILITY_COPY[code]) {
    return { title: '当前浏览器环境不支持安全认证', detail: CAPABILITY_COPY[code] }
  }
  if (code === 'auth_recovery_unsupported') {
    return { title: '无法自动判断该认证操作结果', detail: '该认证操作结果需要人工核对，请完成手动验证。' }
  }
  if (resultCode.value) {
    return { title: '恢复仍未解决', detail: '认证状态仍未确认，可在网络恢复后重试。' }
  }
  return { title: '上一次认证请求结果尚未确认', detail: '请检查恢复状态后再继续登录或注册。' }
})
async function recover() {
  if (checking.value) return
  checking.value = true
  resultCode.value = null
  try {
    const result = await authSession.recover()
    emit('recovered', result)
  } catch (error) {
    resultCode.value = ALLOWED_RESULT_CODES.has(error?.code) ? error.code : 'auth_uncertain'
  } finally {
    checking.value = false
  }
}
</script>
