const PREFIX = '/api/v1/platform'

/** Matches the platform's opaque model-ID boundary before a detail request. */
export function isSafePlatformModelID(id) {
  if (typeof id !== 'string' || id === '' || id.trim() !== id) return false
  if (new TextEncoder().encode(id).length > 256) return false
  if (/[\s\p{Cc}\p{Cf}\\?#%]/u.test(id)) return false

  return !id.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
}

/** Fetches one authorized platform model without putting its upstream ID in the path. */
export async function getPlatformModelDetail(id, request, mapCatalog) {
  if (!isSafePlatformModelID(id)) return null

  const params = new URLSearchParams({ id })
  const res = await request.get(`${PREFIX}/models/detail?${params}`)
  return mapCatalog({ data: [res] })[0] || null
}
