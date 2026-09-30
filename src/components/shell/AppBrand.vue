<template><router-link to="/" class="app-brand" :class="[`app-brand--${variant}`, { 'is-wordmark': variant !== 'icon' }]" :aria-label="title"><img :src="logoSrc" alt="" class="app-brand__icon" /><span class="app-brand__copy"><strong>{{ title }}</strong><small v-if="subtitle">{{ subtitle }}</small></span></router-link></template>
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  // nav: 主题感知的横向导航字标；brand: 首页/品牌区字标；icon: 小尺寸方形图标
  variant: { type: String, default: 'nav' },
})

/** 导航字标随深浅主题切换；brand/icon 使用单张固定素材。 */
const NAV_LOGOS = { light: '/nav_logo.png', dark: '/dark_nav_logo.png' }
const VARIANT_LOGOS = { brand: '/logo_refined.jpg', icon: '/icon_only.jpg' }

function readTheme() {
  const value = globalThis.document?.documentElement?.dataset?.theme
  return value === 'dark' ? 'dark' : 'light'
}

const theme = ref(readTheme())
let observer

onMounted(() => {
  theme.value = readTheme()
  if (typeof MutationObserver !== 'function' || !globalThis.document?.documentElement) return
  // 控制台经 theme store 写 data-theme，公共页直接写 data-theme；观察该属性可同时覆盖两条路径。
  observer = new MutationObserver(() => { theme.value = readTheme() })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => { observer?.disconnect(); observer = undefined })

const logoSrc = computed(() => {
  if (props.variant === 'nav') return NAV_LOGOS[theme.value]
  return VARIANT_LOGOS[props.variant] ?? NAV_LOGOS[theme.value]
})
</script>
