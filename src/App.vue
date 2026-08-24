<template>
  <el-config-provider :locale="elementLocale">
    <router-view />
  </el-config-provider>
</template>

<script setup>
import { useI18n } from '@/composables/useI18n'

const { elementLocale } = useI18n()
</script>
