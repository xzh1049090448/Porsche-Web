<script setup>
import { computed, inject, onMounted, onUnmounted } from 'vue'
import { verifiedPublicPageData } from '@/stores/publicHomePublication.js'
import PublicContentState from '@/components/public/PublicContentState.vue'
import { createPublishedDocumentCodec } from '@/utils/public-document.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'
const { store: state, ready, loadPage } = inject('public-home-publication'); const codec = createPublishedDocumentCodec(); const { t } = usePublicI18n()
const content = computed(() => { try { return codec.decode(verifiedPublicPageData(state, 'about')?.document || '') } catch { return null } })
let active = true
const load = async () => { await ready; if (active) return loadPage('about'); return null }; onMounted(() => load().catch(() => {})); onUnmounted(() => { active = false; state.invalidatePage('about') })
</script>
<template><article class="public-document"><h1>{{ content?.title || t('about') }}</h1><PublicContentState v-if="state.value.pages.about.status !== 'ready'" :status="state.value.pages.about.status" @retry="load" /><PublicContentState v-else-if="!content?.title" status="preparing" /><div v-else class="public-richtext" v-html="content.bodyHTML" /></article></template>
