<script>
import { h } from 'vue'
import { RouterLink } from 'vue-router'
import { usePublicI18n } from '@/i18n/public-runtime.js'
import { classifyPublicLink } from './PublicHeader.vue'
export default {
  props: { links: { type: Array, default: () => [] } },
  setup(props) {
    const { t } = usePublicI18n()
    const link = (to, label) => h(RouterLink, { to }, () => label)
    const publishedLink = item => {
      const target = classifyPublicLink(item.href)
      if (target.kind === 'internal') return link(target.href, item.label)
      if (target.kind === 'blocked') return h('span', { class: 'public-footer__blocked' }, item.label)
      const anchor = h('a', { href: item.href }, item.label)
      Object.assign(anchor.props, { target: '_blank', rel: 'noopener noreferrer' })
      return anchor
    }
    return () => h('footer', { class: 'public-footer' }, [h('div', { class: 'public-footer__inner' }, [
      h('strong', { class: 'public-footer__brand' }, [h('span', { class: 'public-brand__mark', 'aria-hidden': 'true' }, 'AI'), h('span', 'Porsche')]),
      h('nav', { 'aria-label': t('menu') }, [link('/about', t('about')), link('/pricing', t('pricing')), link('/terms', t('terms')), link('/privacy', t('privacy')), ...props.links.filter(item => item.placement === 'contact').map(publishedLink)]),
    ])])
  },
}
</script>
