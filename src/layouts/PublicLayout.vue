<script setup>
import { computed, onMounted, onUnmounted, provide } from 'vue'
import PublicHeader from '@/components/public/PublicHeader.vue'
import PublicFooter from '@/components/public/PublicFooter.vue'
import { usePublicContentStore } from '@/stores/publicContent.js'
import { createPublicLayoutPublication } from '@/stores/publicHomePublication.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'
const store = usePublicContentStore()
const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => { const { createPublishedDocumentCodec } = await import('@/utils/public-document.js'); return createPublishedDocumentCodec() } })
const publication = lifecycle.publication; const ready = lifecycle.siteReady
const shellLinks = computed(() => publication.value?.home.value?.shellLinks || [])
provide('public-home-publication', { store, publication, ready, loadHome: lifecycle.loadHome, loadPage: lifecycle.loadPage })
const { t } = usePublicI18n()
onMounted(() => lifecycle.init())
onUnmounted(() => lifecycle.dispose())
</script>
<template><div class="public-layout public-shell"><a class="public-skip-link" href="#public-content">{{ t('skip') }}</a><PublicHeader :links="shellLinks" /><main id="public-content" tabindex="-1"><RouterView /></main><PublicFooter :links="shellLinks" /></div></template>
