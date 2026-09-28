<script>
import { h, onMounted, onUnmounted, provide } from 'vue'
import PublicHeader from '@/components/public/PublicHeader.vue'
import PublicFooter from '@/components/public/PublicFooter.vue'
import RouteViewTransition from '@/components/shell/RouteViewTransition.vue'
import { usePublicContentStore } from '@/stores/publicContent.js'
import { createPublicHomeContentState } from '@/stores/publicHomeContent.js'
import { createPublicLayoutPublication } from '@/stores/publicHomePublication.js'
import { publicContentApi } from '@/api/publicContent.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'

export default {
  name: 'PublicLayout',
  setup() {
    const store = usePublicContentStore()
    const homeContent = createPublicHomeContentState({ api: publicContentApi })
    const lifecycle = createPublicLayoutPublication({ store, homeContent })
    const publication = lifecycle.publication
    const ready = lifecycle.siteReady
    provide('public-home-publication', { store, homeContent, publication, ready, loadHome: lifecycle.loadHome, loadPage: lifecycle.loadPage })
    const { t } = usePublicI18n()
    onMounted(lifecycle.init)
    onUnmounted(lifecycle.dispose)
    return () => h('div', { class: 'public-layout public-shell' }, [
      h('a', { class: 'public-skip-link', href: '#public-content' }, t('skip')),
      h(PublicHeader),
      h('main', { id: 'public-content', tabindex: '-1' }, h(RouteViewTransition, { focusTarget: '#public-content', keyMode: 'pathQuery' })),
      h(PublicFooter),
    ])
  },
}
</script>
