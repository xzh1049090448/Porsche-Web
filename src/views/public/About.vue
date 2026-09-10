<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { createPublicContentState } from '@/stores/publicContent.js'
import PublicContentState from '@/components/public/PublicContentState.vue'
const state = createPublicContentState()
const safeBody = computed(() => DOMPurify.sanitize(marked.parse(state.value.pages.about.data?.document || ''), { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'object', 'embed'], ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/)/i }))
const load = () => state.loadPage('about')
onMounted(() => load().catch(() => {})); onUnmounted(() => state.cancel('page:about'))
</script>
<template><article class="public-document"><h1>关于</h1><PublicContentState v-if="state.value.pages.about.status !== 'ready'" :status="state.value.pages.about.status" @retry="load" /><div v-else-if="safeBody" class="public-richtext" v-html="safeBody" /><PublicContentState v-else status="empty" /></article></template>
