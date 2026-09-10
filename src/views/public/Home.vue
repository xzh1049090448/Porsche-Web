<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { createPublicContentState } from '@/stores/publicContent.js'
import PublicContentState from '@/components/public/PublicContentState.vue'
import { createPublishedDocumentCodec, selectCuratedModels } from '@/utils/public-document.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'

const state = createPublicContentState(); const codec = createPublishedDocumentCodec(); const { t } = usePublicI18n()
const dismissed = ref(new Set()); const announcementDialog = ref(null); let previousFocus = null
const home = computed(() => { try { return codec.decode(state.value.home.data?.document || '') } catch { return null } })
const configured = computed(() => Boolean(home.value?.title))
const referencedCatalog = computed(() => (home.value?.modelKeys || []).map(key => state.value.details[key]?.data?.model).filter(Boolean))
const curatedModels = computed(() => selectCuratedModels(home.value?.modelKeys, referencedCatalog.value))
const curatedEntries = computed(() => curatedModels.value.map(model => ({ model, asset: home.value?.modelAssets[model.modelKey] })))
const modelWallStatus = computed(() => { const slots = (home.value?.modelKeys || []).map(key => state.value.details[key]); if (slots.some(slot => slot?.status === 'loading')) return 'loading'; if (slots.some(slot => slot?.status === 'error')) return 'error'; return 'empty' })
const hasAnnouncement = computed(() => Boolean(home.value?.sections.announcements.length) && !dismissed.value.has(String(state.value.home.data?.releaseVersion)))
async function load() { await Promise.allSettled([state.loadSite(), state.loadHome()]); await Promise.allSettled((home.value?.modelKeys || []).map(key => state.loadModel(key))) }
const announcementKey = () => `public_announcement_read:${state.value.home.data?.releaseVersion}`
function dismiss() { const version = String(state.value.home.data?.releaseVersion); try { localStorage.setItem(announcementKey(), 'read') } catch {}; dismissed.value = new Set([...dismissed.value, version]); nextTick(() => previousFocus?.isConnected && previousFocus.focus()) }
function restoreReadState() { try { if (localStorage.getItem(announcementKey()) === 'read') dismissed.value.add(String(state.value.home.data?.releaseVersion)) } catch {}; dismissed.value = new Set(dismissed.value) }
function handleDialogKey(event) { if (event.key === 'Escape') dismiss(); if (event.key === 'Tab') { event.preventDefault(); announcementDialog.value?.querySelector('button')?.focus() } }
watch(hasAnnouncement, async visible => { if (!visible) return; previousFocus = document.activeElement; await nextTick(); announcementDialog.value?.querySelector('button')?.focus() })
onMounted(async () => { await load(); restoreReadState() }); onUnmounted(() => { state.cancel('site'); state.cancel('home'); for (const key of home.value?.modelKeys || []) state.cancel(`detail:${key}`) })
</script>
<template><div class="public-home"><PublicContentState v-if="state.value.home.status !== 'ready'" :status="state.value.home.status" @retry="load" /><PublicContentState v-else-if="!configured" status="preparing" /><template v-else>
  <section class="public-hero" data-section="hero" aria-labelledby="home-title"><div><h1 id="home-title">{{ home.title }}</h1><div class="public-lead public-richtext" v-html="home.introHTML" /><div class="public-actions"><RouterLink class="public-button" to="/chat">{{ t('console') }}</RouterLink><RouterLink class="public-button public-button--secondary" to="/pricing">{{ t('pricing') }}</RouterLink></div></div><aside v-if="home.sections.demo.length" class="public-demo" :aria-label="t('demo')"><span class="public-demo__label">{{ t('demo') }}</span><div class="public-richtext" v-html="home.sections.demo.join('')" /></aside></section>
  <section id="advantages" class="public-section" data-section="advantages" aria-labelledby="advantages-title"><h2 id="advantages-title">{{ t('advantages') }}</h2><div v-if="home.advantageCards.length" class="public-card-grid"><article v-for="card in home.advantageCards" :key="card.title" class="public-card"><h3>{{ card.title }}</h3><div class="public-richtext" v-html="card.html" /></article></div><PublicContentState v-else status="empty" /></section>
  <section id="models" class="public-section" data-section="models" aria-labelledby="models-title"><h2 id="models-title">{{ t('models') }}</h2><div v-if="curatedEntries.length" class="public-model-wall"><RouterLink v-for="entry in curatedEntries" :key="entry.model.modelKey" :to="`/pricing/${entry.model.modelKey}`"><img v-if="entry.asset" :src="entry.asset" alt="" loading="lazy" />{{ entry.model.displayName }}<small>{{ entry.model.provider }}</small></RouterLink></div><PublicContentState v-else :status="modelWallStatus" @retry="load" /></section>
  <section class="public-section public-info-grid" data-section="announcements-faq" :aria-label="`${t('announcements')} / ${t('faq')}`"><div><h2>{{ t('announcements') }}</h2><div v-if="home.sections.announcements.length" class="public-richtext" v-html="home.sections.announcements.join('')" /><PublicContentState v-else status="empty" /></div><div><h2>{{ t('faq') }}</h2><div v-if="home.sections.faq.length" class="public-richtext" v-html="home.sections.faq.join('')" /><PublicContentState v-else status="empty" /></div></section>
  <section class="public-cta" data-section="cta" aria-labelledby="cta-title"><div><h2 id="cta-title">{{ t('cta') }}</h2><div v-if="home.sections.cta.length" class="public-richtext" v-html="home.sections.cta.join('')" /></div><RouterLink class="public-button public-button--light" to="/chat">{{ t('console') }}</RouterLink></section>
  <div v-if="hasAnnouncement" class="public-announcement-backdrop"><section ref="announcementDialog" class="public-notice" role="dialog" aria-modal="true" aria-labelledby="announcement-title" tabindex="-1" @keydown="handleDialogKey"><h2 id="announcement-title">{{ t('announcements') }}</h2><div class="public-richtext" v-html="home.sections.announcements.join('')" /><button class="public-button" type="button" @click="dismiss">{{ t('acknowledge') }}</button></section></div>
</template></div></template>
