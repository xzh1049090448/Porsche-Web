/** Mock has no server cookie session; production keeps the unmodified HTTP refresh path. */
export function createSessionRefresh({ useMock, transport }) {
  return async () => {
    if (useMock) {
      throw Object.assign(new Error('No mock session to restore'), {
        response: { status: 401, data: { error: { code: 'auth_invalid_refresh' } } },
      })
    }
    return (await transport.post('/api/v1/auth/refresh')).data
  }
}

/** Recovery uses the cookie transport directly so normal auth interceptors cannot recurse. */
export function createSessionRecovery({ useMock, transport }) {
  const refresh = createSessionRefresh({ useMock, transport })
  return {
    refresh,
    async logout(accessToken) {
      if (useMock) {
        throw Object.assign(new Error('Mock logout recovery is unavailable'), {
          code: 'auth_recovery_unsupported',
        })
      }
      const response = await transport.post('/api/v1/auth/logout', undefined, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { status: response.status }
    },
  }
}
