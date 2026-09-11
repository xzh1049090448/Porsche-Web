import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createMemoryHistory, createRouter } from 'vue-router'
import { bootstrapModeForPath, createLazyLoadFailureHandler, installAuthGuard, installBootstrapHandoff, installLoadFailureRecovery, routes } from './index.js'
import { safeAuthRedirect } from '../utils/auth-redirect.js'

const Stub = { template: '<div />' }
const testRoutes = routes.map(route => ({
  ...route,
  component: Stub,
  children: route.children?.map(child => ({ ...child, component: Stub })),
}))

function routerFixture({ loggedIn = false, role = 'user' } = {}) {
  let storeLoads = 0
  const router = createRouter({ history: createMemoryHistory(), routes: testRoutes })
  installAuthGuard(router, async () => {
    storeLoads += 1
    return { isLoggedIn: loggedIn, user: loggedIn ? { role } : null, ensureSession: async () => loggedIn }
  })
  return { router, storeLoads: () => storeLoads }
}

test('route inventory freezes public, guest, authenticated, Root, and DEV metadata', () => {
  const { router } = routerFixture()
  const families = {
    public: [
      ['/', 'PublicHome'], ['/pricing', 'PublicPricing'], ['/pricing/model-key', 'PublicPricingDetail'],
      ['/about', 'PublicAbout'], ['/terms', 'PublicTerms'], ['/privacy', 'PublicPrivacy'],
      ['/not-a-real-page', 'PublicNotFound'],
    ],
    guest: [['/login', 'Login'], ['/register', 'Register']],
    authenticated: [
      ['/chat', 'Chat'], ['/users', 'Users'], ['/users/123', 'UserDetail'],
      ['/profile', 'Profile'], ['/billing', 'Billing'], ['/api-keys', 'ApiKeys'],
    ],
    root: [
      ['/admin/public-models', 'PublicModelsAdmin'], ['/admin/public-models/123', 'PublicModelDetail'],
      ['/admin/public-pricing', 'PublicPricingAdmin'], ['/admin/public-content', 'PublicContentAdmin'],
      ['/admin/public-content/preview', 'PublicContentPreview'], ['/admin/notifications', 'RootNotifications'],
    ],
  }

  const expectedNames = []
  for (const [family, entries] of Object.entries(families)) {
    for (const [path, name] of entries) {
      const resolved = router.resolve(path)
      expectedNames.push(name)
      assert.equal(resolved.name, name, path)
      assert.equal(resolved.meta.public === true, family === 'public', `${path} public`)
      assert.equal(resolved.meta.guest === true, family === 'guest', `${path} guest`)
      assert.equal(resolved.meta.requiresAuth === true, family === 'authenticated' || family === 'root', `${path} requiresAuth`)
      assert.equal(resolved.meta.rootOnly === true, family === 'root', `${path} rootOnly`)
    }
  }

  const runtimeNames = routes.flatMap(route => route.name ? [route.name] : (route.children || []).map(child => child.name)).filter(Boolean)
  assert.deepEqual(runtimeNames.toSorted(), expectedNames.toSorted())

  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  assert.match(source, /import\.meta\.env\?\.DEV\s*\?\s*\[/)
  assert.match(source, /path:\s*['"]demo\/admin\/balance['"][\s\S]{0,180}name:\s*['"]AdminBalanceMockDemo['"][\s\S]{0,220}meta:\s*\{\s*requiresAuth:\s*true\s*\}/)
})

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

test('Root routes reject non-Root sessions while Root sessions retain access', async () => {
  for (const path of ['/admin/public-models', '/admin/public-pricing', '/admin/public-content', '/admin/public-content/preview', '/admin/notifications']) {
    const regular = routerFixture({ loggedIn: true, role: 'admin' })
    await regular.router.push(path)
    await regular.router.isReady()
    assert.equal(regular.router.currentRoute.value.path, '/chat', path)

    const root = routerFixture({ loggedIn: true, role: 'root' })
    await root.router.push(path)
    await root.router.isReady()
    assert.equal(root.router.currentRoute.value.path, path, path)
  }
})

test('login redirects retain safe internal paths and reject external, loop, and encoded bypasses', async () => {
  assert.equal(safeAuthRedirect('/profile?tab=security#sessions'), '/profile?tab=security#sessions')
  for (const unsafe of ['https://evil.example/path', '//evil.example/path', '/login', '/register?next=/chat', '/%252F%252Fevil.example']) {
    assert.equal(safeAuthRedirect(unsafe), '/chat', unsafe)
  }

  const anonymous = routerFixture()
  await anonymous.router.push({ name: 'Login', query: { redirect: 'https://evil.example/path' } })
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

  const authenticatedHandoffs = []
  const authenticatedRouter = createRouter({ history: createMemoryHistory(), routes: testRoutes })
  installBootstrapHandoff(authenticatedRouter, { mode: 'auth', handoff: path => authenticatedHandoffs.push(path) })
  await authenticatedRouter.push('/chat'); await authenticatedRouter.push('/pricing')
  assert.equal(authenticatedRouter.currentRoute.value.path, '/chat')
  assert.deepEqual(authenticatedHandoffs, ['/pricing'])
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

test('exact Vite CSS preload failure uses the durable once-reload policy across page loads', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const error = new TypeError('Unable to preload CSS for /assets/Login-old.css')
  let reloads = 0
  let fallbacks = 0
  createLazyLoadFailureHandler({ storage, reload: () => { reloads += 1 }, fallback: () => { fallbacks += 1 } })(error)
  assert.deepEqual({ reloads, fallbacks }, { reloads: 1, fallbacks: 0 })
  createLazyLoadFailureHandler({ storage, reload: () => { reloads += 1 }, fallback: () => { fallbacks += 1 } })(error)
  assert.deepEqual({ reloads, fallbacks }, { reloads: 1, fallbacks: 1 })

  const broken = { getItem() { throw new Error('security') }, setItem() {}, removeItem() {} }
  createLazyLoadFailureHandler({ storage: broken, reload: () => { reloads += 1 }, fallback: () => { fallbacks += 1 } })(error)
  assert.deepEqual({ reloads, fallbacks }, { reloads: 1, fallbacks: 2 })
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
