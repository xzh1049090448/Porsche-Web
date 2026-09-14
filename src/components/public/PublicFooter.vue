<script>
import { h } from 'vue'
import { RouterLink } from 'vue-router'
import { usePublicI18n } from '@/i18n/public-runtime.js'
export default {
  props: { links: { type: Array, default: () => [] } },
  setup(props) {
    const { t } = usePublicI18n()
    const link = (to, label) => h(RouterLink, { to }, () => label)
    const publishedLink = item => {
      const external = /^https?:/.test(item.href)
      if (!external) return h('a', { href: item.href }, item.label)
      return h('a', { href: item.href, target: '_blank', rel: 'noopener noreferrer' }, item.label)
    }
    return () => h('footer', { class: 'public-footer' }, [h('div', { class: 'public-footer__inner' }, [
      h('strong', { class: 'public-footer__brand' }, [h('span', { class: 'public-brand__mark', 'aria-hidden': 'true' }, 'AI'), h('span', 'Porsche')]),
      h('nav', { 'aria-label': t('menu') }, [link('/about', t('about')), link('/pricing', t('pricing')), link('/terms', t('terms')), link('/privacy', t('privacy')), ...props.links.filter(item => item.placement === 'contact').map(publishedLink)]),
    ])])
  },
}
</script>
