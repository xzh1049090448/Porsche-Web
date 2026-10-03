<template><router-link to="/" class="app-brand" :class="[`app-brand--${variant}`, { 'is-wordmark': variant !== 'icon' }]" :aria-label="title"><img :src="logoSrc" alt="" class="app-brand__icon" /><span class="app-brand__copy"><strong>{{ title }}</strong><small v-if="subtitle">{{ subtitle }}</small></span></router-link></template>
<script setup>
import { computed } from 'vue'
import { useDocumentTheme } from '@/composables/useDocumentTheme.js'

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  // nav: 主题感知的横向导航字标；brand: 首页/品牌区字标；icon: 小尺寸方形图标
  variant: { type: String, default: 'nav' },
})

/**
 * 导航字标随深浅主题切换：两版素材都是透明底，深色版为近白字标。
 */
const NAV_LOGOS = { light: '/nav_logo.png', dark: '/dark_nav_logo.png' }

/**
 * 非导航变体按落点表面选择素材，字符串表示与主题无关的固定素材。
 * - brand：公共页页脚品牌区，背景是硬编码的 #111827，深浅主题下都是深色表面，
 *   因此固定使用近白的字标 dark_logo.png（对 #111827 为 15.57:1）。
 *   浅色的 logo_refined.png 是深海军蓝字标，在此对比度仅 1.10:1，不可用。
 * - icon：控制台顶栏随主题切换；深色用 dark_icon.png，其近白图形对 #111827
 *   为 15.57:1（navy 底板约 1.03:1，在深色顶栏上几乎隐没，只剩浅色图形）。
 */
const VARIANT_LOGOS = {
  brand: '/dark_logo.png',
  icon: { light: '/icon_only.png', dark: '/dark_icon.png' },
}

const theme = useDocumentTheme()

const logoSrc = computed(() => {
  const logos = props.variant === 'nav' ? NAV_LOGOS : VARIANT_LOGOS[props.variant] ?? NAV_LOGOS
  return typeof logos === 'string' ? logos : logos[theme.value]
})
</script>
