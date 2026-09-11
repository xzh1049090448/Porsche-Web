import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createServer as createViteServer } from 'vite'

import config from './vite.config.js'

const proxyEntries = Object.entries(config.server.proxy ?? {})

function matchesViteProxyContext(context, url) {
  return context.startsWith('^')
    ? new RegExp(context).test(url)
    : url.startsWith(context)
}

function proxyEntry(context) {
  return proxyEntries.find(([candidate]) => candidate === context)
}

test('Vite proxies only the /api path segment', () => {
  const [context] = proxyEntry('^/api(?:/|\\?|$)') ?? []

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

test('Vite proxies the exact /admin/v2 path segment', () => {
  const [context, options] = proxyEntry('^/admin/v2(?:/|\\?|$)') ?? []

  assert.equal(context, '^/admin/v2(?:/|\\?|$)')
  for (const url of [
    '/admin/v2',
    '/admin/v2?scope=users.delete',
    '/admin/v2/',
    '/admin/v2/public-models',
    '/admin/v2/public-pricing/draft?revision=2',
  ]) {
    assert.equal(matchesViteProxyContext(context, url), true, `${url} must be proxied`)
  }

  for (const url of [
    '/admin/v20',
    '/admin/v2-public-models',
    '/admin/v2public-models',
    '/admin/public-models',
    '/admin/public-pricing',
    '/admin/public-content',
    '/admin/notifications',
  ]) {
    assert.equal(matchesViteProxyContext(context, url), false, `${url} must use SPA fallback`)
  }

  assert.equal(options.target, 'http://localhost:8000')
  assert.equal(options.changeOrigin, true)
})

test('Vite keeps the existing /api backend target and proxy hook', () => {
  assert.equal(proxyEntries.length, 2)
  const [, options] = proxyEntry('^/api(?:/|\\?|$)') ?? []
  assert.equal(options.target, 'http://localhost:8000')
  assert.equal(options.changeOrigin, true)
  assert.equal(typeof options.configure, 'function')
})

test('real Vite dev server proxies APIs while preserving admin SPA fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vite-admin-v2-proxy-'))
  const backend = createHttpServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ proxiedPath: request.url }))
  })
  await new Promise((resolve, reject) => {
    backend.once('error', reject)
    backend.listen(0, '127.0.0.1', resolve)
  })
  const backendAddress = backend.address()
  const backendTarget = `http://127.0.0.1:${backendAddress.port}`
  const proxy = Object.fromEntries(proxyEntries.map(([context, options]) => [context, {
    ...options,
    target: backendTarget,
    configure: undefined,
  }]))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>admin-spa-shell</title>')
  const vite = await createViteServer({
    configFile: false,
    root,
    appType: 'spa',
    server: { host: '127.0.0.1', port: 0, strictPort: false, proxy },
  })

  try {
    await vite.listen()
    const viteAddress = vite.httpServer.address()
    const origin = `http://127.0.0.1:${viteAddress.port}`

    for (const path of ['/api/public/models', '/admin/v2/public-models?status=active']) {
      const response = await fetch(`${origin}${path}`)
      assert.equal(response.headers.get('content-type'), 'application/json')
      assert.deepEqual(await response.json(), { proxiedPath: path })
    }

    for (const path of [
      '/admin/public-models',
      '/admin/public-pricing',
      '/admin/public-content',
      '/admin/notifications',
      '/admin/v20',
    ]) {
      const response = await fetch(`${origin}${path}`, { headers: { accept: 'text/html' } })
      assert.equal(response.status, 200)
      assert.match(await response.text(), /admin-spa-shell/)
    }
  } finally {
    await vite.close()
    await new Promise(resolve => backend.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
