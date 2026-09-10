import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryHistory, createRouter } from 'vue-router'
import { bootstrapModeForPath, createLazyLoadFailureHandler, installAuthGuard, installBootstrapHandoff, installLoadFailureRecovery, routes } from './index.js'

const Stub = { template: '<div />' }
const testRoutes = routes.map(route => ({
  ...route,
  component: Stub,
  children: route.children?.map(child => ({ ...child, component: Stub })),
}))

function routerFixture({ loggedIn = false } = {}) {
  let storeLoads = 0
  const router = createRouter({ history: createMemoryHistory(), routes: testRoutes })
  installAuthGuard(router, async () => {
    storeLoads += 1
    return { isLoggedIn: loggedIn, ensureSession: async () => loggedIn }
  })
  return { router, storeLoads: () => storeLoads }
}

test('actual matcher resolves public routes and 404 through PublicLayout', () => {
  const { router } = routerFixture()
  for (const [path, name] of [
    ['/', 'PublicHome'], ['/pricing', 'PublicPricing'], ['/pricing/model-key', 'PublicPricingDetail'],
    ['/about', 'PublicAbout'], ['/terms', 'PublicTerms'], ['/privacy', 'PublicPrivacy'],
    ['/not-a-real-page', 'PublicNotFound'],
  ]) {
    const resolved = router.resolve(path)
    assert.equal(resolved.name, name, path)
    assert.equal(resolved.meta.public, true, path)
    assert.equal(resolved.meta.requiresAuth, undefined, path)
    assert.equal(resolved.matched[0].path, '/', path)
  }
})

test('actual matcher keeps chat and existing account routes protected', () => {
  const { router } = routerFixture()
  for (const [path, name] of [
    ['/chat', 'Chat'], ['/profile', 'Profile'], ['/billing', 'Billing'], ['/api-keys', 'ApiKeys'],
    ['/users', 'Users'], ['/users/123', 'UserDetail'],
  ]) {
    const resolved = router.resolve(path)
    assert.equal(resolved.name, name, path)
    assert.equal(resolved.meta.requiresAuth, true, path)
    assert.equal(resolved.meta.public, undefined, path)
  }
})

test('anonymous public navigation never loads the protected user store', async () => {
  const { router, storeLoads } = routerFixture()
  for (const path of ['/', '/pricing', '/unknown-public']) {
    await router.push(path)
    await router.isReady()
    assert.equal(router.currentRoute.value.path, path)
  }
  assert.equal(storeLoads(), 0)
})

test('anonymous protected navigation redirects to login with a safe full path', async () => {
  const { router, storeLoads } = routerFixture()
  await router.push('/profile?tab=security#sessions')
  await router.isReady()
  assert.equal(router.currentRoute.value.name, 'Login')
  assert.equal(router.currentRoute.value.query.redirect, '/profile?tab=security#sessions')
  assert.ok(storeLoads() >= 1)
})

test('logged-in guest navigation and missing login redirects use /chat', async () => {
  const authenticated = routerFixture({ loggedIn: true })
  await authenticated.router.push('/login')
  await authenticated.router.isReady()
  assert.equal(authenticated.router.currentRoute.value.path, '/chat')

  const anonymous = routerFixture()
  await anonymous.router.push('/login')
  await anonymous.router.isReady()
  assert.equal(anonymous.router.currentRoute.value.query.redirect, '/chat')
})

test('bootstrap boundary uses one hard handoff and keeps same-boundary navigation in the SPA', async () => {
  const resolver = createRouter({ history: createMemoryHistory(), routes: testRoutes })
  assert.equal(bootstrapModeForPath(resolver, '/'), 'public')
  assert.equal(bootstrapModeForPath(resolver, '/pricing/model'), 'public')
  assert.equal(bootstrapModeForPath(resolver, '/chat'), 'auth')
  assert.equal(bootstrapModeForPath(resolver, '/login'), 'auth')

  const handoffs = []
  const router = createRouter({ history: createMemoryHistory(), routes: testRoutes })
  installBootstrapHandoff(router, { mode: 'public', handoff: path => handoffs.push(path) })
  await router.push('/pricing')
  assert.equal(router.currentRoute.value.path, '/pricing')
  await router.push('/login?redirect=%2Fchat')
  assert.deepEqual(handoffs, ['/login?redirect=%2Fchat'])
  assert.equal(router.currentRoute.value.path, '/pricing')
})

