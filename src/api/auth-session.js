import { isRecoverableAccessFailure } from './auth-errors.js'

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
const ADMIN_CAPABILITIES = new Set(['users.read', 'users.create', 'users.edit', 'users.enable', 'users.disable', 'users.reset_password', 'users.sessions.read', 'users.sessions.revoke', 'users.plan.change', 'users.group.change', 'users.quota.adjust', 'users.delete', 'users.deleted.read', 'users.promote', 'users.demote', 'users.permissions.write', 'users.audit.read', 'groups.read', 'groups.write', 'public_content.read', 'public_content.edit', 'public_content.preview', 'public_content.publish', 'public_content.rollback'])
const MAX_INT64 = '9223372036854775807'
const decimalAtMostInt64 = value => value === '0' || /^[1-9]\d*$/.test(value) && (value.length < MAX_INT64.length || value.length === MAX_INT64.length && value <= MAX_INT64)

/** Returns only the documented, browser-safe representation of an authenticated user. */
export function sessionUser(user) {
  if (!user || typeof user !== 'object') return null
  const result = Object.fromEntries(SESSION_USER_FIELDS
    .filter((field) => Object.hasOwn(user, field))
    .map((field) => [field, user[field]]))
  if (Object.hasOwn(user, 'admin_permissions') || Object.hasOwn(user, 'permissions_version')) {
    const permissions = user.admin_permissions
    const version = user.permissions_version
    const valid = Array.isArray(permissions) && new Set(permissions).size === permissions.length && permissions.every(item => ADMIN_CAPABILITIES.has(item) && item !== 'users.quota.adjust') && typeof version === 'string' && decimalAtMostInt64(version)
    if (valid) { result.admin_permissions = [...permissions]; result.permissions_version = version }
  }
  return result
}

/** Explicit read-only operations allowed to recover once from an expired Access token. */
export function isSafeAuthRead(url = '', method = 'GET') {
  if (method.toUpperCase() !== 'GET') return false
  const parsed = new URL(url, 'https://local.invalid')
  const path = parsed.pathname
  if (path === '/admin/v2/operations') return parsed.search === '?scope=users.delete' || parsed.search === '?scope=users.reset_password'
  return [
    /^\/api\/v1\/users\/me(?:\/usage)?$/,
    /^\/api\/v1\/auth\/(?:self|sessions)$/,
    /^\/api\/v1\/platform\/models(?:\/[^/]+)?$/,
    /^\/api\/v1\/platform\/chat\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    /^\/api\/v1\/conversations(?:\/[^/]+(?:\/export\/markdown)?)?$/,
    /^\/api\/v1\/billing\/(?:plans|usage|orders|invoices)(?:\/[^/]+)?$/,
    /^\/api\/v1\/billing\/analytics\/(?:access|summary|models|export|charts\/[^/]+)$/,
    /^\/api\/v1\/tokens(?:\/[^/]+)?$/,
    /^\/admin\/v2\/notifications(?:\/unread-count)?$/,
  ].some(pattern => pattern.test(path))
}

const failure = code => Object.assign(new Error(code), { code })

/** Validates the agreed LoginResponse before any cookie operation is acknowledged. */
export function validateLoginResponse(data) {
  const user = data?.user
  const nullableString = value => value === null || typeof value === 'string'
  if (typeof data?.access_token !== 'string' || !data.access_token.trim()
      || data.token_type !== 'Bearer' || !Number.isInteger(data.expires_in) || data.expires_in <= 0
      || !user || typeof user !== 'object' || Array.isArray(user)
      || typeof user.guid !== 'string' || !/^[1-9]\d*$/.test(user.guid)
      || !nullableString(user.username) || !nullableString(user.nickname)
      || typeof user.role !== 'string' || typeof user.status !== 'string') {
    throw failure('auth_invalid_response')
  }
  return data
}

