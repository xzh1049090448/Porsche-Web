/** Remove any accidental secret fields before token data enters component state. */
export function tokenRows(tokens = []) {
  return tokens.map(({ token, token_hash, ...tokenData }) => ({
    ...tokenData,
    tokenPrefix: tokenData.token_prefix || '',
    allowedModels: Array.isArray(tokenData.allowed_models) ? tokenData.allowed_models : [],
    ipAllowlist: Array.isArray(tokenData.ip_allowlist) ? tokenData.ip_allowlist : [],
  }))
}

/** Derive display-only status totals from the sanitized list response. */
export function apiKeySummary(rows, now = new Date()) {
  const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    active: rows.filter((row) => tokenStatus(row, now) === 'active').length,
    revoked: rows.filter((row) => row.status === 'revoked').length,
    expiring: rows.filter((row) => {
      if (tokenStatus(row, now) !== 'active' || !row.expires_at) return false
      const expiresAt = new Date(row.expires_at)
      return expiresAt > now && expiresAt <= deadline
    }).length,
  }
}

/** Accept only IPv4/IPv6 address literals; Gateway intentionally does not support CIDR ranges. */
export function isLiteralIP(ip) {
  if (!ip || ip.includes('/') || ip.includes('%')) return false
  const ipv4 = ip.split('.')
  if (ipv4.length === 4 && ipv4.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) return true
  if (!ip.includes(':') || !/^[0-9a-fA-F:]+$/.test(ip)) return false
  const halves = ip.split('::')
  if (halves.length > 2) return false
  const groups = halves.flatMap((half) => half ? half.split(':') : [])
  if (!groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return false
  return halves.length === 2 ? groups.length < 8 : groups.length === 8
}

/** A server-active key is no longer usable once its expiry time has passed. */
export function tokenStatus(row, now = new Date()) {
  if (row.status === 'active' && row.expires_at && new Date(row.expires_at) <= now) return 'expired'
  return row.status
}
