<script>
import { h, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { usePublicI18n } from '@/i18n/public-runtime.js'

const PUBLIC_LINK_BASE = 'https://public.invalid'
const SAFE_HASH_LINK = /^#[A-Za-z][A-Za-z0-9._:-]*$/
export function classifyPublicLink(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value || /[\s\u0000-\u001f\u007f\\]/.test(value)) return { kind: 'blocked' }
  if (SAFE_HASH_LINK.test(value)) return { kind: 'internal', href: value }
  if (value.startsWith('/') && !value.startsWith('//')) {
    const url = new URL(value, PUBLIC_LINK_BASE)
    if (url.origin === PUBLIC_LINK_BASE) return { kind: 'internal', href: value }
  }
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && url.host) return { kind: 'external', href: value }
  } catch {}
  return { kind: 'blocked' }
}

export default {
  name: 'PublicHeader',
  props: { links: { type: Array, default: () => [] } },
  setup(props) {
    const menuOpen = ref(false)
    const scrolled = ref(false)
    const toggleButton = ref()
    const navElement = ref()
    const navId = 'public-mobile-nav'
    const { t, toggle } = usePublicI18n()
    const closeMenu = () => { menuOpen.value = false }
    const menuItems = () => [...(navElement.value?.querySelectorAll('a[href], button:not([disabled])') || [])]
    const toggleMenu = () => { menuOpen.value = !menuOpen.value; if (menuOpen.value) nextTick(() => menuItems()[0]?.focus()) }
    const handleDocumentKey = event => {
      if (!menuOpen.value) return
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); toggleButton.value?.focus(); return }
      if (event.key !== 'Tab') return
      const items = menuItems(); if (!items.length) return
      const first = items[0]; const last = items.at(-1); const active = document.activeElement
      if (!navElement.value?.contains(active) || (!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus()
      }
    }
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
    onMounted(() => { desktop = matchMedia('(min-width: 768px)'); desktop.onchange = handleBreakpoint; handleBreakpoint(desktop); handleScroll(); window.addEventListener('scroll', handleScroll, { passive: true }); document.addEventListener('keydown', handleDocumentKey) })
    onUnmounted(() => { removeRouteHook(); if (desktop) desktop.onchange = null; window.removeEventListener('scroll', handleScroll); document.removeEventListener('keydown', handleDocumentKey) })

    const link = (to, label, attrs = {}) => h(RouterLink, { to, onClick: closeMenu, ...attrs }, () => label)
    const publishedLink = item => {
      const target = classifyPublicLink(item.href)
      if (target.kind === 'internal') return link(target.href, item.label)
      if (target.kind === 'external') return h('a', { href: target.href, target: '_blank', rel: 'noopener noreferrer', onClick: closeMenu }, item.label)
      return h('span', { class: 'public-nav__blocked' }, item.label)
    }
    return () => {
      const navLinks = [
        link('/#advantages', t('advantages')),
        link('/#models', t('models')),
        link('/pricing', t('pricing')),
        ...props.links.filter(item => item.placement === 'header').map(publishedLink),
        link('/about', t('about')),
        link('/chat', t('console'), { class: 'public-button public-button--small public-console-cta' }),
      ]
      return h('header', { class: ['public-header', { 'is-scrolled': scrolled.value }] }, [
        h('div', { class: 'public-header__primary' }, [
          link('/', [h('span', { class: 'public-brand__mark', 'aria-hidden': 'true' }, 'AI'), h('span', { class: 'public-brand__name' }, 'Porsche')], { class: 'public-brand', 'aria-label': t('home') }),
          h('button', { ref: toggleButton, type: 'button', class: 'public-nav-toggle', 'aria-expanded': menuOpen.value, 'aria-controls': navId, onClick: toggleMenu }, [h('span', { 'aria-hidden': 'true' }, '☰'), h('span', { class: 'sr-only' }, t('menu'))]),
          h('nav', { ref: navElement, id: navId, class: ['public-nav', { 'is-open': menuOpen.value }], 'aria-label': t('menu') }, navLinks),
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
