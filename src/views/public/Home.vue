<script setup>
import { computed, inject } from 'vue'
import HeroPreview from '@/components/public/HeroPreview.vue'
import HomeDynamicContent from '@/components/public/HomeDynamicContent.vue'
import PublicSection from '@/components/public/PublicSection.vue'
import { usePublicI18n } from '@/i18n/public-runtime.js'
import { publicHomeMessages } from '@/i18n/public-messages.js'
import '@/styles/public-content.scss'

const { homeContent, publication } = inject('public-home-publication')
const { locale, t } = usePublicI18n()
const fixed = computed(() => publicHomeMessages[locale.value])
const dynamicState = computed(() => homeContent.value.value)
const dynamicData = computed(() => dynamicState.value.status === 'ready' ? dynamicState.value.data : null)
const featuredModels = computed(() => publication.value?.featuredModels.value ?? null)
</script>

<template>
  <div class="public-home">
    <section class="public-hero" data-section="hero" aria-labelledby="home-title">
      <div class="public-hero__decor" aria-hidden="true">
        <i class="public-hero__blob public-hero__blob--violet" />
        <i class="public-hero__blob public-hero__blob--green" />
        <i class="public-hero__blob public-hero__blob--blue" />
      </div>
      <div class="public-hero__inner">
        <div class="public-hero__copy">
          <p class="public-eyebrow">{{ fixed.eyebrow }}</p>
          <h1 id="home-title">{{ fixed.title }}</h1>
          <p class="public-lead">{{ fixed.intro }}</p>
          <div class="public-actions">
            <RouterLink class="public-button" to="/chat">{{ t('console') }}<span aria-hidden="true">→</span></RouterLink>
            <RouterLink class="public-button public-button--secondary" to="/pricing">{{ fixed.pricingAction }}</RouterLink>
          </div>
        </div>
        <HeroPreview :label="t('demo')" />
      </div>
    </section>

    <section class="public-proof" data-section="proof" :aria-label="fixed.proofLabel">
      <article><strong>{{ fixed.proofOneTitle }}</strong><span>{{ fixed.proofOneBody }}</span></article>
      <article><strong>{{ fixed.proofTwoTitle }}</strong><span>{{ fixed.proofTwoBody }}</span></article>
      <article><strong>{{ fixed.proofThreeTitle }}</strong><span>{{ fixed.proofThreeBody }}</span></article>
    </section>

    <PublicSection id="advantages" :title="t('advantages')" data-section="advantages">
      <template #heading><p class="public-muted">{{ fixed.advantagesIntro }}</p></template>
      <div class="public-benefit-grid">
        <article class="public-card public-feature-card"><span class="public-feature-card__icon" aria-hidden="true" /><h3>{{ fixed.advantageOneTitle }}</h3><p>{{ fixed.advantageOneBody }}</p></article>
        <article class="public-card public-feature-card"><span class="public-feature-card__icon" aria-hidden="true" /><h3>{{ fixed.advantageTwoTitle }}</h3><p>{{ fixed.advantageTwoBody }}</p></article>
        <article class="public-card public-feature-card"><span class="public-feature-card__icon" aria-hidden="true" /><h3>{{ fixed.advantageThreeTitle }}</h3><p>{{ fixed.advantageThreeBody }}</p></article>
        <article class="public-card public-feature-card"><span class="public-feature-card__icon" aria-hidden="true" /><h3>{{ fixed.advantageFourTitle }}</h3><p>{{ fixed.advantageFourBody }}</p></article>
      </div>
    </PublicSection>

    <HomeDynamicContent
      v-if="dynamicData"
      :announcements="dynamicData.announcements"
      :faqs="dynamicData.faqs"
      :featured-models="featuredModels"
    />
    <p v-else-if="dynamicState.status === 'hidden'" class="sr-only" role="status" aria-live="polite">{{ fixed.dynamicUnavailable }}</p>

    <section class="public-cta" data-section="cta" aria-labelledby="cta-title">
      <div><h2 id="cta-title">{{ fixed.ctaTitle }}</h2><p>{{ fixed.ctaBody }}</p></div>
      <RouterLink class="public-button public-button--light" to="/chat">{{ t('console') }}<span aria-hidden="true">→</span></RouterLink>
    </section>
  </div>
</template>
