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

export function createAppRouter(history = typeof window === 'undefined' ? createMemoryHistory() : createWebHistory()) {
  return installAuthGuard(createRouter({ history, routes }))
}

export default createAppRouter()
