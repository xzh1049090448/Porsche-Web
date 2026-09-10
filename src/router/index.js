import { h } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { safeAuthRedirect } from '@/utils/auth-redirect'

const publicPlaceholder = title => () => Promise.resolve({
  name: `${title.replace(/\s+/g, '')}Placeholder`,
  render: () => h('section', { class: 'public-page-placeholder', 'aria-labelledby': 'public-placeholder-title' }, [
    h('h1', { id: 'public-placeholder-title' }, title),
    h('p', '公开内容准备中'),
  ]),
})

const routes = [
  { path: '/login', name: 'Login', component: () => import('@/views/Login.vue'), meta: { guest: true } },
  { path: '/register', name: 'Register', component: () => import('@/views/Register.vue'), meta: { guest: true } },
  {
    path: '/', component: () => import('@/layouts/MainLayout.vue'), meta: { requiresAuth: true }, children: [
      { path: 'chat', name: 'Chat', component: () => import('@/views/Chat.vue') },
      { path: 'users', name: 'Users', component: () => import('@/views/Users.vue') },
      { path: 'users/:guid', name: 'UserDetail', component: () => import('@/views/UserDetail.vue') },
      { path: 'profile', name: 'Profile', component: () => import('@/views/Profile.vue') },
      { path: 'billing', name: 'Billing', component: () => import('@/views/Billing.vue') },
      { path: 'api-keys', name: 'ApiKeys', component: () => import('@/views/ApiKeys.vue') },
    ],
  },
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
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  const userStore = useUserStore()
  if (to.meta.requiresAuth || to.meta.guest) await userStore.ensureSession()
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

export default router
