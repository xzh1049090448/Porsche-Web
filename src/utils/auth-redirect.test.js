import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./auth-redirect.js', import.meta.url), 'utf8')

async function loadSafeAuthRedirect() {
  assert.match(source, /export function safeAuthRedirect/)
  return (await import('./auth-redirect.js')).safeAuthRedirect
}

test('defaults missing or non-string redirects to authenticated chat', async () => {
  const safeAuthRedirect = await loadSafeAuthRedirect()
  assert.equal(safeAuthRedirect(), '/chat')
  assert.equal(safeAuthRedirect(''), '/chat')
  assert.equal(safeAuthRedirect(['/profile']), '/chat')
})

test('preserves safe internal path query and hash', async () => {
  const safeAuthRedirect = await loadSafeAuthRedirect()
  assert.equal(safeAuthRedirect('/profile?tab=security#sessions'), '/profile?tab=security#sessions')
  assert.equal(safeAuthRedirect('/api-keys?scope=read%20only'), '/api-keys?scope=read%20only')
})

test('rejects external, protocol-relative, backslash, control, and encoded redirects', async () => {
  const safeAuthRedirect = await loadSafeAuthRedirect()
  const unsafe = [
    'https://evil.example/x',
    'javascript:alert(1)',
    '//evil.example/x',
    '/\\evil.example/x',
    '\\evil.example\\x',
    '/%5cevil.example/x',
    '/%255cevil.example/x',
    '/%2f%2fevil.example/x',
    '/%252f%252fevil.example/x',
    '%2f%2fevil.example/x',
    '/safe%0d%0aLocation:%20https://evil.example',
    '/safe%250d%250aLocation:%20https://evil.example',
  ]
  for (const redirect of unsafe) assert.equal(safeAuthRedirect(redirect), '/chat', redirect)
})

test('rejects login and registration loops including encoded targets', async () => {
  const safeAuthRedirect = await loadSafeAuthRedirect()
  for (const redirect of ['/login', '/login/', '/login?redirect=/login', '/register#form', '/register/step', '/%6cogin', '/%2572egister']) {
    assert.equal(safeAuthRedirect(redirect), '/chat', redirect)
  }
})
