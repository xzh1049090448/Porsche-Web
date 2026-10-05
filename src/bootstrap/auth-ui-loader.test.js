import test from 'node:test'
import assert from 'node:assert/strict'
import * as bootstrap from '../bootstrap-app.js'

function fixture(overrides = {}) {
  assert.equal(typeof bootstrap.createAuthUiLoader, 'function', 'route UI loader must exist')
  const installed = []
  const app = { use: plugin => installed.push(plugin) }
  let guestCalls = 0; let consoleCalls = 0
  const ui = bootstrap.createAuthUiLoader({ app,
    loadGuestUi: async () => { guestCalls += 1; return app => app.use('guest') },
    loadConsoleUi: async () => { consoleCalls += 1; return app => app.use('console') },
    ...overrides,
  })
  return { ui, installed, calls: () => ({ guestCalls, consoleCalls }) }
}

test('guest bootstrap installs UI once without fetching console components', async () => {
  const f = fixture(); await Promise.all([f.ui.installGuest(), f.ui.installGuest()])
  await f.ui.beforeResolve({ meta: { guest: true } })
  assert.deepEqual(f.installed, ['guest']); assert.deepEqual(f.calls(), { guestCalls: 1, consoleCalls: 0 })
})

test('authenticated route waits for complete console UI while concurrent navigation shares loading', async () => {
  let release
  const loading = new Promise(resolve => { release = resolve })
  let calls = 0
  const f = fixture({ loadConsoleUi: async () => { calls += 1; await loading; return app => app.use('console') } })
  await f.ui.installGuest()
  let resolved = false
  const first = f.ui.beforeResolve({ meta: { requiresAuth: true } }).then(() => { resolved = true })
  const second = f.ui.beforeResolve({ meta: { requiresAuth: true } })
  await Promise.resolve(); assert.equal(resolved, false)
  release(); await Promise.all([first, second])
  assert.equal(calls, 1); assert.deepEqual(f.installed, ['guest', 'console'])
})

test('UI import failure rejects navigation for existing router recovery and never installs partial UI', async () => {
  const error = new TypeError('Failed to fetch dynamically imported module')
  const f = fixture({ loadConsoleUi: async () => { throw error } })
  await f.ui.installGuest()
  await assert.rejects(f.ui.beforeResolve({ meta: { requiresAuth: true } }), value => value === error)
  assert.deepEqual(f.installed, ['guest'])
})

test('successful UI installation returns no route location or guard override', async () => {
  const app = { use: () => app }
  const f = fixture({ app, loadConsoleUi: async () => app => app.use('console') })
  assert.equal(await f.ui.beforeResolve({ meta: { requiresAuth: true } }), undefined)
})

test('existing authentication guard redirects denied navigation before any console UI request', async () => {
  const { createRouter, createMemoryHistory } = await import('vue-router')
  const { installAuthGuard } = await import('../router/index.js')
  const f = fixture(); await f.ui.installGuest()
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'Login', component: {}, meta: { guest: true } },
    { path: '/chat', name: 'Chat', component: {}, meta: { requiresAuth: true } },
  ] })
  installAuthGuard(router, async () => ({ isLoggedIn: false, ensureSession: async () => {} }))
  router.beforeResolve(f.ui.beforeResolve)
  await router.push('/chat')
  assert.equal(router.currentRoute.value.name, 'Login')
  assert.equal(router.currentRoute.value.query.redirect, '/chat')
  assert.equal(f.calls().consoleCalls, 0)
})

test('allowed navigation installs full UI before confirmation without changing route or permissions', async () => {
  const { createRouter, createMemoryHistory } = await import('vue-router')
  const { installAuthGuard } = await import('../router/index.js')
  const f = fixture(); await f.ui.installGuest()
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'Login', component: {}, meta: { guest: true } },
    { path: '/chat', name: 'Chat', component: {}, meta: { requiresAuth: true } },
  ] })
  installAuthGuard(router, async () => ({ isLoggedIn: true, ensureSession: async () => {} }))
  router.beforeResolve(f.ui.beforeResolve)
  await router.push('/chat')
  assert.equal(router.currentRoute.value.name, 'Chat')
  assert.deepEqual(f.installed, ['guest', 'console'])
})

test('first render waits for resolved navigation so initial route is not faded from transparent', async () => {
  assert.equal(typeof bootstrap.mountAfterRouterReady, 'function')
  let release
  const ready = new Promise(resolve => { release = resolve })
  const actions = []
  const router = { isReady: () => { actions.push('ready'); return ready } }
  const app = { use: value => { assert.equal(value, router); actions.push('router') }, mount: target => { actions.push(target); return 'mounted' } }
  const mounting = bootstrap.mountAfterRouterReady(app, router)
  await Promise.resolve()
  assert.deepEqual(actions, ['router', 'ready'])
  release()
  assert.equal(await mounting, 'mounted')
  assert.deepEqual(actions, ['router', 'ready', '#app'])
})

test('initial navigation failure stays observable by existing bootstrap recovery', async () => {
  assert.equal(typeof bootstrap.mountAfterRouterReady, 'function')
  const error = new TypeError('Failed to fetch dynamically imported module')
  let mounted = false; let recovered = 0
  const app = { use: () => {}, mount: () => { mounted = true } }
  const router = { isReady: async () => { throw error } }
  const ok = await bootstrap.bootstrapApplication({ mode: 'auth', loadAuthApp: async () => () => bootstrap.mountAfterRouterReady(app, router), recover: value => { assert.equal(value, error); recovered += 1; return true } })
  assert.equal(ok, false); assert.equal(mounted, false); assert.equal(recovered, 1)
})
