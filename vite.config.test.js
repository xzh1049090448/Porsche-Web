import assert from 'node:assert/strict'
import test from 'node:test'

import config from './vite.config.js'

const proxyEntries = Object.entries(config.server.proxy ?? {})

function matchesViteProxyContext(context, url) {
  return context.startsWith('^')
    ? new RegExp(context).test(url)
    : url.startsWith(context)
}

test('Vite proxies only the /api path segment', () => {
  assert.equal(proxyEntries.length, 1)
  const [[context]] = proxyEntries

  for (const url of [
    '/api',
    '/api?health=1',
    '/api/',
    '/api/v1/auth/login',
    '/api/v1/users/me?include=profile',
    '/api/public/models',
  ]) {
    assert.equal(matchesViteProxyContext(context, url), true, `${url} must be proxied`)
  }

  for (const url of [
    '/api-keys',
    '/api-keys/',
    '/api-admin',
    '/api-any-future-page',
    '/application',
  ]) {
    assert.equal(matchesViteProxyContext(context, url), false, `${url} must use SPA fallback`)
  }

  assert.equal(context, '^/api(?:/|\\?|$)')
})

test('Vite keeps the existing backend target and proxy hook', () => {
  assert.equal(proxyEntries.length, 1)
  const [[, options]] = proxyEntries
  assert.equal(options.target, 'http://localhost:8000')
  assert.equal(options.changeOrigin, true)
  assert.equal(typeof options.configure, 'function')
})
