<template>
  <el-alert v-if="store.authState === 'uncertain'" type="warning" :closable="false" show-icon
    title="已在本地退出；服务端会话状态尚未确认，认证操作已暂停。">
    <p>请使用支持 Web Locks 和 BroadcastChannel 的安全浏览器，并允许站点存储。未确认的请求无法通过刷新页面或取消请求来判定已结束。</p>
    <el-button size="small" @click="recover">检查恢复状态</el-button>
    <span v-if="blocked" role="status">仍无法可靠确认，请稍后联系支持处理服务端会话。</span>
  </el-alert>
</template>
<script setup>
import { ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { authSession } from '@/api/request'
const store = useUserStore()
const blocked = ref(false)
async function recover() {
  try { await authSession.recover() } catch { blocked.value = true }
}
</script>
