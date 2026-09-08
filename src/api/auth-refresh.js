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