const responseStatus = error => error?.response?.status ?? error?.status
const definiteFailure = error => {
  const status = responseStatus(error)
  return status >= 400 && status < 500 && status !== 408
}
const isDefiniteRefreshAnonymous = error => responseStatus(error) === 401
const recoverableKinds = new Set(['login', 'refresh', 'logout'])
const capabilityIssues = new Set([
  'auth_capability_unavailable',
  'auth_insecure_context',
  'auth_web_locks_unavailable',
  'auth_broadcast_channel_unavailable',
  'auth_storage_unavailable',
])

/** Pure authentication state machine. HTTP and browser coordination are injected. */
export function createAuthSessionManager({ refresh, recoverLogout, browser } = {}) {
  let access = null
  let user = null
  let state = 'initializing'
  let epoch = 'initial'
  let sharedEpoch = 'initial'
  let unresolvedEpoch = null
  let generation = 0
  let permissionRevision = 0
  let issue = null
  let refreshPromise = null
  let restorePromise = null
  let logoutPromise = null
  let recoveryPromise = null
  const listeners = new Set()
  const invalidators = new Set()
  const snapshotInvalidators = new Set()
  const id = () => browser?.id?.() || `${Date.now()}-${Math.random()}`
  const notify = () => listeners.forEach(fn => fn({ accessToken: accessToken(), user, state, issue, epoch, generation, permissionRevision }))
  const accessToken = () => ['signingOut', 'uncertain'].includes(state) ? null : access
  const authIssue = () => issue
  const rememberUnresolved = record => {
    if (typeof record?.epoch === 'string' && (record.pending || record.suppressed)) unresolvedEpoch = record.epoch
  }
  const invalidate = () => { epoch = id(); invalidators.forEach(fn => fn()); notify() }
  const uncertain = (code = 'auth_uncertain') => {
    issue = code
    if (state === 'uncertain') { notify(); return }
    access = null; user = null; state = 'uncertain'; invalidate()
  }
  function read() {
    if (!browser?.available) throw failure(browser?.capabilityCode?.() || 'auth_capability_unavailable')
    const record = browser.read()
    if (!record || typeof record.epoch !== 'string') throw failure('auth_coordination_invalid')
    return record
  }
  try {
    const record = read(); epoch = sharedEpoch = record.epoch
    if (record.pending || record.suppressed) { state = 'uncertain'; issue = 'auth_uncertain'; rememberUnresolved(record) }
  } catch (error) { state = 'uncertain'; issue = error?.code || browser?.capabilityCode?.() || 'auth_uncertain' }

  function clearSession() {
    if ((state === 'anonymous' || state === 'uncertain') && !access && !user) return
    access = null; user = null
    if (state !== 'uncertain') { state = 'anonymous'; issue = null; unresolvedEpoch = null }
    invalidate()
  }
  function setSession(next) {
    issue = null; unresolvedEpoch = null
    if (user?.guid !== next.user?.guid) invalidate()
    access = next.accessToken || null; user = sessionUser(next.user); generation++; permissionRevision++
    snapshotInvalidators.forEach(fn => fn())
    state = access && user ? 'authenticated' : 'anonymous'; notify()
  }
  function settleAnonymous(nextEpoch) {
    access = null; user = null; state = 'anonymous'; issue = null; unresolvedEpoch = null
    epoch = sharedEpoch = nextEpoch
    generation++; permissionRevision++
    snapshotInvalidators.forEach(fn => fn())
    notify()
  }
  function settleAuthenticated(data, nextEpoch) {
    access = data.access_token; user = sessionUser(data.user); state = 'authenticated'; issue = null; unresolvedEpoch = null
    epoch = sharedEpoch = nextEpoch
    generation++; permissionRevision++
    snapshotInvalidators.forEach(fn => fn())
    notify()
  }
  function capture() { return { epoch, generation, permissionRevision, token: accessToken() } }
  function assertCurrent(context) {
    // Storage is authoritative even if BroadcastChannel delivery is delayed.
    let record
    try { record = read() } catch { uncertain(); throw failure('auth_coordination_unavailable') }
    if (record.epoch !== sharedEpoch) {
      sharedEpoch = record.epoch; clearSession(); throw failure('identity_changed')
    }
    if (record.suppressed) { uncertain(); throw failure('identity_changed') }
    if (record.pending && record.pending.kind !== 'refresh') throw failure('identity_changed')
    if (context.epoch !== epoch || state === 'signingOut' || state === 'uncertain') throw failure('identity_changed')
  }
  /** Generation closes same-identity races for private profile and admin data. */
  function assertSnapshot(context) {
    assertCurrent(context)
    if (context.generation !== generation || context.permissionRevision !== permissionRevision) throw failure('identity_changed')
  }
  function replacePermissionProjection(context, source) {
    assertSnapshot(context)
    if (!user) return false
    const next = sessionUser({
      ...user,
      admin_permissions: source?.admin_permissions,
      permissions_version: source?.permissions_version,
    })
    const same = next?.permissions_version === user.permissions_version
      && (next?.admin_permissions || []).length === (user.admin_permissions || []).length
      && (next?.admin_permissions || []).every((value, index) => value === user.admin_permissions?.[index])
    if (same) return false
    user = next
    permissionRevision++
    snapshotInvalidators.forEach(fn => fn())
    notify()
    return true
  }

  /** All cookie mutations serialize across tabs. A pending marker survives ambiguous outcomes. */
  async function cookieOperation(kind, action, options = {}) {
    const expected = sharedEpoch
    try {
      read()
      return await browser.lock(async () => {
        const record = read()
        if (record.epoch !== expected) { sharedEpoch = record.epoch; clearSession(); throw failure('identity_changed') }
        if (record.pending || record.suppressed) { uncertain(); throw failure('auth_uncertain') }
        const pending = { operationId: id(), kind, epoch: expected }
        const pendingRecord = { ...record, pending }
        browser.write(pendingRecord) // Must succeed before sending anything.
        rememberUnresolved(pendingRecord)
        const matches = current => current.epoch === pending.epoch && current.pending?.operationId === pending.operationId && current.pending?.epoch === pending.epoch
        try {
          const result = await action(access)
          if (kind === 'login' || kind === 'refresh') validateLoginResponse(result?.data ?? result)
          const current = read()
          if (!matches(current)) { uncertain(); throw failure('auth_uncertain') }
          const identityChange = options.identityChange === true
          const nextEpoch = identityChange ? id() : expected
          browser.write({ epoch: nextEpoch, pending: null, suppressed: false })
          unresolvedEpoch = null
          sharedEpoch = nextEpoch
          if (identityChange) {
            invalidate()
            try { browser.publish?.({ type: 'invalidate', epoch: nextEpoch }) } catch { /* Shared storage remains authoritative if notification fails. */ }
          }
          if (kind === 'login' || kind === 'refresh') {
            const data = result?.data ?? result
            // Logout has already frozen publication, but needs the settled token internally.
            if (state === 'signingOut') { access = data.access_token; generation++ }
            else setSession({ accessToken: data.access_token, user: data.user })
          }
          if (options.clear) clearSession()
          return result
        } catch (error) {
          const current = read()
          if (matches(current)) {
            const next = definiteFailure(error)
              ? { ...current, pending: null, suppressed: kind === 'logout' }
              : { ...current, suppressed: true }
            rememberUnresolved(next)
            browser.write(next)
            if (!next.pending && !next.suppressed) unresolvedEpoch = null
          } else {
            rememberUnresolved(current)
          }
          if (!definiteFailure(error) || kind === 'logout') uncertain()
          else if (kind === 'refresh' || (kind === 'login' && state === 'initializing' && !access && !user)) clearSession()
          throw error
        }
      })
    } catch (error) {
      if (!definiteFailure(error) && error.code !== 'identity_changed') uncertain()
      throw error
    }
  }

  async function refreshAccess() {
    if (!refreshPromise) {
      if (state !== 'signingOut') { state = 'refreshing'; notify() }
      refreshPromise = cookieOperation('refresh', () => refresh?.())
        .finally(() => { refreshPromise = null })
    }
    return refreshPromise
  }
  async function refreshAndRetry(config, retry) {
    const context = config.__authContext || capture()
    assertCurrent(context)
    if (!isSafeAuthRead(config.url, config.method) || config.__authRetried) throw failure('auth_retry_forbidden')
    if (context.generation === generation) await refreshAccess()
    // Keep the caller's epoch: a different account must never retry the
    // original request using its freshly issued credentials.
    assertCurrent(context)
    return retry({ ...config, __authRetried: true, __authContext: capture(), headers: { ...(config.headers || {}), Authorization: `Bearer ${accessToken()}` } })
  }
  async function ensureSession() {
    if (state === 'authenticated') return true
    if (state === 'uncertain' || state === 'signingOut' || state === 'anonymous') return false
    if (!restorePromise) restorePromise = refreshAccess().then(() => true).catch(() => false)
    return restorePromise
  }
  function logout(action) {
    if (logoutPromise) return logoutPromise
    state = 'signingOut'; user = null; invalidate()
    // Internal access survives until any queued refresh finishes under the same shared epoch.
    logoutPromise = cookieOperation('logout', action, { identityChange: true, clear: true })
      .finally(() => { logoutPromise = null })
    return logoutPromise
  }
  const validRecoveryRecord = record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || typeof record.epoch !== 'string' || !record.epoch
        || typeof record.suppressed !== 'boolean'
        || !(record.pending === null || record.pending && typeof record.pending === 'object' && !Array.isArray(record.pending))) return false
    if (record.pending === null) return true
    return typeof record.pending.operationId === 'string' && !!record.pending.operationId
      && recoverableKinds.has(record.pending.kind)
      && record.pending.epoch === record.epoch
  }
  const cleanRecoveryRecord = record => validRecoveryRecord(record) && record.pending === null && record.suppressed === false
  const matchesRecoveryRecord = (current, original) => validRecoveryRecord(current)
    && current.epoch === original.epoch
    && current.suppressed === original.suppressed
    && (original.pending === null
      ? current.pending === null
      : current.pending?.operationId === original.pending.operationId
        && current.pending?.kind === original.pending.kind
        && current.pending?.epoch === original.pending.epoch)

  async function recoverLocked() {
    const priorIssue = issue
    let capability
    try {
      capability = browser?.probe?.() ?? { available: !!browser?.available, code: browser?.capabilityCode?.() || 'auth_capability_unavailable' }
    } catch {
      capability = { available: false, code: browser?.capabilityCode?.() || 'auth_capability_unavailable' }
    }
    if (!capability?.available) {
      const code = capability?.code || 'auth_capability_unavailable'
      uncertain(code)
      throw failure(code)
    }
    try {
      return await browser.lock(async () => {
        const original = read()
        if (!validRecoveryRecord(original)) throw failure('auth_recovery_unsupported')
        if (cleanRecoveryRecord(original) && original.epoch !== (unresolvedEpoch ?? sharedEpoch)) {
          settleAnonymous(original.epoch)
          return { state: 'anonymous', settledElsewhere: true }
        }
        const kind = original.pending?.kind
          || (original.pending === null && original.suppressed ? 'logout' : null)
          || (cleanRecoveryRecord(original) && capabilityIssues.has(priorIssue) ? 'refresh' : null)
        if (!recoverableKinds.has(kind)) throw failure('auth_recovery_unsupported')

        const settle = authenticated => {
          const current = read()
          if (!matchesRecoveryRecord(current, original)) throw failure('identity_changed')
          const nextEpoch = id()
          if (typeof nextEpoch !== 'string' || !nextEpoch || nextEpoch === original.epoch) throw failure('auth_coordination_invalid')
          browser.write({ epoch: nextEpoch, pending: null, suppressed: false })
          try { browser.publish?.({ type: 'invalidate', epoch: nextEpoch }) } catch { /* Durable storage remains authoritative. */ }
          if (authenticated) settleAuthenticated(authenticated, nextEpoch)
          else settleAnonymous(nextEpoch)
          return authenticated ? { state: 'authenticated' } : { state: 'anonymous' }
        }

        let data
        try {
          const result = await refresh?.()
          data = validateLoginResponse(result?.data ?? result)
        } catch (error) {
          if (isDefiniteRefreshAnonymous(error)) return settle(null)
          throw error
        }
        if (kind === 'logout') {
          if (typeof recoverLogout !== 'function') throw failure('auth_logout_recovery_unavailable')
          const result = await recoverLogout(data.access_token)
          if (result?.status !== 204) throw failure('auth_logout_recovery_incomplete')
          return settle(null)
        }
        return settle(data)
      })
    } catch (error) {
      uncertain(error?.code === 'auth_recovery_unsupported'
        ? 'auth_recovery_unsupported'
        : capabilityIssues.has(error?.code) ? error.code : 'auth_uncertain')
      throw error
    }
  }
  function recover() {
    if (!recoveryPromise) recoveryPromise = recoverLocked().finally(() => { recoveryPromise = null })
    return recoveryPromise
  }
  browser?.subscribe?.(message => {
    if (message?.type !== 'invalidate' || message.epoch === sharedEpoch) return
    try { sharedEpoch = read().epoch } catch { /* remain closed */ }
    clearSession()
  })
  return { accessToken, authIssue, user: () => user, state: () => state, capture, assertCurrent, assertSnapshot, replacePermissionProjection, setSession, clearSession,
    cookieOperation, refreshAndRetry, ensureSession, logout, recover,
    requireAvailable() { const record = read(); if (state === 'uncertain' || record.pending || record.suppressed) throw failure('auth_uncertain') },
    onInvalidate(fn) { invalidators.add(fn); return () => invalidators.delete(fn) },
    onSnapshotInvalidate(fn) { snapshotInvalidators.add(fn); return () => snapshotInvalidators.delete(fn) },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

/** Native fetch preserves Response/stream types and never retries writes. */
export async function authenticatedFetch(auth, input, init = {}, { fetchImpl = fetch, onUnauthorized } = {}) {
  const url = typeof input === 'string' ? input : input.url
  const context = auth.capture()
  const send = async (config) => {
    auth.assertCurrent(config.__authContext)
    const headers = new Headers(init.headers || {})
    if (auth.accessToken()) headers.set('Authorization', `Bearer ${auth.accessToken()}`)
    const response = await fetchImpl(input, { ...init, headers })
    auth.assertCurrent(context)
    let recoverable = false
    if (response.status === 401) {
      try { recoverable = isRecoverableAccessFailure(response.status, await response.clone().json()) } catch { /* Unknown bodies never trigger retry. */ }
      auth.assertCurrent(context)
    }
    if (recoverable && isSafeAuthRead(url, init.method) && !config.__authRetried && context.token) {
      try { return await auth.refreshAndRetry(config, send) }
      catch (error) { if (auth.state() === 'anonymous') await onUnauthorized?.(); throw error }
    }
    if (recoverable && config.__authRetried) {
      auth.clearSession(); await onUnauthorized?.(); throw failure('unauthorized')
    }
    // Body consumption can outlive headers. Recheck after every asynchronous body conversion.
    for (const method of ['json', 'text', 'blob', 'arrayBuffer', 'formData']) {
      const consume = response[method].bind(response)
      response[method] = async (...args) => { const data = await consume(...args); auth.assertCurrent(context); return data }
    }
    return response
  }
  return send({ url, method: init.method || 'GET', __authContext: context })
}

/** Filters the session API response before reactive UI state receives it. */
export function sessionRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => Object.fromEntries(Object.entries(SESSION_FIELDS)
    .filter(([field]) => Object.hasOwn(row || {}, field))
    .map(([field, name]) => [name, row[field]])))
}
