import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'

async function buildScript() {
  assert.ok(existsSync(new URL('./guest-startup-preload.mjs', import.meta.url)), 'guest resource hint plugin must exist')
  const { guestStartupPreloadPlugin } = await import('./guest-startup-preload.mjs')
  const plugin = guestStartupPreloadPlugin()
  plugin.configResolved({ base: '/' })
  const bundle = {
    'index.html': { type: 'asset', source: '<html><head></head><body></body></html>' },
    'assets/login.js': { type: 'chunk', facadeModuleId: '/repo/src/views/Login.vue', imports: ['assets/shared.js'], viteMetadata: { importedCss: new Set(['assets/login.css']) } },
    'assets/register.js': { type: 'chunk', facadeModuleId: '/repo/src/views/Register.vue', imports: ['assets/shared.js'] },
    'assets/guest.js': { type: 'chunk', facadeModuleId: '/repo/src/bootstrap/guest-ui.js', imports: ['assets/shared.js'] },
    'assets/auth.js': { type: 'chunk', facadeModuleId: '/repo/src/bootstrap/AuthApp.vue', imports: [] },
    'assets/shared.js': { type: 'chunk', imports: [] },
    'assets/console.js': { type: 'chunk', facadeModuleId: '/repo/src/layouts/MainLayout.vue', imports: [] },
  }
  plugin.generateBundle.handler({}, bundle)
  return bundle['index.html'].source.match(/<script>([\s\S]*?)<\/script>/)[1]
}

for (const path of ['/', '/pricing', '/chat', '/login-other']) test(`guest hint adds no resources at ${path}`, async () => {
  const dom = new JSDOM('', { url: `https://local.test${path}`, runScripts: 'outside-only' })
  try { dom.window.eval(await buildScript()); assert.equal(dom.window.document.querySelectorAll('link').length, 0) }
  finally { dom.window.close() }
})

test('login hints its static dependency graph and styles once without console or register downloads', async () => {
  const dom = new JSDOM('', { url: 'https://local.test/login?redirect=/chat', runScripts: 'outside-only' })
  try {
    dom.window.eval(await buildScript())
    const links = [...dom.window.document.querySelectorAll('link')]
    assert.deepEqual(links.map(x => x.getAttribute('href')).sort(), ['/assets/auth.js','/assets/guest.js','/assets/login.css','/assets/login.js','/assets/shared.js'].sort())
    assert.equal(links.find(x => x.getAttribute('href').endsWith('.css')).getAttribute('as'), 'style')
    assert.equal(links.filter(x => x.rel === 'modulepreload').length, 4)
  } finally { dom.window.close() }
})
