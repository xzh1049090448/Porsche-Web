<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { usePublicI18n } from '@/i18n/public-runtime.js'
const open = ref(false)
const { locale, t, toggle } = usePublicI18n()
defineProps({ links: { type: Array, default: () => [] } })
</script>
<template><header class="public-header"><RouterLink class="public-brand" to="/" :aria-label="t('home')">{{ t('home') }}</RouterLink><button class="public-nav-toggle" type="button" aria-controls="public-nav" :aria-expanded="open" @click="open = !open">{{ t('menu') }}</button><nav id="public-nav" :class="{ 'is-open': open }" :aria-label="t('menu')"><a href="/#advantages">{{ t('advantages') }}</a><a href="/#models">{{ t('models') }}</a><RouterLink to="/pricing">{{ t('pricing') }}</RouterLink><a v-for="link in links.filter(item => item.placement === 'header')" :key="link.href" :href="link.href" :target="/^https?:/.test(link.href) ? '_blank' : undefined" rel="noopener noreferrer">{{ link.label }}</a><RouterLink to="/about">{{ t('about') }}</RouterLink><button type="button" class="public-locale" @click="toggle">{{ t('language') }}</button><RouterLink class="public-button public-button--small" to="/chat">{{ t('console') }}</RouterLink></nav></header></template>
