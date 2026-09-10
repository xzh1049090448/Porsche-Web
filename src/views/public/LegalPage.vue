<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { createPublicContentState } from '@/stores/publicContent.js'
import PublicContentState from '@/components/public/PublicContentState.vue'
import { createPublishedDocumentCodec } from '@/utils/public-document.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'
const props = defineProps({ page: { type: String, required: true, validator: value => ['terms', 'privacy'].includes(value) } })
const state = createPublicContentState(); const codec = createPublishedDocumentCodec(); const { t } = usePublicI18n()
const slot = computed(() => state.value.pages[props.page])
const content = computed(() => { try { return codec.legal(codec.decode(slot.value.data?.document || '')) } catch { return null } })
const load = () => state.loadPage(props.page); watch(() => props.page, load); onMounted(() => load().catch(() => {})); onUnmounted(() => state.cancel(`page:${props.page}`))
</script>
<template><article class="public-document"><h1>{{ content?.title || t(page) }}</h1><PublicContentState v-if="slot.status !== 'ready'" :status="slot.status" @retry="load" /><PublicContentState v-else-if="!content?.valid" status="preparing" /><template v-else><header><p class="public-document__meta">{{ t('version') }} {{ content.version }} · {{ t('effectiveDate') }} {{ content.effectiveDate }}</p></header><nav class="table-of-contents" :aria-label="t('toc')"><h2>{{ t('toc') }}</h2><ol><li v-for="item in content.toc" :key="item.id"><a :href="`#${item.id}`">{{ item.text }}</a></li></ol></nav><div class="public-richtext" v-html="content.legalBodyHTML" /><footer class="public-document__contact"><h2>{{ t('contact') }}</h2><p>{{ content.contact }}</p></footer></template></article></template>
