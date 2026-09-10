import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installAuthGuard, routes } from './index.js'

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
