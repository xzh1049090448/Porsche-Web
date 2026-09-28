export function publicContentPreviewHeaders(pathname) {
  return pathname === '/admin/public-content/preview'
    ? { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
    : null
}

export function protectPublicContentPreviewResponse(req, res, next) {
  const headers = publicContentPreviewHeaders(new URL(req.url || '/', 'http://local.invalid').pathname)
  if (!headers) return next()
  const applyHeaders = () => {
    if (res.headersSent) return
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  }
  const writeHead = res.writeHead
  const end = res.end
  res.writeHead = function (...args) { applyHeaders(); return writeHead.apply(this, args) }
  res.end = function (...args) { applyHeaders(); return end.apply(this, args) }
  next()
}

export function publicContentPreviewProtection() {
  const install = server => { server.middlewares.use(protectPublicContentPreviewResponse) }
  return { name: 'public-content-preview-protection', configureServer: install, configurePreviewServer: install }
}
