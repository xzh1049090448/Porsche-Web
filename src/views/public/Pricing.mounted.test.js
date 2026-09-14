import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

async function compileSFC(path, id, replacements) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: path }).descriptor
  const script = compileScript(descriptor, { id, genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id, filename: path, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  let code = `${script.content}\n${template.code}\n__sfc__.render = render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`).replaceAll(`import '${specifier}'`, `import '${replacement}'`).replaceAll(`import "${specifier}"`, `import "${replacement}"`)
  return dataModule(code)
}

function installDOM(url = 'https://local.test/pricing') {
  if (globalThis.document) {
    document.body.replaceChildren()
    return null
  }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })
  for (const key of ['window', 'document', 'navigator', 'history', 'location', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  return dom
}

async function pricingPage(id) {
  const vueURL = new URL('../../../node_modules/vue/index.mjs', import.meta.url).href
  const runtimeStub = dataModule("export const usePublicI18n=()=>({t:key=>key})")
  const styleStub = dataModule('export default {}')
  const filtersURL = await compileSFC('../../components/public/PricingFilters.vue', `${id}-filters`, [['vue', vueURL], ['@/i18n/public-runtime.js', runtimeStub]])
  const componentStub = dataModule(`import {defineComponent,h} from '${vueURL}';export default defineComponent({props:['status','message','models'],emits:['retry'],setup:(p)=>()=>h('div',p.message||p.status||'stub')})`)
  const routerStub = dataModule('export const useRoute=()=>globalThis.__pricingMount.route;export const useRouter=()=>globalThis.__pricingMount.router')
  const pricingUtils = new URL('../../utils/public-pricing-query.js', import.meta.url).href
  const pricingURL = await compileSFC('./Pricing.vue', id, [
    ['vue', vueURL], ['vue-router', routerStub],
    ['@/components/public/PricingFilters.vue', filtersURL], ['@/components/public/PricingTable.vue', componentStub],
    ['@/components/public/PricingCards.vue', componentStub], ['@/components/public/PublicContentState.vue', componentStub],
    ['@/utils/public-pricing-query.js', pricingUtils], ['@/i18n/public-runtime.js', runtimeStub], ['@/styles/public-pricing.scss', styleStub],
  ])
  return (await import(`${pricingURL}#${Date.now()}`)).default
}

const emptyCatalog = () => ({ items: [], total: 0, facets: { providers: [], capabilities: [], endpointTypes: [], publicDisplayGroups: [] } })

test('mounted toolbar search debounces one canonical route replacement and clears its timer on unmount', async () => {
  installDOM('https://local.test/pricing?search=alpha&page=02&unknown=drop')
  const Pricing = await pricingPage('pricing-page-search')
  const [{ mount }, { ref, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
  const replacements = []
  let cancellations = 0
  const store = ref({ site: { status: 'ready', data: { priceVisibility: 'visible' } }, models: { status: 'ready-empty', data: emptyCatalog() }, details: {} })
  store.loadSite = async () => store.value.site.data
  store.loadModels = async () => store.value.models.data
  store.cancel = slot => { assert.equal(slot, 'models'); cancellations++ }
  globalThis.__pricingMount = {
    route: { query: { search: ' alpha ', page: '02', unknown: 'drop' }, fullPath: '/pricing?search=alpha&page=02&unknown=drop' },
    router: { replace: async value => { replacements.push(value) } },
  }
  const wrapper = mount(Pricing, { global: { provide: { 'public-home-publication': { store, ready: Promise.resolve() } } } })
  await nextTick()
  assert.deepEqual(replacements, [{ name: 'PublicPricing', query: { search: 'alpha', page: '2', pageSize: '20', sort: 'default', direction: 'asc' } }])
  const search = wrapper.find('.pricing-search input[name="search"]')
  assert.equal(search.exists(), true)
  await search.setValue('beta')
  await new Promise(resolve => setTimeout(resolve, 275))
  assert.deepEqual(replacements.at(-1), { name: 'PublicPricing', query: { search: 'beta', page: '1', pageSize: '20', sort: 'default', direction: 'asc' } })
  const beforeUnmount = replacements.length
  await search.setValue('never-applied')
  wrapper.unmount()
  await new Promise(resolve => setTimeout(resolve, 275))
  assert.equal(replacements.length, beforeUnmount)
  assert.equal(cancellations, 1)
  delete globalThis.__pricingMount
})

test('mounted route changes cancel stale catalog work and only issue the newest model query', async () => {
  installDOM()
  const Pricing = await pricingPage('pricing-page-stale')
  const [{ mount }, { reactive, ref, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
  let releaseFirstSite
  let siteLoads = 0
  let cancellations = 0
  const modelQueries = []
  const store = ref({ site: { status: 'ready', data: { priceVisibility: 'visible' } }, models: { status: 'ready-empty', data: emptyCatalog() }, details: {} })
  store.loadSite = async () => {
    siteLoads++
    if (siteLoads === 1) await new Promise(resolve => { releaseFirstSite = resolve })
    return store.value.site.data
  }
  store.loadModels = async query => { modelQueries.push(query); return store.value.models.data }
  store.cancel = slot => { assert.equal(slot, 'models'); cancellations++ }
  const route = reactive({ query: { search: '', page: '1', pageSize: '20', sort: 'default', direction: 'asc' }, fullPath: '/pricing?page=1&pageSize=20&sort=default&direction=asc' })
  globalThis.__pricingMount = { route, router: { replace: async () => {} } }
  const wrapper = mount(Pricing, { global: { provide: { 'public-home-publication': { store, ready: Promise.resolve() } } } })
  await nextTick()
  route.query = { search: 'newest', page: '1', pageSize: '20', sort: 'default', direction: 'asc' }
  route.fullPath = '/pricing?search=newest&page=1&pageSize=20&sort=default&direction=asc'
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  releaseFirstSite()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(cancellations, 1)
  assert.deepEqual(modelQueries, [{ search: 'newest', pricingType: 'token', page: 1, pageSize: 20, sort: 'default', order: 'asc' }])
  wrapper.unmount()
  assert.equal(cancellations, 2)
  delete globalThis.__pricingMount
})

test('mounted mobile cards render the real input and output catalog prices with token units', async () => {
  installDOM()
  const vueURL = new URL('../../../node_modules/vue/index.mjs', import.meta.url).href
  const runtimeStub = dataModule("export const usePublicI18n=()=>({t:key=>key})")
  const pricingUtils = new URL('../../utils/public-pricing-query.js', import.meta.url).href
  const cardsURL = await compileSFC('../../components/public/PricingCards.vue', 'pricing-cards-real-prices', [
    ['vue', vueURL], ['@/i18n/public-runtime.js', runtimeStub], ['@/utils/public-pricing-query.js', pricingUtils],
  ])
  const Cards = (await import(`${cardsURL}#${Date.now()}`)).default
  const { mount } = await import('@vue/test-utils')
  const wrapper = mount(Cards, { props: { models: [{ modelKey: 'real/model', displayName: 'Real model', provider: 'Provider', inputPrice: '1.25', outputPrice: '6.50', priceVisibility: 'visible', publicDisplayGroup: 'Published', updatedAt: '2026-09-14T00:00:00Z', capabilities: ['chat'], endpointTypes: ['responses'] }] }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
  const prices = wrapper.findAll('.pricing-card-price')
  assert.equal(prices.length, 2)
  assert.deepEqual(prices.map(group => group.find('dt').text()), ['pricingCatalog.inputPrice', 'pricingCatalog.outputPrice'])
  assert.deepEqual(prices.map(group => group.find('dd').text()), ['1.25pricingCatalog.unit', '6.50pricingCatalog.unit'])
  wrapper.unmount()
})

test('mounted protected pricing blocks anonymous numeric sort and enables it after refresh-cookie recovery', async () => {
  installDOM('https://local.test/pricing?sort=input')
  const vueURL = new URL('../../../node_modules/vue/index.mjs', import.meta.url).href
  const runtimeStub = dataModule("export const usePublicI18n=()=>({t:key=>key})")
  const styleStub = dataModule('export default {}')
  const filtersURL = await compileSFC('../../components/public/PricingFilters.vue', 'pricing-filters-mounted', [['vue', vueURL], ['@/i18n/public-runtime.js', runtimeStub]])
  const componentStub = dataModule(`import {defineComponent,h} from '${vueURL}';export default defineComponent({props:['status','message'],emits:['retry'],setup:(p)=>()=>h('div',p.message||p.status||'stub')})`)
  const routerStub = dataModule('export const useRoute=()=>globalThis.__pricingMount.route;export const useRouter=()=>globalThis.__pricingMount.router')
  const pricingUtils = new URL('../../utils/public-pricing-query.js', import.meta.url).href
  const pricingURL = await compileSFC('./Pricing.vue', 'pricing-page-mounted', [
    ['vue', vueURL], ['vue-router', routerStub],
    ['@/components/public/PricingFilters.vue', filtersURL], ['@/components/public/PricingTable.vue', componentStub],
    ['@/components/public/PricingCards.vue', componentStub], ['@/components/public/PublicContentState.vue', componentStub],
    ['@/utils/public-pricing-query.js', pricingUtils], ['@/i18n/public-runtime.js', runtimeStub], ['@/styles/public-pricing.scss', styleStub],
  ])
  const code = Buffer.from(pricingURL.split(',')[1], 'base64').toString().replace("import('@/api/request.js')", 'globalThis.__pricingMount.loadAuth()')
  const Pricing = (await import(`${dataModule(code)}#${Date.now()}`)).default
  const [{ mount }, { ref, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])

  async function scenario(authenticated) {
    let modelRequests = 0
    const store = ref({ site: { status: 'ready', data: { priceVisibility: 'authenticated_only' } }, models: { status: 'idle', data: null }, details: {} })
    store.loadSite = async () => store.value.site.data
    store.loadModels = async () => { modelRequests++; store.value.models = { status: 'ready-empty', data: { items: [], total: 0, facets: { providers: [], capabilities: [], endpointTypes: [], publicDisplayGroups: [] } } } }
    store.cancel = () => {}
    let state = 'initializing'
    const authSession = { ensureSession: async () => { state = authenticated ? 'authenticated' : 'anonymous'; return authenticated }, state: () => state, accessToken: () => authenticated ? 'access' : null, capture: () => ({ epoch: 'e', generation: 1, permissionRevision: 1, token: 'access' }), subscribe: () => () => {} }
    globalThis.__pricingMount = { route: { query: { sort: 'input' }, fullPath: '/pricing?sort=input' }, router: { replace: async () => {} }, loadAuth: async () => ({ authSession }) }
    const wrapper = mount(Pricing, { global: { provide: { 'public-home-publication': { store, ready: Promise.resolve() } }, stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
    const numeric = wrapper.findAll('option').filter(option => ['pricingCatalog.inputPrice', 'pricingCatalog.outputPrice'].includes(option.text()))
    assert.equal(numeric.length, 2); assert.ok(numeric.every(option => option.attributes('disabled') !== undefined) === !authenticated)
    assert.equal(modelRequests, authenticated ? 1 : 0)
    if (!authenticated) assert.match(wrapper.text(), /pricingCatalog\.sortLoginRequired/)
    wrapper.unmount()
  }
  await scenario(false); await scenario(true)
  delete globalThis.__pricingMount
})

test('mobile pricing drawer traps focus, closes on Escape and clears modal focus when crossing to desktop', async () => {
  if (!globalThis.document) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/pricing' })
    for (const key of ['window', 'document', 'navigator', 'history', 'location', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  }
  document.body.replaceChildren()
  const listeners = new Set()
  const desktop = {
    matches: false,
    media: '(min-width: 768px)',
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener) },
    dispatch(matches) { this.matches = matches; for (const listener of [...listeners]) listener({ matches, media: this.media }) },
  }
  window.matchMedia = query => { assert.equal(query, '(min-width: 768px)'); return desktop }
  const vueURL = new URL('../../../node_modules/vue/index.mjs', import.meta.url).href
  const runtimeStub = dataModule("export const usePublicI18n=()=>({t:key=>key})")
  const styleStub = dataModule('export default {}')
  const filtersURL = await compileSFC('../../components/public/PricingFilters.vue', 'pricing-filters-drawer', [['vue', vueURL], ['@/i18n/public-runtime.js', runtimeStub]])
  const componentStub = dataModule(`import {defineComponent,h} from '${vueURL}';export default defineComponent({props:['status','message'],emits:['retry'],setup:(p)=>()=>h('div',p.message||p.status||'stub')})`)
  const routerStub = dataModule('export const useRoute=()=>globalThis.__pricingMount.route;export const useRouter=()=>globalThis.__pricingMount.router')
  const pricingUtils = new URL('../../utils/public-pricing-query.js', import.meta.url).href
  const pricingURL = await compileSFC('./Pricing.vue', 'pricing-page-drawer', [
    ['vue', vueURL], ['vue-router', routerStub],
    ['@/components/public/PricingFilters.vue', filtersURL], ['@/components/public/PricingTable.vue', componentStub],
    ['@/components/public/PricingCards.vue', componentStub], ['@/components/public/PublicContentState.vue', componentStub],
    ['@/utils/public-pricing-query.js', pricingUtils], ['@/i18n/public-runtime.js', runtimeStub], ['@/styles/public-pricing.scss', styleStub],
  ])
  const Pricing = (await import(`${pricingURL}#${Date.now()}`)).default
  const [{ mount }, { ref, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
  const store = ref({ site: { status: 'ready', data: { priceVisibility: 'visible' } }, models: { status: 'ready-empty', data: { items: [], total: 0, facets: { providers: [], capabilities: [], endpointTypes: [], publicDisplayGroups: [] } } }, details: {} })
  store.loadSite = async () => store.value.site.data
  store.loadModels = async () => store.value.models.data
  store.cancel = () => {}
  globalThis.__pricingMount = { route: { query: {}, fullPath: '/pricing' }, router: { replace: async () => {} } }
  const wrapper = mount(Pricing, { attachTo: document.body, global: { provide: { 'public-home-publication': { store, ready: Promise.resolve() } }, stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
  await nextTick()
  const trigger = wrapper.find('.pricing-filter-toggle')
  await trigger.trigger('click'); await nextTick()
  let dialog = wrapper.find('[role="dialog"]')
  let focusable = dialog.findAll('button,input,select')
  assert.equal(document.activeElement, focusable[0].element)
  focusable.at(-1).element.focus()
  await dialog.trigger('keydown', { key: 'Tab' })
  assert.equal(document.activeElement, focusable[0].element)
  await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
  assert.equal(document.activeElement, focusable.at(-1).element)
  await dialog.trigger('keydown', { key: 'Escape' }); await nextTick()
  assert.equal(wrapper.find('[role="dialog"]').exists(), false)
  assert.equal(document.activeElement, trigger.element)

  await trigger.trigger('click'); await nextTick()
  assert.equal(wrapper.find('[role="dialog"]').exists(), true)
  assert.equal(listeners.size, 1)
  desktop.dispatch(true); await nextTick()
  assert.equal(wrapper.find('[role="dialog"]').exists(), false)
  assert.equal(trigger.attributes('aria-expanded'), 'false')
  assert.equal(document.activeElement, trigger.element)

  desktop.dispatch(false)
  await trigger.trigger('click'); await nextTick()
  trigger.element.focus = () => {}
  desktop.dispatch(true); await nextTick()
  assert.equal(wrapper.find('[role="dialog"]').exists(), false)
  assert.equal(document.activeElement, wrapper.find('.pricing-heading h1').element)
  wrapper.unmount()
  assert.equal(listeners.size, 0)
  delete globalThis.__pricingMount
})
