<template>
  <el-config-provider :locale="elementLocale">
    <RouteViewTransition focus-target="#console-content, .auth-page input" />
  </el-config-provider>
</template>

<script setup>
import { useI18n } from '@/composables/useI18n'
import RouteViewTransition from '@/components/shell/RouteViewTransition.vue'

const { elementLocale } = useI18n()
</script>
