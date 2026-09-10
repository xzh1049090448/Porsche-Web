import { h } from 'vue'
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import { safeAuthRedirect } from '../utils/auth-redirect.js'

const publicPlaceholder = title => () => Promise.resolve({
  name: `${title.replace(/\s+/g, '')}Placeholder`,
  render: () => h('section', { class: 'public-page-placeholder', 'aria-labelledby': 'public-placeholder-title' }, [
    h('h1', { id: 'public-placeholder-title' }, title),
    h('p', '公开内容准备中'),
  ]),
})

const mainLayout = () => import('@/layouts/MainLayout.vue')

export const routes = [
  {
    path: '/', component: () => import('@/layouts/PublicLayout.vue'), meta: { public: true }, children: [
      { path: '', name: 'PublicHome', component: publicPlaceholder('首页') },
      { path: 'pricing', name: 'PublicPricing', component: publicPlaceholder('模型价格') },
      { path: 'pricing/:modelKey', name: 'PublicPricingDetail', component: publicPlaceholder('模型价格详情') },
      { path: 'about', name: 'PublicAbout', component: publicPlaceholder('关于') },
      { path: 'terms', name: 'PublicTerms', component: publicPlaceholder('服务协议') },
      { path: 'privacy', name: 'PublicPrivacy', component: publicPlaceholder('隐私政策') },
      { path: ':pathMatch(.*)*', name: 'PublicNotFound', component: () => import('@/views/PublicNotFound.vue') },
    ],
  },
  { path: '/login', name: 'Login', component: () => import('@/views/Login.vue'), meta: { guest: true } },
  { path: '/register', name: 'Register', component: () => import('@/views/Register.vue'), meta: { guest: true } },
  { path: '/chat', component: mainLayout, meta: { requiresAuth: true }, children: [
    { path: '', name: 'Chat', component: () => import('@/views/Chat.vue') },
  ] },
  { path: '/users', component: mainLayout, meta: { requiresAuth: true }, children: [
    { path: '', name: 'Users', component: () => import('@/views/Users.vue') },
    { path: ':guid', name: 'UserDetail', component: () => import('@/views/UserDetail.vue') },
  ] },
  { path: '/profile', component: mainLayout, meta: { requiresAuth: true }, children: [
    { path: '', name: 'Profile', component: () => import('@/views/Profile.vue') },
  ] },
  { path: '/billing', component: mainLayout, meta: { requiresAuth: true }, children: [
    { path: '', name: 'Billing', component: () => import('@/views/Billing.vue') },
  ] },
  { path: '/api-keys', component: mainLayout, meta: { requiresAuth: true }, children: [
    { path: '', name: 'ApiKeys', component: () => import('@/views/ApiKeys.vue') },
  ] },
]

export function installAuthGuard(router, loadUserStore = async () => {
  const { useUserStore } = await import('@/stores/user')
  return useUserStore()
}) {
  router.beforeEach(async (to) => {
    if (!to.meta.requiresAuth && !to.meta.guest) return true
    const userStore = await loadUserStore()
    await userStore.ensureSession()
    if (to.meta.requiresAuth && !userStore.isLoggedIn) return { name: 'Login', query: { redirect: to.fullPath } }
    if (to.meta.guest && userStore.isLoggedIn) return { path: '/chat' }
    if (to.name === 'Login') {
      const redirect = safeAuthRedirect(to.query.redirect)
      if (to.query.redirect !== redirect) {
        return { name: 'Login', query: { ...to.query, redirect }, replace: true }
      }
    }
    return true
  })
  return router
}

const AUTH_BOOTSTRAP_PATH = /^\/(?:login|register|chat|profile|billing|api-keys|users)(?:\/|$)/i
const LAZY_RELOAD_MARKER = 'public_route_lazy_reload_v1'
const LAZY_LOAD_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk .+ failed|ChunkLoadError/i

export function bootstrapModeForPath(path = '/') {
  let pathname
  try { pathname = new URL(path, 'https://bootstrap.invalid').pathname }
  catch { return 'public' }
  return AUTH_BOOTSTRAP_PATH.test(pathname) ? 'auth' : 'public'
}

export function installBootstrapHandoff(router, { mode, handoff } = {}) {
  if (!mode || typeof handoff !== 'function') return router
  router.beforeEach(to => {
    const targetMode = to.meta.public ? 'public' : 'auth'
    if (targetMode === mode) return true
    handoff(to.fullPath)
    return false
  })
  return router
}

export function createLazyLoadFailureHandler({ storage, reload, fallback } = {}) {
  return error => {
    if (!LAZY_LOAD_ERROR.test(String(error?.message || error))) return false
    if (storage?.getItem(LAZY_RELOAD_MARKER) !== 'attempted') {
      storage?.setItem(LAZY_RELOAD_MARKER, 'attempted')
      reload?.()
    } else {
      storage?.removeItem(LAZY_RELOAD_MARKER)
      fallback?.()
    }
    return true
  }
}

function renderSafeLoadError() {
  const host = document.querySelector('#app')
  if (!host) return
  host.replaceChildren()
  const main = document.createElement('main')
  const heading = document.createElement('h1')
  heading.textContent = '页面暂时无法加载'
  const detail = document.createElement('p')
  detail.textContent = '请刷新后重试，或返回首页。'
  const home = document.createElement('a')
  home.href = '/'
  home.textContent = '返回首页'
  main.append(heading, detail, home)
  host.append(main)
}

export function createAppRouter(
  history = typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  options = {},
) {
  const router = createRouter({ history, routes })
  const mode = options.bootstrapMode ?? (typeof window === 'undefined' ? 'public' : bootstrapModeForPath(window.location.pathname))
  installBootstrapHandoff(router, {
    mode,
    handoff: options.handoff ?? (path => window.location.assign(path)),
  })
  installAuthGuard(router, options.loadUserStore)
  const storage = options.storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage)
  const handleLazyFailure = createLazyLoadFailureHandler({
    storage,
    reload: options.reload ?? (() => window.location.reload()),
    fallback: options.lazyFallback ?? renderSafeLoadError,
  })
  router.onError(handleLazyFailure)
  router.afterEach(() => storage?.removeItem(LAZY_RELOAD_MARKER))
  return router
}

export default createAppRouter()
