import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticatedFetch, createAuthSessionManager, isSafeAuthRead, sessionRows, sessionUser } from './auth-session.js'
import { readFile } from 'node:fs/promises'

test('notification reads may refresh while notification receipts remain non-replayable writes', () => {
  assert.equal(isSafeAuthRead('/admin/v2/notifications?state=active&page=1&page_size=20', 'GET'), true)
  assert.equal(isSafeAuthRead('/admin/v2/notifications/unread-count', 'GET'), true)
  assert.equal(isSafeAuthRead('/admin/v2/notifications/101/read', 'POST'), false)
  assert.equal(isSafeAuthRead('/admin/v2/notifications/101/acknowledge', 'POST'), false)
})

test('session user whitelist excludes server-only and unexpected fields', () => {
  assert.deepEqual(sessionUser({
    guid: '100', username: 'alice', nickname: 'Alice', role: 1, status: 1,
    password_hash: 'must-not-leak', phone: 'must-not-leak', is_admin: true, id: 7,
  }), { guid: '100', username: 'alice', nickname: 'Alice', role: 1, status: 1 })
})

test('SSE, conversation export, and analytics native requests use the shared authenticated fetch path', async () => {
  const [platform, generation, conversations, analytics] = await Promise.all([
    readFile(new URL('./platform.js', import.meta.url), 'utf8'),
    readFile(new URL('./platform-generation.js', import.meta.url), 'utf8'),
    readFile(new URL('./conversations.js', import.meta.url), 'utf8'),
    readFile(new URL('./modelAnalytics.js', import.meta.url), 'utf8'),
  ])

  assert.match(platform, /streamPlatformGeneration/)
  assert.match(platform, /streamPlatformCompareGeneration/)
  assert.match(generation, /import \{ authenticatedFetch \}/)
  assert.match(generation, /chat\/\$\{compare \? 'compare' : 'completions'\}/)
  assert.match(generation, /authenticatedFetchImpl/)
  assert.match(conversations, /authenticatedFetch\(/)
  assert.match(conversations, /export\/markdown/)
  assert.equal((analytics.match(/authenticatedFetch\(/g) || []).length, 2)
  assert.match(analytics, /\/access/)
  assert.match(analytics, /\/export/)
  for (const source of [platform, generation, conversations, analytics]) {
    assert.doesNotMatch(source, /getAuthToken\(/)
  }
})

test('session rows expose only the browser-safe DTO fields', () => {
  assert.deepEqual(sessionRows([{
    guid: '900', login_method: 'password', ip: '203.0.113.8', user_agent: 'Browser',
    created_at: '2026-08-28T00:00:00Z', last_active_at: '2026-08-28T00:01:00Z',
    expires_at: '2026-09-28T00:00:00Z', current: true, sid: 'must-not-leak', refresh_token: 'must-not-leak', id: 7,
  }]), [{
    guid: '900', loginMethod: 'password', ip: '203.0.113.8', userAgent: 'Browser',
    createdAt: '2026-08-28T00:00:00Z', lastActiveAt: '2026-08-28T00:01:00Z',
    expiresAt: '2026-09-28T00:00:00Z', current: true,
  }])
})

test('auth API only calls the username and revocable-session contract', async () => {
  const source = await readFile(new URL('./auth.js', import.meta.url), 'utf8')
  assert.match(source, /\/register/)
  assert.match(source, /\/login/)
  assert.match(source, /\/refresh/)
  assert.match(source, /\/logout/)
  assert.match(source, /\/sessions/)
  assert.doesNotMatch(source, /send-code|login\/password|login\/code|localStorage|sessionStorage|porsche_refresh/)
})
