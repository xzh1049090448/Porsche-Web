<script>
import { h } from 'vue'
import { usePublicI18n } from '@/i18n/public-runtime.js'
export default {
  props: { links: { type: Array, default: () => [] } },
  setup(props) {
    const { t } = usePublicI18n()
    const link = (href, label) => h('a', { href }, label)
    return () => h('footer', { class: 'public-footer' }, [
      h('strong', { class: 'public-footer__brand' }, 'Porsche'),
      h('nav', { 'aria-label': t('menu') }, [link('/about', t('about')), link('/terms', t('terms')), link('/privacy', t('privacy')), ...props.links.filter(item => item.placement === 'contact').map(item => h('a', { href: item.href }, item.label))]),
    ])
  },
}
</script>
