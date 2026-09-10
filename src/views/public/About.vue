<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { createPublicContentState } from '@/stores/publicContent.js'
import PublicContentState from '@/components/public/PublicContentState.vue'
import { createPublishedDocumentCodec } from '@/utils/public-document.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'
const state = createPublicContentState(); const codec = createPublishedDocumentCodec(); const { t } = usePublicI18n()
const content = computed(() => { try { return codec.decode(state.value.pages.about.data?.document || '') } catch { return null } })
const load = () => state.loadPage('about'); onMounted(() => load().catch(() => {})); onUnmounted(() => state.cancel('page:about'))
</script>
<template><article class="public-document"><h1>{{ content?.title || t('about') }}</h1><PublicContentState v-if="state.value.pages.about.status !== 'ready'" :status="state.value.pages.about.status" @retry="load" /><PublicContentState v-else-if="!content?.title" status="preparing" /><div v-else class="public-richtext" v-html="content.html" /></article></template>
