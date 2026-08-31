const SESSION_FIELDS = {
  guid: 'guid',
  login_method: 'loginMethod',
  ip: 'ip',
  user_agent: 'userAgent',
  created_at: 'createdAt',
  last_active_at: 'lastActiveAt',
  expires_at: 'expiresAt',
  current: 'current',
}

const SESSION_USER_FIELDS = ['guid', 'username', 'nickname', 'role', 'status']

/** Returns only the documented, browser-safe representation of an authenticated user. */
export function sessionUser(user) {
  if (!user || typeof user !== 'object') return null
  return Object.fromEntries(SESSION_USER_FIELDS
    .filter((field) => Object.hasOwn(user, field))
    .map((field) => [field, user[field]]))
}

/**
 * Creates the browser-side, in-memory authentication state shared by Axios
 * and Pinia. Refresh material deliberately remains an HttpOnly cookie.
 */
export function createAuthSessionManager({ refresh } = {}) {
  let currentAccessToken = null
  let currentUser = null
  let refreshPromise = null
  const listeners = new Set()

  function notify() {
    listeners.forEach((listener) => listener({ accessToken: currentAccessToken, user: currentUser }))
  }

  function setSession({ accessToken, user }) {
    currentAccessToken = typeof accessToken === 'string' && accessToken ? accessToken : null
    currentUser = sessionUser(user)
    notify()
  }

  function clearSession() {
    currentAccessToken = null
    currentUser = null
    notify()
  }

  async function refreshAndRetry(config, retry) {
    if (!refreshPromise) {
      refreshPromise = Promise.resolve()
        .then(() => refresh?.())
        .then((response) => {
          const data = response?.data ?? response
          if (!data?.access_token || !data?.user) throw new Error('refresh response is invalid')
          setSession({ accessToken: data.access_token, user: data.user })
          return data
        })
        .catch((error) => {
          clearSession()
          throw error
        })
        .finally(() => { refreshPromise = null })
    }
    await refreshPromise
    const headers = { ...(config.headers || {}), Authorization: `Bearer ${currentAccessToken}` }
    return retry({ ...config, headers, __authRetried: true })
  }

  return {
    accessToken: () => currentAccessToken,
    user: () => currentUser,
    setSession,
    clearSession,
    refreshAndRetry,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * Runs a fetch request with the transient Bearer token, refreshing exactly
 * once after a protected-request 401. Callers never handle refresh cookies.
 */
export async function authenticatedFetch(auth, input, init = {}, { fetchImpl = fetch, onUnauthorized } = {}) {
  const requestUrl = typeof input === 'string' ? input : input?.url || ''
  const isAuthRequest = requestUrl.includes('/auth/')

  const send = async (retried = false) => {
    const headers = new Headers(init.headers || {})
    const token = auth.accessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetchImpl(input, { ...init, headers })
    if (response.status !== 401 || isAuthRequest) return response

    if (retried || !token) {
      auth.clearSession()
      await onUnauthorized?.()
      const error = new Error('unauthorized')
      error.authHandled = true
      throw error
    }

    try {
      return await auth.refreshAndRetry({ headers }, () => send(true))
    } catch (error) {
      if (!error?.authHandled) await onUnauthorized?.()
      throw error
    }
  }

  return send()
}

/** Filters the session API response before reactive UI state receives it. */
export function sessionRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => Object.fromEntries(Object.entries(SESSION_FIELDS)
    .filter(([field]) => Object.hasOwn(row || {}, field))
    .map(([field, name]) => [name, row[field]])))
}
