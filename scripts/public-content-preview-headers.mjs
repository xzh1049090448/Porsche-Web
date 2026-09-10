export function publicContentPreviewHeaders(pathname) {
  return pathname === '/admin/public-content/preview'
    ? { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
    : null
}
