<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { createPublicContentState } from '@/stores/publicContent.js'
import PublicContentState from '@/components/public/PublicContentState.vue'
const props = defineProps({ page: { type: String, required: true, validator: value => ['terms', 'privacy'].includes(value) } })
const state = createPublicContentState()
const slot = computed(() => state.value.pages[props.page])
function parseDocument(raw) {
  try { const value = JSON.parse(raw); if (value && typeof value === 'object') return value } catch {}
  if (!raw.startsWith('---\n')) return null
  const end = raw.indexOf('\n---\n', 4); if (end < 0) return null
  const metadata = Object.fromEntries(raw.slice(4, end).split('\n').map(line => { const split = line.indexOf(':'); return split > 0 ? [line.slice(0, split).trim(), line.slice(split + 1).trim()] : ['', ''] }).filter(([key]) => key))
  return { title: metadata.title, version: metadata.version, effectiveDate: metadata.effectiveDate || metadata.effective_date, contact: metadata.contact, body: raw.slice(end + 5) }
}
const document = computed(() => parseDocument(slot.value.data?.document || ''))
const valid = computed(() => document.value && typeof document.value.title === 'string' && typeof document.value.version === 'string' && typeof document.value.effectiveDate === 'string' && typeof document.value.body === 'string')
const toc = computed(() => valid.value ? [...document.value.body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match, index) => ({ id: `section-${index + 1}`, title: match[1] })) : [])
const body = computed(() => { if (!valid.value) return ''; let index = 0; return DOMPurify.sanitize(marked.parse(document.value.body), { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'object', 'embed'], ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/)/i }).replace(/<h([23])>/g, (_match, level) => `<h${level} id="section-${++index}">`) })
const load = () => state.loadPage(props.page)
watch(() => props.page, load); onMounted(() => load().catch(() => {})); onUnmounted(() => state.cancel(`page:${props.page}`))
</script>
<template><article class="public-document"><PublicContentState v-if="slot.status !== 'ready'" :status="slot.status" @retry="load" /><PublicContentState v-else-if="!valid" status="preparing" /><template v-else><header><h1>{{ document.title }}</h1><p class="public-document__meta">版本 {{ document.version }} · 生效日期 {{ document.effectiveDate }}</p></header><nav v-if="toc.length" class="table-of-contents" aria-label="目录"><h2>目录</h2><ol><li v-for="item in toc" :key="item.id"><a :href="`#${item.id}`">{{ item.title }}</a></li></ol></nav><div class="public-richtext" v-html="body" /><footer v-if="document.contact" class="public-document__contact"><h2>联系方式</h2><p>{{ document.contact }}</p></footer></template></article></template>
