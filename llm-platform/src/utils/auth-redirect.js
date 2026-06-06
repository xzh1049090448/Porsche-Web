import { ElMessage } from 'element-plus'
import router from '@/router'

let handling = false

/** Token 无效或过期：清理会话并跳转登录页 */
export async function handleUnauthorized(message = '登录已过期，请重新登录') {
  if (handling) return

  handling = true
  try {
    const { useUserStore } = await import('@/stores/user')
    useUserStore().clearSession()

    if (router.currentRoute.value.name === 'Login') return

    ElMessage.warning(message)

    const { fullPath, meta } = router.currentRoute.value
    const redirect = meta.requiresAuth ? fullPath : undefined
    await router.push({
      name: 'Login',
      query: redirect ? { redirect } : {},
    })
  } finally {
    handling = false
  }
}

export function isAuthRequestUrl(url = '') {
  return url.includes('/auth/')
}
