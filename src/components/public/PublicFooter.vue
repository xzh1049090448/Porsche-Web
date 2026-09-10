<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { createPublicContentState } from '@/stores/publicContent.js'
const state = createPublicContentState()
const config = computed(() => { try { return JSON.parse(state.value.home.data?.document || '{}') } catch { return {} } })
const safeHttp = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }
const contacts = computed(() => Array.isArray(config.value.contactLinks) ? config.value.contactLinks.filter(link => link?.label && safeHttp(link.url)) : [])
onMounted(() => state.loadHome().catch(() => {})); onUnmounted(() => state.cancel('home'))
</script>
<template><footer class="public-footer"><div><strong>{{ config.siteName || 'AI 模型中转站' }}</strong><p v-if="config.footer">{{ config.footer }}</p></div><nav aria-label="页脚导航"><RouterLink to="/about">关于</RouterLink><RouterLink to="/terms">服务协议</RouterLink><RouterLink to="/privacy">隐私政策</RouterLink><a v-for="link in contacts" :key="link.url" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label }}</a></nav></footer></template>
