<script>
import { RouterLink } from 'vue-router'
import DOMPurify from 'dompurify'
import PublicSection from '@/components/public/PublicSection.vue'
import { usePublicI18n } from '@/i18n/public-runtime.js'

const purifier = DOMPurify

export function sanitizeHomeHTML(value) {
  if (typeof value !== 'string') return ''
  return purifier.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'iframe', 'object', 'embed', 'video', 'audio'],
    FORBID_ATTR: ['style', 'src', 'srcset'],
  })
}

export default {
  name: 'HomeDynamicContent',
  components: { PublicSection, RouterLink },
  props: {
    announcements: { type: Array, default: () => [] },
    faqs: { type: Array, default: () => [] },
    featuredModels: { type: Array, default: null },
  },
  setup(props) {
    const { t } = usePublicI18n()
    return { sanitizeHomeHTML, t }
  },
}
</script>

<template>
  <PublicSection v-if="featuredModels?.length" id="models" :title="t('models')" tone="muted" data-section="models">
    <div class="public-model-wall">
      <RouterLink v-for="model in featuredModels" :key="model.modelKey" :to="`/pricing/${model.modelKey}`">
        <span class="public-model-wall__asset" aria-hidden="true">{{ model.displayName.slice(0, 1) }}</span>
        <strong>{{ model.displayName }}</strong>
        <small>{{ model.provider }}</small>
      </RouterLink>
    </div>
  </PublicSection>

  <PublicSection v-if="announcements.length" :title="t('announcements')" data-section="announcements">
    <div class="public-announcement-list">
      <article v-for="item in announcements" :key="item.guid" class="public-card public-announcement-card">
        <h3>{{ item.title }}</h3>
        <div class="public-richtext" v-html="sanitizeHomeHTML(item.bodyHtml)" />
      </article>
    </div>
  </PublicSection>

  <PublicSection v-if="faqs.length" :title="t('faq')" tone="muted" data-section="faq">
    <div class="public-faq-list">
      <details v-for="item in faqs" :key="item.guid" class="public-card public-faq-card">
        <summary>{{ item.question }}</summary>
        <div class="public-richtext" v-html="sanitizeHomeHTML(item.answerHtml)" />
      </details>
    </div>
  </PublicSection>
</template>
