import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPricingPresentation, canonicalPricingQuery, canonicalPricingRouteQuery, isCanonicalPricingRouteQuery, loadPricingAuthSession, pricingAPIQuery, pricingQueryString, publicPriceState, publicPricingAuthOptions } from './public-pricing-query.js'
import { createAuthSessionManager } from '../api/auth-session.js'
import { browserFixture } from '../api/auth-test-browser.js'

test('canonicalizes every shareable pricing control and clamps unsafe values', () => {
  assert.deepEqual(canonicalPricingQuery({ search: [' x '], provider: 42, capability: ' chat ', endpoint: ' responses ', page: '-2', pageSize: '75', sort: 'cost', direction: 'sideways' }), {
    search: 'x', provider: '', capability: 'chat', endpoint: 'responses', group: '', page: 1, pageSize: 20, sort: 'default', direction: 'asc',
  })
  assert.equal(canonicalPricingQuery({ page: '2x' }).page, 1)
  assert.deepEqual(canonicalPricingQuery({ page: '4', page_size: '100', sort: 'output', direction: 'desc' }), {
    search: '', provider: '', capability: '', endpoint: '', group: '', page: 4, pageSize: 100, sort: 'output', direction: 'desc',
  })
})

test('serializes a stable URL while sending only frozen backend query fields', () => {
  const query = canonicalPricingQuery({ search: 'a&b', provider: '智谱', capability: 'chat', endpoint: 'responses', page: 2, pageSize: 50, sort: 'input', direction: 'desc' })
  assert.equal(pricingQueryString(query), 'search=a%26b&provider=%E6%99%BA%E8%B0%B1&capability=chat&endpoint=responses&page=2&pageSize=50&sort=input&direction=desc')
  assert.deepEqual(pricingAPIQuery(query), { search: 'a&b', provider: '智谱', capability: 'chat', endpointType: 'responses', pricingType: 'token', page: 2, pageSize: 50, sort: 'input_price', order: 'desc' })
})

test('canonicalizes the entire route query and removes arrays duplicates and unknown keys', () => {
  const raw = { search: ['first', 'second'], page: ['2', '9'], pageSize: '50', sort: 'name', direction: 'asc', unknown: 'drop' }
  assert.deepEqual(canonicalPricingRouteQuery(raw), { search: 'first', page: '2', pageSize: '50', sort: 'name', direction: 'asc' })
  assert.equal(isCanonicalPricingRouteQuery(raw), false)
  assert.equal(isCanonicalPricingRouteQuery(canonicalPricingRouteQuery(raw)), true)
})

test('keeps server ordered pages unchanged so global totals and sorting stay coherent', () => {
  const models = [
    { modelKey: 'missing', capabilities: ['chat'] },
    { modelKey: 'ten', capabilities: ['chat', 'responses'], inputPrice: '10.00000000', outputPrice: '2' },
    { modelKey: 'two', capabilities: ['responses'], inputPrice: '2.1', outputPrice: '11' },
  ]
  assert.deepEqual(applyPricingPresentation(models, { endpoint: 'responses', sort: 'input', direction: 'asc' }).map(x => x.modelKey), ['missing', 'ten', 'two'])
  assert.deepEqual(applyPricingPresentation(models, { sort: 'output', direction: 'desc' }).map(x => x.modelKey), ['missing', 'ten', 'two'])
})

test('presentation never reorders a server page', () => {
  const models = [{ modelKey: 'b', displayName: 'Zulu', capabilities: [] }, { modelKey: 'a', displayName: 'Alpha', capabilities: [] }]
  assert.deepEqual(applyPricingPresentation(models, { sort: 'name', direction: 'asc' }).map(x => x.modelKey), ['b', 'a'])
  assert.deepEqual(applyPricingPresentation(models, { sort: 'input', direction: 'asc' }).map(x => x.modelKey), ['b', 'a'])
})

test('authenticated representation uses only the actual current auth snapshot', () => {
  const snapshot = { epoch: 'e', generation: 2, permissionRevision: 3, token: 'secret' }
  const authenticated = { state: () => 'authenticated', accessToken: () => 'secret', capture: () => snapshot }
  assert.deepEqual(publicPricingAuthOptions(authenticated), { authenticated: true, authContext: snapshot })
  assert.deepEqual(publicPricingAuthOptions({ ...authenticated, state: () => 'anonymous' }), { authenticated: false })
  assert.deepEqual(publicPricingAuthOptions({ ...authenticated, accessToken: () => null }), { authenticated: false })
})

test('redacted authenticated-only price is distinct from an unpublished value', () => {
  assert.deepEqual(publicPriceState({ priceVisibility: 'authenticated_only' }, 'input'), { state: 'login_required' })
  assert.deepEqual(publicPriceState({ priceVisibility: 'visible' }, 'input'), { state: 'unpublished' })
  assert.deepEqual(publicPriceState({ priceVisibility: 'visible', inputPrice: '0' }, 'input'), { state: 'published', value: '0' })
})

test('loads auth machinery only after pricing evidence and restores a fresh refresh-cookie manager', async () => {
  let imports = 0
  assert.equal(await loadPricingAuthSession(false, async () => { imports++; throw new Error('must_not_import') }), null)
  let successState = 'initializing'
  const success = { state: () => successState, ensureSession: async () => { successState = 'authenticated'; return true }, accessToken: () => 'restored', capture: () => ({ epoch: 'e', generation: 1, permissionRevision: 1, token: 'restored' }) }
  assert.equal(await loadPricingAuthSession(true, async () => { imports++; return { authSession: success } }), success)
  const failure = { state: () => 'initializing', ensureSession: async () => false, accessToken: () => null }
  assert.equal(await loadPricingAuthSession(true, async () => { imports++; return { authSession: failure } }), null)
  assert.equal(await loadPricingAuthSession(true, async () => { imports++; throw new Error('chunk_failed') }), null)
  assert.equal(imports, 3)
})

test('fresh managers upgrade from a valid refresh cookie and fail closed without one', async () => {
  const restored = createAuthSessionManager({ browser: browserFixture(), refresh: async () => ({ access_token: 'fresh-access', token_type: 'Bearer', expires_in: 300, user: { guid: '1', username: 'fresh', nickname: null, role: 'user', status: 'active' } }) })
  assert.equal(await loadPricingAuthSession(true, async () => ({ authSession: restored })), restored)
  assert.equal(restored.state(), 'authenticated')
  const missing = createAuthSessionManager({ browser: browserFixture(), refresh: async () => { throw { response: { status: 401 } } } })
  assert.equal(await loadPricingAuthSession(true, async () => ({ authSession: missing })), null)
  assert.equal(missing.state(), 'anonymous')
})

test('public display group is canonical and sent to the backend', () => {
  const canonical = canonicalPricingQuery({ group: ['featured', 'ignored'] })
  assert.equal(canonical.group, 'featured')
  assert.equal(canonicalPricingRouteQuery(canonical).group, 'featured')
  assert.equal(pricingAPIQuery(canonical).publicDisplayGroup, 'featured')
})
