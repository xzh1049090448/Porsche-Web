<template>
  <el-config-provider :locale="elementLocale">
    <RouteViewTransition key-mode="component" :focus-target="focusTarget" />
  </el-config-provider>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import RouteViewTransition from '@/components/shell/RouteViewTransition.vue'

const { elementLocale } = useI18n()
const route = useRoute()
const focusTarget = computed(() => {
  if (route.name === 'PublicContentPreview') return '#public-content'
  return route.meta.requiresAuth ? '#console-content' : '.auth-page input'
})
</script>
