<script>
import { h } from 'vue'
import { RouterLink } from 'vue-router'
import { usePublicI18n } from '@/i18n/public-runtime.js'
export default {
  setup() {
    const { t } = usePublicI18n()
    const link = (to, label) => h(RouterLink, { to }, () => label)
    return () => h('footer', { class: 'public-footer' }, [h('div', { class: 'public-footer__inner' }, [
      h('strong', { class: 'public-footer__brand' }, [h('span', { class: 'public-brand__mark', 'aria-hidden': 'true' }, 'AI'), h('span', 'Porsche')]),
      h('nav', { 'aria-label': t('menu') }, [link('/about', t('about')), link('/pricing', t('pricing')), link('/terms', t('terms')), link('/privacy', t('privacy'))]),
    ])])
  },
}
</script>
