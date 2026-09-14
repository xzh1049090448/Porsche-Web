<script setup>
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import PublicContentState from '@/components/public/PublicContentState.vue'
import HeroPreview from '@/components/public/HeroPreview.vue'
import PublicSection from '@/components/public/PublicSection.vue'
import { selectCuratedModels } from '@/utils/public-document.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'
import '@/styles/public-content.scss'

const { store: state, publication, loadHome } = inject('public-home-publication'); const { locale, t } = usePublicI18n()
const dismissed = ref(new Set()); const announcementDialog = ref(null); let previousFocus = null
const home = computed(() => publication.value?.home.value || null)
const homeStatus = computed(() => state.value.site.status === 'error' ? 'error' : state.value.site.status === 'loading' ? 'loading' : state.value.home.status)
const configured = computed(() => Boolean(home.value?.title))
const referencedCatalog = computed(() => (home.value?.modelKeys || []).map(key => state.value.details[key]?.data?.model).filter(Boolean))
const curatedModels = computed(() => selectCuratedModels(home.value?.modelKeys, referencedCatalog.value))
const curatedEntries = computed(() => curatedModels.value.map(model => ({ model, asset: home.value?.modelAssets[model.modelKey] })))
const modelWallStatus = computed(() => { const slots = (home.value?.modelKeys || []).map(key => state.value.details[key]); if (slots.some(slot => slot?.status === 'loading')) return 'loading'; if (slots.some(slot => slot?.status === 'error')) return 'error'; return 'empty' })
const hasAnnouncement = computed(() => Boolean(home.value?.sections.announcements.length) && !dismissed.value.has(String(state.value.home.data?.releaseVersion)))
const proofItems = computed(() => locale.value === 'en' ? [
  { title: 'Unified access', body: 'Reach the models published in the catalog through one gateway.' },
  { title: 'OpenAI compatible', body: 'Use familiar OpenAI-compatible API conventions.' },
  { title: 'Token-based pricing', body: 'Compare published input and output prices by token.' },
] : [
  { title: '统一接入', body: '通过一个网关访问目录中已发布的模型。' },
  { title: 'OpenAI 兼容', body: '使用熟悉的 OpenAI 兼容 API 规范。' },
  { title: '按 Token 计价', body: '按 Token 查看已发布的输入与输出参考价。' },
])
const load = () => loadHome()
const announcementKey = () => `public_announcement_read:${state.value.home.data?.releaseVersion}`
function dismiss() { const version = String(state.value.home.data?.releaseVersion); try { localStorage.setItem(announcementKey(), 'read') } catch {}; dismissed.value = new Set([...dismissed.value, version]); nextTick(() => previousFocus?.isConnected && previousFocus.focus()) }
function restoreReadState() { try { if (localStorage.getItem(announcementKey()) === 'read') dismissed.value.add(String(state.value.home.data?.releaseVersion)) } catch {}; dismissed.value = new Set(dismissed.value) }
function handleDialogKey(event) { if (event.key === 'Escape') dismiss(); if (event.key === 'Tab') { event.preventDefault(); announcementDialog.value?.querySelector('button')?.focus() } }
watch(hasAnnouncement, async visible => { if (!visible) return; previousFocus = document.activeElement; await nextTick(); announcementDialog.value?.querySelector('button')?.focus() })
watch(() => state.value.home.data?.releaseVersion, restoreReadState)
onMounted(() => restoreReadState())
</script>
<template>
  <div class="public-home">
    <PublicContentState v-if="homeStatus !== 'ready'" :status="homeStatus" @retry="load" />
    <PublicContentState v-else-if="!configured" status="preparing" />
    <template v-else>
      <section class="public-hero" data-section="hero" aria-labelledby="home-title">
        <div class="public-hero__decor" aria-hidden="true"><i class="public-hero__blob public-hero__blob--violet" /><i class="public-hero__blob public-hero__blob--green" /><i class="public-hero__blob public-hero__blob--blue" /></div>
        <div class="public-hero__copy">
          <h1 id="home-title">{{ home.title }}</h1>
          <div class="public-lead public-richtext" v-html="home.introHTML" />
          <div class="public-actions"><RouterLink class="public-button" to="/chat">{{ t('console') }}<span aria-hidden="true">→</span></RouterLink><RouterLink class="public-button public-button--secondary" to="/pricing">{{ t('pricing') }}</RouterLink></div>
        </div>
        <HeroPreview :label="t('demo')" />
      </section>

      <section class="public-proof" data-section="proof" aria-label="平台能力">
        <article><strong>{{ proofItems[0].title }}</strong><span>{{ proofItems[0].body }}</span></article>
        <article><strong>{{ proofItems[1].title }}</strong><span>{{ proofItems[1].body }}</span></article>
        <article><strong>{{ proofItems[2].title }}</strong><span>{{ proofItems[2].body }}</span></article>
      </section>

      <PublicSection id="advantages" :title="t('advantages')" data-section="advantages">
        <div v-if="home.advantageCards.length" class="public-benefit-grid"><article v-for="card in home.advantageCards" :key="card.title" class="public-card public-feature-card"><span class="public-feature-card__icon" aria-hidden="true" /><h3>{{ card.title }}</h3><div class="public-richtext" v-html="card.html" /></article></div>
        <PublicContentState v-else status="empty" />
      </PublicSection>

      <PublicSection id="models" :title="t('models')" tone="muted" data-section="models">
        <div v-if="curatedEntries.length" class="public-model-wall"><RouterLink v-for="entry in curatedEntries" :key="entry.model.modelKey" :to="`/pricing/${entry.model.modelKey}`"><span class="public-model-wall__asset"><img v-if="entry.asset" :src="entry.asset" alt="" loading="lazy" /><span v-else aria-hidden="true">{{ entry.model.displayName.slice(0, 1) }}</span></span><strong>{{ entry.model.displayName }}</strong><small>{{ entry.model.provider }}</small></RouterLink></div>
        <PublicContentState v-else :status="modelWallStatus" @retry="load" />
      </PublicSection>

      <PublicSection :title="`${t('announcements')} / ${t('faq')}`" data-section="announcements-faq">
        <div class="public-info-grid"><div><h3>{{ t('announcements') }}</h3><div v-if="home.sections.announcements.length" class="public-richtext" v-html="home.sections.announcements.join('')" /><PublicContentState v-else status="empty" /></div><div><h3>{{ t('faq') }}</h3><div v-if="home.sections.faq.length" class="public-richtext" v-html="home.sections.faq.join('')" /><PublicContentState v-else status="empty" /></div></div>
      </PublicSection>

      <section class="public-cta" data-section="cta" aria-labelledby="cta-title"><div><h2 id="cta-title">{{ t('cta') }}</h2><div v-if="home.sections.cta.length" class="public-richtext" v-html="home.sections.cta.join('')" /></div><RouterLink class="public-button public-button--light" to="/chat">{{ t('console') }}<span aria-hidden="true">→</span></RouterLink></section>
      <div v-if="hasAnnouncement" class="public-announcement-backdrop"><section ref="announcementDialog" class="public-notice" role="dialog" aria-modal="true" aria-labelledby="announcement-title" tabindex="-1" @keydown="handleDialogKey"><h2 id="announcement-title">{{ t('announcements') }}</h2><div class="public-richtext" v-html="home.sections.announcements.join('')" /><button class="public-button" type="button" @click="dismiss">{{ t('acknowledge') }}</button></section></div>
    </template>
  </div>
</template>
