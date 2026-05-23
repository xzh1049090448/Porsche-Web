import { createRouter, createWebHistory } from 'vue-router'
import { getItem } from '@/utils/storage'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { guest: true },
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'Chat', component: () => import('@/views/Chat.vue') },
      { path: 'profile', name: 'Profile', component: () => import('@/views/Profile.vue') },
      { path: 'billing', name: 'Billing', component: () => import('@/views/Billing.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const token = getItem('token')
  if (to.meta.requiresAuth && !token) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guest && token) {
    return { path: '/' }
  }
  return true
})

export default router
