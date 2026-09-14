<script>
import { h, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { usePublicI18n } from '@/i18n/public-runtime.js'

export default {
  name: 'PublicHeader',
  props: { links: { type: Array, default: () => [] } },
  setup(props) {
    const menuOpen = ref(false)
    const scrolled = ref(false)
    const toggleButton = ref()
    const navId = 'public-mobile-nav'
    const { t, toggle } = usePublicI18n()
    const closeMenu = () => { menuOpen.value = false }
    const handleEscape = event => { if (event.key === 'Escape' && menuOpen.value) { closeMenu(); toggleButton.value?.focus() } }
    const toggleTheme = event => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = theme
      event.currentTarget.setAttribute('aria-pressed', theme === 'dark')
      try { localStorage.setItem('llm_platform_uiTheme', JSON.stringify(theme)) } catch {}
    }
    const handleBreakpoint = event => { if (event.matches) closeMenu() }
    const handleScroll = () => { scrolled.value = window.scrollY > 4 }
    let desktop
    const removeRouteHook = useRouter().afterEach(closeMenu)
    onMounted(() => { desktop = matchMedia('(min-width: 768px)'); desktop.onchange = handleBreakpoint; handleBreakpoint(desktop); handleScroll(); window.addEventListener('scroll', handleScroll, { passive: true }) })
    onUnmounted(() => { removeRouteHook(); if (desktop) desktop.onchange = null; window.removeEventListener('scroll', handleScroll) })

    const link = (to, label, attrs = {}) => h(RouterLink, { to, onClick: closeMenu, ...attrs }, () => label)
    const publishedLink = item => {
      const external = /^https?:/.test(item.href)
      return h('a', { href: item.href, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}), onClick: closeMenu }, item.label)
    }
    return () => {
      const navLinks = [
        h('a', { href: '/#advantages', onClick: closeMenu }, t('advantages')),
        h('a', { href: '/#models', onClick: closeMenu }, t('models')),
        link('/pricing', t('pricing')),
        ...props.links.filter(item => item.placement === 'header').map(publishedLink),
        link('/about', t('about')),
        link('/chat', t('console'), { class: 'public-button public-button--small public-console-cta' }),
      ]
      return h('header', { class: ['public-header', { 'is-scrolled': scrolled.value }], onKeydown: handleEscape }, [
        h('div', { class: 'public-header__primary' }, [
          link('/', [h('span', { class: 'public-brand__mark', 'aria-hidden': 'true' }, 'AI'), h('span', { class: 'public-brand__name' }, 'Porsche')], { class: 'public-brand', 'aria-label': t('home') }),
          h('button', { ref: toggleButton, type: 'button', class: 'public-nav-toggle', 'aria-expanded': menuOpen.value, 'aria-controls': navId, onClick: () => { menuOpen.value = !menuOpen.value } }, [h('span', { 'aria-hidden': 'true' }, '☰'), h('span', { class: 'sr-only' }, t('menu'))]),
          h('nav', { id: navId, class: ['public-nav', { 'is-open': menuOpen.value }], 'aria-label': t('menu') }, navLinks),
        ]),
        h('div', { class: 'public-header__actions' }, [
          h('button', { type: 'button', class: 'public-locale', 'aria-label': t('language'), onClick: toggle }, t('language')),
          h('button', { type: 'button', class: 'public-theme', 'aria-label': '切换主题 / Switch theme', 'aria-pressed': document.documentElement.dataset.theme === 'dark', onClick: toggleTheme }, '◐'),
        ]),
      ])
    }
  },
}
</script>
