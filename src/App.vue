<template>
  <el-config-provider :locale="elementLocale">
    <AuthStatus />
    <router-view :key="userStore.identityEpoch" />
  </el-config-provider>
</template>

<script setup>
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import AuthStatus from '@/components/AuthStatus.vue'
import { useUserStore } from '@/stores/user'
const userStore = useUserStore()
const router = useRouter()
watch(() => userStore.isLoggedIn, value => {
  if (!value && router.currentRoute.value.meta.requiresAuth) void router.replace('/login')
})
import { useI18n } from '@/composables/useI18n'

const { elementLocale } = useI18n()
</script>