test('bootstrap classification follows the case-insensitive router matcher and encoded public paths', async () => {
  const resolver = createRouter({ history: createMemoryHistory(), routes: testRoutes })
  for (const path of ['/LOGIN', '/Chat', '/PROFILE/', '/Users/123', '/API-KEYS']) {
    assert.equal(bootstrapModeForPath(resolver, path), 'auth', path)
  }
  for (const path of ['/PRICING', '/About/', '/Unknown', '/%6Cogin', '/%43hat', '/%70ricing']) {
    assert.equal(bootstrapModeForPath(resolver, path), 'public', path)
  }

  for (const initialPath of ['/LOGIN', '/Chat', '/PROFILE/', '/Users/123', '/PRICING', '/Unknown']) {
    const handoffs = []
    const router = createRouter({ history: createMemoryHistory(), routes: testRoutes })
    installBootstrapHandoff(router, { mode: bootstrapModeForPath(router, initialPath), handoff: path => handoffs.push(path) })
    await router.push(initialPath)
    assert.deepEqual(handoffs, [], initialPath)
  }
})

test('bootstrap classification derives future protected routes from router metadata', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: testRoutes })
  router.addRoute({ path: '/future-admin', name: 'FutureAdmin', component: Stub, meta: { requiresAuth: true } })
  router.addRoute({ path: '/future-guest', name: 'FutureGuest', component: Stub, meta: { guest: true } })
  assert.equal(bootstrapModeForPath(router, '/future-admin'), 'auth')
  assert.equal(bootstrapModeForPath(router, '/FUTURE-ADMIN/'), 'auth')
  assert.equal(bootstrapModeForPath(router, '/future-guest'), 'auth')
  assert.equal(bootstrapModeForPath(router, '/future-unknown'), 'public')
})

test('lazy import recovery reloads once then uses a constant safe fallback without loops', async () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  let reloads = 0
  let fallbacks = 0
  const stale = new TypeError('Failed to fetch dynamically imported module: /assets/Page-old.js')
  const firstPage = createLazyLoadFailureHandler({ storage, reload: () => { reloads += 1 }, fallback: () => { fallbacks += 1 } })
  assert.equal(firstPage(stale), true)
  assert.equal(reloads, 1)
  assert.equal(fallbacks, 0)
  const secondPage = createLazyLoadFailureHandler({ storage, reload: () => { reloads += 1 }, fallback: () => { fallbacks += 1 } })
  assert.equal(secondPage(stale), true)
  assert.equal(reloads, 1)
  assert.equal(fallbacks, 1)
  assert.equal(storage.getItem('public_route_lazy_reload_v1'), null)
  assert.equal(secondPage(new Error('ordinary component error')), false)
  assert.equal(reloads, 1)
  assert.equal(fallbacks, 1)
})

test('lazy recovery never reloads when durable storage is unavailable or broken', () => {
  const stale = new TypeError('Failed to fetch dynamically imported module: /assets/old.js')
  for (const storage of [
    null,
    { getItem() { throw new Error('blocked') }, setItem() {}, removeItem() {} },
    { getItem() { return null }, setItem() { throw new Error('quota') }, removeItem() {} },
    { getItem() { return null }, setItem() {}, removeItem() {} },
  ]) {
    let reloads = 0
    let fallbacks = 0
    const handler = createLazyLoadFailureHandler({ storage, reload: () => { reloads += 1 }, fallback: () => { fallbacks += 1 } })
    assert.doesNotThrow(() => handler(stale))
    assert.equal(reloads, 0)
    assert.equal(fallbacks, 1)
  }
})

test('lazy recovery falls back immediately when reload throws or reports failure', () => {
  const stale = new TypeError('ChunkLoadError')
  for (const reload of [() => { throw new Error('blocked') }, () => false]) {
    const values = new Map()
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
    let fallbacks = 0
    createLazyLoadFailureHandler({ storage, reload, fallback: () => { fallbacks += 1 } })(stale)
    assert.equal(fallbacks, 1)
  }
})

test('successful navigation clears the durable reload marker', async () => {
  const values = new Map([['public_route_lazy_reload_v1', 'attempted']])
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const router = createRouter({ history: createMemoryHistory(), routes: testRoutes })
  installLoadFailureRecovery(router, { storage })
  await router.push('/pricing')
  await router.isReady()
  assert.equal(storage.getItem('public_route_lazy_reload_v1'), null)
})
