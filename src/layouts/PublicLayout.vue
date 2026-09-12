<script>
import { computed, h, onMounted, onUnmounted, provide } from 'vue'
import { RouterView } from 'vue-router'
import PublicHeader from '@/components/public/PublicHeader.vue'
import PublicFooter from '@/components/public/PublicFooter.vue'
import { usePublicContentStore } from '@/stores/publicContent.js'
import { createPublicLayoutPublication } from '@/stores/publicHomePublication.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'

export default {
  name: 'PublicLayout',
  setup() {
    const store = usePublicContentStore()
    const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => { const { createPublishedDocumentCodec } = await import('@/utils/public-document.js'); return createPublishedDocumentCodec() } })
    const publication = lifecycle.publication
    const ready = lifecycle.siteReady
    const shellLinks = computed(() => publication.value?.home.value?.shellLinks || [])
    provide('public-home-publication', { store, publication, ready, loadHome: lifecycle.loadHome, loadPage: lifecycle.loadPage })
    const { t } = usePublicI18n()
    onMounted(lifecycle.init)
    onUnmounted(lifecycle.dispose)
    return () => h('div', { class: 'public-layout public-shell' }, [
      h('a', { class: 'public-skip-link', href: '#public-content' }, t('skip')),
      h(PublicHeader, { links: shellLinks.value }),
      h('main', { id: 'public-content', tabindex: '-1' }, h(RouterView)),
      h(PublicFooter, { links: shellLinks.value }),
    ])
  },
}
</script>
