import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const routes = [
  { path: '/login', name: 'Login', component: () => import('@/views/Login.vue'), meta: { guest: true } },
  { path: '/register', name: 'Register', component: () => import('@/views/Register.vue'), meta: { guest: true } },
  {
    path: '/', component: () => import('@/layouts/MainLayout.vue'), meta: { requiresAuth: true }, children: [
      { path: '', name: 'Chat', component: () => import('@/views/Chat.vue') },
      { path: 'profile', name: 'Profile', component: () => import('@/views/Profile.vue') },
      { path: 'billing', name: 'Billing', component: () => import('@/views/Billing.vue') },
      { path: 'api-keys', name: 'ApiKeys', component: () => import('@/views/ApiKeys.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  const userStore = useUserStore()
  if (to.meta.requiresAuth && !userStore.isLoggedIn) await userStore.restoreSession()
  if (to.meta.requiresAuth && !userStore.isLoggedIn) return { name: 'Login', query: { redirect: to.fullPath } }
  if (to.meta.guest && userStore.isLoggedIn) return { path: '/' }
  return true
})

export default router
