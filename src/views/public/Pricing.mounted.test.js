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

test('mounted protected pricing blocks anonymous numeric sort and enables it after refresh-cookie recovery', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/pricing?sort=input' })
  for (const key of ['window', 'document', 'navigator', 'history', 'location', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
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
