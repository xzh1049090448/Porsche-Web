import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { apiKeySummary, isLiteralIP, tokenRows, tokenStatus } from './gateway-token-presentation.js'

const sourcePath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url))

test('tokenRows removes secret fields before a token is rendered', () => {
  const rows = tokenRows([
    {
      token: 'sk-gw-secret',
      token_hash: 'hash',
      token_prefix: 'sk-gw-abc',
      status: 'active',
      expires_at: '2026-08-20T00:00:00Z',
    },
  ])

  assert.equal(rows[0].token, undefined)
  assert.equal(rows[0].token_hash, undefined)
  assert.equal(rows[0].tokenPrefix, 'sk-gw-abc')
})

test('apiKeySummary counts only active keys that expire in the next seven days', () => {
  const rows = tokenRows([
    { status: 'active', expires_at: '2026-08-20T00:00:00Z' },
    { status: 'revoked', expires_at: '2026-08-20T00:00:00Z' },
    { status: 'active', expires_at: '2026-08-30T00:00:00Z' },
  ])

  assert.deepEqual(apiKeySummary(rows, new Date('2026-08-19T00:00:00Z')), {
    active: 2,
    revoked: 1,
    expiring: 1,
  })
})

test('isLiteralIP accepts literal addresses but rejects CIDR ranges and host names', () => {
  assert.equal(isLiteralIP('203.0.113.10'), true)
  assert.equal(isLiteralIP('2001:db8::1'), true)
  assert.equal(isLiteralIP('203.0.113.0/24'), false)
  assert.equal(isLiteralIP('gateway.example.com'), false)
  assert.equal(isLiteralIP(':::'), false)
})

test('tokenStatus displays an expired active key as expired', () => {
  assert.equal(tokenStatus({ status: 'active', expires_at: '2026-08-18T00:00:00Z' }, new Date('2026-08-19T00:00:00Z')), 'expired')
})

test('expired active keys do not inflate the usable active-key summary', () => {
  const rows = tokenRows([
    { status: 'active', expires_at: '2026-08-18T00:00:00Z' },
    { status: 'active', expires_at: '2026-08-20T00:00:00Z' },
  ])

  assert.deepEqual(apiKeySummary(rows, new Date('2026-08-19T00:00:00Z')), {
    active: 1,
    revoked: 0,
    expiring: 1,
  })
})

test('gateway token adapter uses only the implemented token CRUD paths and methods', async () => {
  const source = await readFile(sourcePath('../api/gatewayTokens.js'), 'utf8')

  assert.match(source, /const PREFIX = '\/api\/v1\/tokens'/)
  assert.match(source, /request\.get\(PREFIX\)/)
  assert.match(source, /request\.get\(`\$\{PREFIX\}\/\$\{encodeURIComponent\(requiredGuid\(guid, 'token GUID'\)\)\}`\)/)
  assert.match(source, /request\.post\(PREFIX, body\)/)
  assert.match(source, /request\.patch\(`\$\{PREFIX\}\/\$\{encodeURIComponent\(requiredGuid\(guid, 'token GUID'\)\)\}`, body\)/)
  assert.match(source, /request\.post\(`\$\{PREFIX\}\/\$\{encodeURIComponent\(requiredGuid\(guid, 'token GUID'\)\)\}\/revoke`\)/)
})

test('API key route and all navigation variants expose the protected page', async () => {
  const [router, layout] = await Promise.all([
    readFile(sourcePath('../router/index.js'), 'utf8'),
    readFile(sourcePath('../layouts/MainLayout.vue'), 'utf8'),
  ])

  assert.match(router, /path: 'api-keys', name: 'ApiKeys'/)
  assert.match(router, /meta: \{ requiresAuth: true \}[\s\S]*path: 'api-keys'/)
  assert.equal((layout.match(/index="\/api-keys"/g) || []).length, 2)
  assert.match(layout, /command="api-keys"/)
})

test('the page keeps a created secret transient and excludes secret persistence or injection sinks', async () => {
  const source = await readFile(sourcePath('../views/ApiKeys.vue'), 'utf8')

  assert.match(source, /const createdSecret = ref\(''\)/)
  assert.match(source, /createdSecret\.value = typeof created\.token === 'string' \? created\.token : ''/)
  assert.match(source, /@closed="clearSecret"/)
  assert.match(source, /onBeforeUnmount\(clearSecret\)/)
  assert.match(source, /function clearSecret\(\) \{\s*createdSecret\.value = ''\s*\}/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|v-html|console\.|window\.location|router\.(?:push|replace)/)
  assert.doesNotMatch(source, /token_hash|token_prefix.*createdSecret/)
})
