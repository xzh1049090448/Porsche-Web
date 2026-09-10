const DEFAULT_AUTHENTICATED_PATH = '/chat'
const AUTH_LOOP_PATH = /^\/(?:login|register)(?:\/|$)/i

function decodedVariants(value) {
  const variants = [value]
  let current = value
  for (let depth = 0; depth < 3; depth += 1) {
    const decoded = decodeURIComponent(current)
    if (decoded === current) break
    variants.push(decoded)
    current = decoded
  }
  return variants
}

export function safeAuthRedirect(value, fallback = DEFAULT_AUTHENTICATED_PATH) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return fallback

  let variants
  try {
    variants = decodedVariants(value)
  } catch {
    return fallback
  }

  for (const candidate of variants) {
    if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback
    if (candidate.includes('\\') || /[\u0000-\u001f\u007f]/.test(candidate)) return fallback
  }

  const decoded = variants.at(-1)
  let target
  try {
    target = new URL(decoded, 'https://auth-redirect.invalid')
  } catch {
    return fallback
  }
  if (target.origin !== 'https://auth-redirect.invalid') return fallback
  if (AUTH_LOOP_PATH.test(target.pathname)) return fallback
  return value
}

let handling = false

/** Token 无效或过期：清理会话并跳转登录页 */
export async function handleUnauthorized(message) {
  const [elementPlus, routerModule, localeModule] = await Promise.all([
    import('element-plus'),
    import('@/router'),
    import('@/stores/locale'),
  ])
  const router = routerModule.default
  const fallback = localeModule.useLocaleStore().t('auth.sessionExpired')
  if (handling) return

  handling = true
  try {
    const { useUserStore } = await import('@/stores/user')
    useUserStore().clearSession()

    if (router.currentRoute.value.name === 'Login') return

    elementPlus.ElMessage.warning(message || fallback)

    const { fullPath, meta } = router.currentRoute.value
    const redirect = meta.requiresAuth ? safeAuthRedirect(fullPath) : undefined
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
