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
const body = computed(() => { if (!content.value?.valid) return ''; let index = 0; return content.value.html.replace(/<h2>/g, () => `<h2 id="legal-section-${++index}">`) })
const load = () => state.loadPage(props.page); watch(() => props.page, load); onMounted(() => load().catch(() => {})); onUnmounted(() => state.cancel(`page:${props.page}`))
</script>
<template><article class="public-document"><PublicContentState v-if="slot.status !== 'ready'" :status="slot.status" @retry="load" /><PublicContentState v-else-if="!content?.valid" status="preparing" /><template v-else><header><h1>{{ content.title }}</h1><p class="public-document__meta">{{ t('version') }} {{ content.version }} · {{ t('effectiveDate') }} {{ content.effectiveDate }}</p></header><nav class="table-of-contents" :aria-label="t('toc')"><h2>{{ t('toc') }}</h2><ol><li v-for="(item,index) in content.toc" :key="index"><a :href="`#legal-section-${index + 1}`">{{ item.text }}</a></li></ol></nav><div class="public-richtext" v-html="body" /><footer class="public-document__contact"><h2>{{ t('contact') }}</h2><p>{{ content.contact }}</p></footer></template></article></template>
