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
    currentUser = user && typeof user === 'object' ? { ...user } : null
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

/** Filters the session API response before reactive UI state receives it. */
export function sessionRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => Object.fromEntries(Object.entries(SESSION_FIELDS)
    .filter(([field]) => Object.hasOwn(row || {}, field))
    .map(([field, name]) => [name, row[field]])))
}
