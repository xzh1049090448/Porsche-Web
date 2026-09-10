<script setup>
import { computed, inject, watch } from 'vue'
import { verifiedPublicPageData } from '@/stores/publicHomePublication.js'
import PublicContentState from '@/components/public/PublicContentState.vue'
import { createPublishedDocumentCodec } from '@/utils/public-document.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'
const props = defineProps({ page: { type: String, required: true, validator: value => ['terms', 'privacy'].includes(value) } })
const { store: state, ready, loadPage } = inject('public-home-publication'); const codec = createPublishedDocumentCodec(); const { t } = usePublicI18n()
const slot = computed(() => state.value.pages[props.page])
const content = computed(() => { try { return codec.legal(codec.decode(verifiedPublicPageData(state, props.page)?.document || '')) } catch { return null } })
const load = page => loadPage(page)
const retry = () => load(props.page)
watch(() => props.page, (page, previous, onCleanup) => { let active = true; if (previous) state.invalidatePage(previous); state.invalidatePage(page); (async () => { await ready; if (active) await load(page) })().catch(() => {}); onCleanup(() => { active = false; state.invalidatePage(page) }) }, { immediate: true })
</script>
<template><article class="public-document"><h1>{{ content?.title || t(page) }}</h1><PublicContentState v-if="slot.status !== 'ready'" :status="slot.status" @retry="retry" /><PublicContentState v-else-if="!content?.valid" status="preparing" /><template v-else><header><p class="public-document__meta">{{ t('version') }} {{ content.version }} · {{ t('effectiveDate') }} {{ content.effectiveDate }}</p></header><nav class="table-of-contents" :aria-label="t('toc')"><h2>{{ t('toc') }}</h2><ol><li v-for="item in content.toc" :key="item.id"><a :href="`#${item.id}`">{{ item.text }}</a></li></ol></nav><div class="public-richtext" v-html="content.legalBodyHTML" /><footer class="public-document__contact"><h2>{{ t('contact') }}</h2><p>{{ content.contact }}</p></footer></template></article></template>
