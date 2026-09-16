<script>
import { h } from 'vue'
import { RouterLink } from 'vue-router'
import AppBrand from '@/components/shell/AppBrand.vue'
import { usePublicI18n } from '@/i18n/public-runtime.js'
export default {
  setup() {
    const { t, app } = usePublicI18n()
    const link = (to, label) => h(RouterLink, { to }, () => label)
    return () => h('footer', { class: 'public-footer' }, [h('div', { class: 'public-footer__inner' }, [
      h(AppBrand, { class: 'public-footer__brand', title: app('title'), subtitle: app('subtitle') }),
      h('nav', { 'aria-label': t('menu') }, [link('/about', t('about')), link('/pricing', t('pricing')), link('/terms', t('terms')), link('/privacy', t('privacy'))]),
    ])])
  },
}
</script>
