import { isSafeAuthRead } from './auth-session.js'

import { isRecoverableAccessFailure } from './auth-errors.js'

/** Axios integration remains injectable and tested with actual interceptors. */
export function installAuthInterceptors(request, auth, { onUnauthorized, onError } = {}) {
  request.interceptors.request.use(config => {
    config.__authContext ||= auth.capture()
    auth.assertCurrent(config.__authContext)
    const token = auth.accessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    else delete config.headers.Authorization
    return config
  })
  request.interceptors.response.use(
    res => { auth.assertCurrent(res.config.__authContext); return res.data },
    async error => {
      const config = error.config
      if (!config) throw error
      auth.assertCurrent(config.__authContext)
      if (isRecoverableAccessFailure(error.response?.status, error.response?.data) && isSafeAuthRead(config.url, config.method) && config.__authContext.token) {
        if (!config.__authRetried) {
          try { return await auth.refreshAndRetry(config, retry => request.request(retry)) }
          catch (refreshError) {
            if (auth.state() === 'anonymous') await onUnauthorized?.()
            throw refreshError
          }
        }
        auth.clearSession()
        await onUnauthorized?.()
      } else if (error.response?.status !== 401) onError?.(error)
      throw error
    },
  )
}
