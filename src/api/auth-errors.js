/** 90abbdc middleware is the only recoverable business-request 401 envelope. */
export function isRecoverableAccessFailure(status, data) {
  return status === 401 && data && !data.error && ['Token无效或已过期', '未登录'].includes(data.detail)
}

/** Only JSON message/detail fields enter UI; HTML/text/Blob bodies stay generic. */
export function authErrorMessage(error) {
  const body = error?.response?.data
  if (!body || typeof body !== 'object' || (typeof Blob !== 'undefined' && body instanceof Blob)) return '请求失败，请稍后重试'
  const payload = body.error && typeof body.error === 'object' ? body.error : body
  const detail = payload.detail ?? body.detail
  const value = typeof detail === 'string' ? detail : Array.isArray(detail)
    ? detail.map(item => item?.msg || item?.message).filter(item => typeof item === 'string').join('; ')
    : payload.message ?? body.message
  return typeof value === 'string' && value.length <= 500 ? value : '请求失败，请稍后重试'
}
