<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { createPublicContentState } from '@/stores/publicContent.js'
const state = createPublicContentState()
const config = computed(() => { try { return JSON.parse(state.value.home.data?.document || '{}') } catch { return {} } })
const safeHttp = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }
const configuredLinks = computed(() => Array.isArray(config.value.links) ? config.value.links.filter(link => link?.label && safeHttp(link.url)) : [])
const open = ref(false)
onMounted(() => state.loadHome().catch(() => {})); onUnmounted(() => state.cancel('home'))
</script>
<template><header class="public-header"><RouterLink class="public-brand" to="/" aria-label="返回官网首页">{{ config.siteName || 'AI 模型中转站' }}</RouterLink><button class="public-nav-toggle" type="button" aria-controls="public-nav" :aria-expanded="open" @click="open = !open">菜单</button><nav id="public-nav" :class="{ 'is-open': open }" aria-label="公共页面导航"><a href="/#advantages">优势</a><a href="/#models">模型</a><RouterLink to="/pricing">价格</RouterLink><a v-for="link in configuredLinks" :key="link.url" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label }}</a><RouterLink to="/about">关于</RouterLink><RouterLink class="public-button public-button--small" to="/chat">进入控制台</RouterLink></nav></header></template>
