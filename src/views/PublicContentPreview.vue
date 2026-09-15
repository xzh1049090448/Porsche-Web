<template>
  <div class="public-layout public-shell preview-shell">
    <PublicHeader :links="[]" />
    <main id="public-content" class="preview-page" tabindex="-1">
      <header class="preview-banner" role="status" aria-live="polite">
        <p>{{ t('publicContentAdmin.previewWarning') }}</p>
        <strong>{{ t('publicContentAdmin.revision', { revision }) }}</strong>
        <span id="preview-draft-status">Draft preview includes hidden and scheduled content</span>
      </header>
      <p v-if="loading" aria-live="polite">{{ t('publicContentAdmin.loading') }}</p>
      <p v-else-if="error" role="alert">{{ t(`publicContentAdmin.errors.${error}`) }}</p>
      <template v-else-if="preview">
        <Home />
        <section class="preview-draft-index" aria-labelledby="preview-draft-status">
          <span v-for="item in preview.home.announcements" :key="`announcement-${item.guid}`" :data-preview-state="item.isVisible ? (item.effectiveAt ? 'scheduled' : 'visible') : 'hidden'">{{ item.title }}</span>
          <span v-for="item in preview.home.faqs" :key="`faq-${item.guid}`" :data-preview-state="item.isVisible ? 'visible' : 'hidden'">{{ item.question }}</span>
        </section>
        <nav class="preview-page__tabs" aria-label="Content document">
          <button v-for="name in documentNames" :key="name" :aria-current="activeDocument === name ? 'page' : undefined" @click="activeDocument = name">{{ t(`publicContentAdmin.documents.${name}`) }}</button>
        </nav>
        <article class="preview-page__document public-richtext" v-html="documentHtml" />
      </template>
    </main>
    <PublicFooter :links="[]" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { loadStructuredContentPreview } from '@/api/publicContentAdmin.js'
import { publicHomeContentAdminApi } from '@/api/publicHomeContentAdmin.js'
import { publicPricingAdminApi } from '@/api/publicPricingAdmin.js'
import { renderSafePublicMarkdown } from '@/utils/public-content-validation.js'
import { useI18n } from '@/composables/useI18n'
import Home from '@/views/public/Home.vue'
import PublicHeader from '@/components/public/PublicHeader.vue'
import PublicFooter from '@/components/public/PublicFooter.vue'
import '@/styles/public-content.scss'

const { t } = useI18n()
const route = useRoute()
const documentNames = ['about', 'terms', 'privacy']
const activeDocument = ref('about')
const preview = ref(null)
const revision = ref(0)
const loading = ref(true)
const error = ref('')
const dynamicState = ref({ status: 'loading', data: null, error: null })
const homeContent = Object.freeze({ value: dynamicState })
const featuredModels = ref(null)
const publication = shallowRef({ featuredModels })
provide('public-home-publication', { homeContent, publication })
let controller = new AbortController(), generation = 0, robots = null, createdRobots = false, previousRobotsContent = null, previousRobotsHadContent = false

const documentHtml = computed(() => renderSafePublicMarkdown(preview.value?.documents?.[activeDocument.value] ?? ''))
const safeError = value => {
  const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'code') : null
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' && /^[a-z_]{1,64}$/.test(descriptor.value) ? descriptor.value : 'request_failed'
}

async function loadPreview() {
  controller.abort(); controller = new AbortController()
  const own = ++generation, local = controller
  loading.value = true; error.value = ''; preview.value = null; dynamicState.value = { status: 'loading', data: null, error: null }; featuredModels.value = null
  try {
    const rawRevision = Array.isArray(route.query.revision) ? null : route.query.revision
    const rawPriceGuid = Array.isArray(route.query.priceReleaseGuid) ? null : route.query.priceReleaseGuid
    const output = await loadStructuredContentPreview({ revision: Number(rawRevision), priceReleaseGuid: rawPriceGuid, homeApi: publicHomeContentAdminApi, pricingApi: publicPricingAdminApi, renderMarkdown: markdown => renderSafePublicMarkdown(markdown), signal: local.signal })
    if (own !== generation || local.signal.aborted) return
    preview.value = output; revision.value = output.revision
    dynamicState.value = { status: 'ready', data: output.home, error: null }
    featuredModels.value = output.featuredModels
  } catch (caught) {
    if (own === generation && !local.signal.aborted) { error.value = safeError(caught); dynamicState.value = { status: 'hidden', data: null, error: { code: error.value, requestId: null } } }
  } finally { if (own === generation) loading.value = false }
}

onMounted(() => {
  robots = document.head.querySelector('meta[name="robots"]')
  if (robots) { previousRobotsHadContent = robots.hasAttribute('content'); previousRobotsContent = robots.content }
  else { robots = document.createElement('meta'); robots.name = 'robots'; document.head.append(robots); createdRobots = true }
  robots.content = 'noindex, nofollow, noarchive'
  void loadPreview()
})
onBeforeUnmount(() => {
  generation++; controller.abort(); preview.value = null; featuredModels.value = null; dynamicState.value = { status: 'idle', data: null, error: null }
  if (createdRobots) robots?.remove()
  else if (robots) { if (previousRobotsHadContent) robots.content = previousRobotsContent; else robots.removeAttribute('content') }
})
</script>
