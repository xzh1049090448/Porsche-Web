<script setup>
import { usePublicI18n } from '@/i18n/public-runtime.js'
const { t } = usePublicI18n()
defineProps({ links: { type: Array, default: () => [] } })
</script>
<template><footer class="public-footer"><strong class="public-footer__brand">Porsche</strong><nav :aria-label="t('menu')"><RouterLink to="/about">{{ t('about') }}</RouterLink><RouterLink to="/terms">{{ t('terms') }}</RouterLink><RouterLink to="/privacy">{{ t('privacy') }}</RouterLink><a v-for="link in links.filter(item => item.placement === 'contact')" :key="link.href" :href="link.href">{{ link.label }}</a></nav></footer></template>
