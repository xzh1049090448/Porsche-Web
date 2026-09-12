<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { usePublicI18n } from '@/i18n/public-runtime.js'
const menuOpen = ref(false)
const navId = 'public-mobile-nav'
const { locale, t, toggle } = usePublicI18n()
defineProps({ links: { type: Array, default: () => [] } })
const theme = ref(globalThis.document?.documentElement?.dataset?.theme === 'dark' ? 'dark' : 'light')
const themeLabel = computed(() => locale.value === 'zh' ? '切换主题' : 'Switch theme')
function closeMenu() { menuOpen.value = false }
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  if (globalThis.document) globalThis.document.documentElement.dataset.theme = theme.value
  try { globalThis.localStorage?.setItem('llm_platform_uiTheme', JSON.stringify(theme.value)) } catch {}
}
</script>
<template>
  <header class="public-header">
    <RouterLink class="public-brand" to="/" :aria-label="t('home')" @click="closeMenu">Porsche</RouterLink>
    <nav class="public-nav public-nav--desktop" :aria-label="t('menu')">
      <a href="/#advantages">{{ t('advantages') }}</a><a href="/#models">{{ t('models') }}</a><RouterLink to="/pricing">{{ t('pricing') }}</RouterLink><a v-for="link in links.filter(item => item.placement === 'header')" :key="link.href" :href="link.href" :target="/^https?:/.test(link.href) ? '_blank' : undefined" rel="noopener noreferrer">{{ link.label }}</a><RouterLink to="/about">{{ t('about') }}</RouterLink>
    </nav>
    <div class="public-header__actions">
      <button type="button" class="public-locale" :aria-label="t('language')" @click="toggle">{{ t('language') }}</button>
      <button type="button" class="public-theme" :aria-label="themeLabel" :title="themeLabel" :aria-pressed="theme === 'dark'" @click="toggleTheme">{{ theme === 'dark' ? '☀' : '◐' }}</button>
      <RouterLink class="public-button public-button--small public-console-cta" to="/chat">{{ t('console') }}</RouterLink>
      <button class="public-nav-toggle" type="button" :aria-expanded="menuOpen" :aria-controls="navId" @click="menuOpen = !menuOpen"><span aria-hidden="true">☰</span><span class="sr-only">{{ t('menu') }}</span></button>
    </div>
    <nav :id="navId" class="public-nav public-nav--mobile" :class="{ 'is-open': menuOpen }" :aria-label="t('menu')">
      <a href="/#advantages" @click="closeMenu">{{ t('advantages') }}</a><a href="/#models" @click="closeMenu">{{ t('models') }}</a><RouterLink to="/pricing" @click="closeMenu">{{ t('pricing') }}</RouterLink><a v-for="link in links.filter(item => item.placement === 'header')" :key="link.href" :href="link.href" :target="/^https?:/.test(link.href) ? '_blank' : undefined" rel="noopener noreferrer" @click="closeMenu">{{ link.label }}</a><RouterLink to="/about" @click="closeMenu">{{ t('about') }}</RouterLink><RouterLink class="public-button public-console-cta" to="/chat" @click="closeMenu">{{ t('console') }}</RouterLink>
    </nav>
  </header>
</template>
