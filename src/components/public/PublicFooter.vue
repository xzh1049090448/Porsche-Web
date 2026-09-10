<script setup>
import { usePublicI18n } from '@/i18n/public-runtime.js'
const { t } = usePublicI18n()
</script>
<template><footer class="public-footer"><nav :aria-label="t('menu')"><RouterLink to="/about">{{ t('about') }}</RouterLink><RouterLink to="/terms">{{ t('terms') }}</RouterLink><RouterLink to="/privacy">{{ t('privacy') }}</RouterLink></nav></footer></template>
