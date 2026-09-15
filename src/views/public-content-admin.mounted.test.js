import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/admin/public-content' })
for (const key of ['window','document','Document','navigator','Node','Element','HTMLElement','HTMLDialogElement','HTMLInputElement','SVGElement','Event','MouseEvent','KeyboardEvent','MutationObserver']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
HTMLDialogElement.prototype.showModal = function () { this.open = true }
HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
const [{ mount }, vue] = await Promise.all([import('@vue/test-utils'), import('vue')])
const { nextTick, reactive } = vue
const data = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const home = revision => ({ revision, announcements: [], faqs: [], featuredModelKeys: [] })
const documents = revision => ({ revision, about: '# About', terms: '# Terms', privacy: '# Privacy', legalReviewed: true })
const responseHome = (revision, patch = {}) => ({ ...home(revision), ...patch })

afterEach(() => {
  document.body.replaceChildren(); window.localStorage.clear(); window.sessionStorage.clear()
  delete globalThis.__homeApi; delete globalThis.__modelApi; delete globalThis.__pcRouter; delete globalThis.__pcUser
})

async function component() {
  const source = await readFile(new URL('./PublicContentAdmin.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'PublicContentAdmin.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'task10-admin', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'task10-admin', filename: 'PublicContentAdmin.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const vueURL = new URL('../../node_modules/vue/index.mjs', import.meta.url).href
  const shell = data(`import{defineComponent,h}from'${vueURL}';export default defineComponent({inheritAttrs:false,setup(_,{attrs,slots}){return()=>h('section',attrs,[slots.default?.(),slots.actions?.()])}})`)
  const editor = marker => data(`import{defineComponent,h}from'${vueURL}';export default defineComponent({inheritAttrs:false,props:['items','selected','results','search','searching','busy','labels'],emits:['create','update','remove','move','save','search'],setup(p,{attrs,emit}){return()=>h('section',{...attrs,'data-editor':'${marker}'},[h('button',{'data-action':'create',onClick:()=>emit('create',{title:'本地公告',bodyMarkdown:'正文',effectiveAt:null,isVisible:true,sortOrder:10})},'create'),h('button',{'data-action':'save-featured',onClick:()=>emit('save',['model-a'])},'featured'),h('input',{'data-action':'search',value:p.search,onInput:e=>emit('search',e.target.value)})])}})`)
  const modules = new Map([
    ['vue', vueURL],
    ['vue-router', data('export const useRouter=()=>globalThis.__pcRouter')],
    ['@/api/publicHomeContentAdmin.js', data('export const publicHomeContentAdminApi=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__homeApi[key](...args)})')],
    ['@/api/publicModelAdmin.js', data('export const publicModelAdminApi=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__modelApi[key](...args)})')],
    ['@/composables/useI18n', data("export const useI18n=()=>({t:(key,p)=>key+(p?.revision?':'+p.revision:'')})")],
    ['@/stores/user', data('export const useUserStore=()=>globalThis.__pcUser')],
    ['@/components/public-admin/AnnouncementEditor.vue', editor('announcement')],
    ['@/components/public-admin/FaqEditor.vue', editor('faq')],
    ['@/components/public-admin/FeaturedModelSelector.vue', editor('featured-models')],
    ['@/components/public-admin/SafeMarkdownEditor.vue', data(`import{defineComponent,h}from'${vueURL}';export default defineComponent({props:['modelValue','id'],emits:['update:modelValue'],setup(p,{emit}){return()=>h('textarea',{id:p.id,value:p.modelValue,onInput:e=>emit('update:modelValue',e.target.value)})}})`) ],
    ['@/components/shell/PageHeader.vue', shell], ['@/components/shell/SurfaceCard.vue', shell], ['@/components/shell/StatusBadge.vue', shell],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [from, to] of modules) code = code.replaceAll(`from '${from}'`, `from '${to}'`).replaceAll(`from'${from}'`, `from'${to}'`).replaceAll(`from "${from}"`, `from "${to}"`).replaceAll(`from"${from}"`, `from"${to}"`)
  return (await import(data(code))).default
}

async function flush() { for (let index = 0; index < 8; index++) await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
async function setup(overrides = {}, modelOverrides = {}) {
  const calls = []
  globalThis.__pcUser = reactive({ user: { role: 'root' } })
  globalThis.__pcRouter = { replace: async value => { globalThis.__pcRouter.replaced = value } }
  globalThis.__homeApi = {
    getHomeDraft: async () => home(4), getDocumentsDraft: async () => documents(4),
    createAnnouncement: async value => (calls.push(['createAnnouncement', value]), responseHome(value.expectedRevision + 1, { announcements: [{ guid: '1', title: value.title, bodyMarkdown: value.bodyMarkdown, effectiveAt: value.effectiveAt, isVisible: value.isVisible, sortOrder: value.sortOrder }] })),
    updateAnnouncement: async (guid, value) => (calls.push(['updateAnnouncement', guid, value]), responseHome(value.expectedRevision + 1)),
    deleteAnnouncement: async (guid, revision) => (calls.push(['deleteAnnouncement', guid, revision]), revision + 1),
    createFAQ: async value => (calls.push(['createFAQ', value]), responseHome(value.expectedRevision + 1)),
    updateFAQ: async (guid, value) => (calls.push(['updateFAQ', guid, value]), responseHome(value.expectedRevision + 1)),
    deleteFAQ: async (guid, revision) => (calls.push(['deleteFAQ', guid, revision]), revision + 1),
    saveFeaturedModels: async (revision, keys) => (calls.push(['saveFeaturedModels', revision, keys]), responseHome(revision + 1, { featuredModelKeys: keys })),
    saveDocumentsDraft: async value => (calls.push(['saveDocumentsDraft', value]), { ...documents(value.expectedRevision + 1), ...value, revision: value.expectedRevision + 1 }),
    ...overrides,
  }
  globalThis.__modelApi = { list: async (filters, options) => (calls.push(['search', filters, options]), { items: [] }), ...modelOverrides }
  const wrapper = mount(await component(), { attachTo: document.body }); await flush()
  return { wrapper, calls }
}

test('structured admin loads only a matching home and document generation and has no legacy home markdown', async () => {
  const { wrapper } = await setup()
  for (const marker of ['announcement','faq','featured-models']) assert.equal(wrapper.find(`[data-editor="${marker}"]`).exists(), true)
  assert.equal(wrapper.find('#content-home').exists(), false)
  assert.equal(wrapper.vm.revision, 4)
  assert.deepEqual(wrapper.vm.documentNames, ['about','terms','privacy'])
  assert.deepEqual(wrapper.vm.homeSections, ['announcements','faqs','featuredModels'])
  assert.equal(wrapper.find('[data-task11-disabled]').exists(), true)
  wrapper.unmount()
})

test('mismatched initial generations are reread once and never rendered together', async () => {
  let homeReads = 0, documentReads = 0
  const { wrapper } = await setup({ getHomeDraft: async () => home(++homeReads === 1 ? 4 : 6), getDocumentsDraft: async () => documents(++documentReads === 1 ? 5 : 7) })
  assert.equal(homeReads, 2); assert.equal(documentReads, 2)
  assert.equal(wrapper.vm.ready, null)
  assert.equal(wrapper.vm.revision, null)
  assert.equal(wrapper.vm.error.code, 'revision_conflict')
  assert.equal(wrapper.find('[data-editor="announcement"]').exists(), false)
  wrapper.unmount()
})

test('every structured write carries the current aggregate revision and advances from the full response', async () => {
  const { wrapper, calls } = await setup()
  await wrapper.get('[data-editor="announcement"] [data-action="create"]').trigger('click'); await flush()
  assert.equal(calls[0][0], 'createAnnouncement')
  assert.equal(calls[0][1].expectedRevision, 4)
  assert.equal(wrapper.vm.revision, 5)
  await wrapper.get('[data-editor="featured-models"] [data-action="save-featured"]').trigger('click'); await flush()
  const featured = calls.find(call => call[0] === 'saveFeaturedModels')
  assert.deepEqual(featured.slice(1), [5, ['model-a']])
  assert.equal(wrapper.vm.revision, 6)
  assert.equal(wrapper.vm.validationProof, null)
  wrapper.unmount()
})

test('every remaining Root mutation carries the current aggregate revision', async () => {
  const cases = [
    ['updateAnnouncement', [{ guid: '1', title: 'Updated', bodyMarkdown: 'Body', effectiveAt: null, isVisible: true, sortOrder: 10 }], 'updateAnnouncement', call => call[2].expectedRevision],
    ['deleteAnnouncement', ['1'], 'deleteAnnouncement', call => call[2]],
    ['createFAQ', [{ question: 'Question', answerMarkdown: 'Answer', isVisible: true, sortOrder: 10 }], 'createFAQ', call => call[1].expectedRevision],
    ['updateFAQ', [{ guid: '2', question: 'Updated?', answerMarkdown: 'Answer', isVisible: true, sortOrder: 10 }], 'updateFAQ', call => call[2].expectedRevision],
    ['deleteFAQ', ['2'], 'deleteFAQ', call => call[2]],
    ['saveDocuments', [], 'saveDocumentsDraft', call => call[1].expectedRevision],
  ]
  for (const [method, args, callName, revisionOf] of cases) {
    const { wrapper, calls } = await setup()
    await wrapper.vm[method](...args); await flush()
    const call = calls.find(item => item[0] === callName)
    assert.ok(call, `${callName} must be called`)
    assert.equal(revisionOf(call), 4)
    wrapper.unmount()
  }
})

test('sorting performs one PATCH when an integer gap exists and otherwise fails without transport', async () => {
  const withGap = await setup({
    getHomeDraft: async () => responseHome(4, { announcements: [
      { guid: '1', title: 'A', bodyMarkdown: 'A', effectiveAt: null, isVisible: true, sortOrder: 10 },
      { guid: '2', title: 'B', bodyMarkdown: 'B', effectiveAt: null, isVisible: true, sortOrder: 20 },
    ] }),
  })
  await withGap.wrapper.vm.moveAnnouncement({ guid: '2', direction: -1 }); await flush()
  const patches = withGap.calls.filter(call => call[0] === 'updateAnnouncement')
  assert.equal(patches.length, 1)
  assert.equal(patches[0][2].sortOrder, 5)
  withGap.wrapper.unmount()

  const withoutGap = await setup({
    getHomeDraft: async () => responseHome(4, { announcements: [
      { guid: '1', title: 'A', bodyMarkdown: 'A', effectiveAt: null, isVisible: true, sortOrder: 0 },
      { guid: '2', title: 'B', bodyMarkdown: 'B', effectiveAt: null, isVisible: true, sortOrder: 1 },
    ] }),
  })
  await withoutGap.wrapper.vm.moveAnnouncement({ guid: '2', direction: -1 }); await flush()
  assert.equal(withoutGap.calls.some(call => call[0] === 'updateAnnouncement'), false)
  assert.equal(withoutGap.wrapper.vm.error.code, 'sort_gap_required')
  withoutGap.wrapper.unmount()
})

test('409 keeps local input only in memory, rereads authority, shows a side by side diff, and never replays', async () => {
  let creates = 0, reads = 0
  const conflict = Object.assign(new Error('conflict'), { code: 'revision_conflict', requestId: 'req-409' })
  const { wrapper } = await setup({
    getHomeDraft: async () => home(++reads > 1 ? 5 : 4),
    getDocumentsDraft: async () => documents(reads > 1 ? 5 : 4),
    createAnnouncement: async () => { creates++; throw conflict },
  })
  await wrapper.get('[data-editor="announcement"] [data-action="create"]').trigger('click'); await flush()
  assert.equal(creates, 1)
  assert.equal(wrapper.vm.revision, 5)
  assert.equal(wrapper.vm.conflictBuffer.local.title, '本地公告')
  assert.equal(wrapper.vm.conflictBuffer.server.home.revision, 5)
  assert.equal(wrapper.findAll('.conflict-columns section').length, 2)
  assert.equal(window.localStorage.length, 0); assert.equal(window.sessionStorage.length, 0)
  wrapper.unmount()
})

test('model search aborts its predecessor, ignores late data, and requests only active present complete models', async () => {
  const first = deferred(), second = deferred(), searches = []
  const { wrapper } = await setup({}, { list: (filters, options) => { searches.push({ filters, signal: options.signal }); return searches.length === 1 ? first.promise : second.promise } })
  void wrapper.vm.searchModels('old'); await Promise.resolve()
  const latest = wrapper.vm.searchModels('new'); await Promise.resolve()
  assert.equal(searches[0].signal.aborted, true)
  assert.deepEqual(searches[1].filters, { search: 'new', status: 'active', upstreamState: 'present', completeness: 'complete', page: 1, pageSize: 20 })
  first.resolve({ items: [{ guid: '1', modelKey: 'old', displayName: 'Old' }] })
  second.resolve({ items: [{ guid: '2', modelKey: 'new', displayName: 'New' }] })
  await latest; await flush()
  assert.deepEqual(wrapper.vm.modelResults.map(item => item.modelKey), ['new'])
  wrapper.unmount()
})

test('Root demotion aborts reads and search, clears sensitive state, redirects, and rejects late responses', async () => {
  const lateHome = deferred(), lateDocuments = deferred(), lateSearch = deferred(); let homeSignal, documentSignal, searchSignal
  const { wrapper } = await setup({
    getHomeDraft: options => { homeSignal = options.signal; return lateHome.promise },
    getDocumentsDraft: options => { documentSignal = options.signal; return lateDocuments.promise },
  }, { list: (_filters, options) => { searchSignal = options.signal; return lateSearch.promise } })
  void wrapper.vm.searchModels('secret-query'); await Promise.resolve()
  globalThis.__pcUser.user.role = 'admin'; await nextTick()
  assert.equal(homeSignal.aborted, true); assert.equal(documentSignal.aborted, true); assert.equal(searchSignal.aborted, true)
  assert.equal(wrapper.vm.homeDraft, null); assert.equal(wrapper.vm.documentsDraft, null); assert.equal(wrapper.vm.conflictBuffer, null); assert.deepEqual(wrapper.vm.modelResults, [])
  assert.equal(globalThis.__pcRouter.replaced, '/chat')
  lateHome.resolve(home(99)); lateDocuments.resolve(documents(99)); lateSearch.resolve({ items: [{ modelKey: 'leaked' }] }); await flush()
  assert.equal(wrapper.vm.homeDraft, null); assert.deepEqual(wrapper.vm.modelResults, [])
  wrapper.unmount()
})

test('Root demotion aborts an owned write and its late response cannot restore privileged data', async () => {
  const lateWrite = deferred(); let writeSignal
  const { wrapper } = await setup({ createAnnouncement: (value, options) => { writeSignal = options.signal; return lateWrite.promise } })
  const pending = wrapper.vm.createAnnouncement({ title: 'Private draft', bodyMarkdown: 'secret body', effectiveAt: null, isVisible: true, sortOrder: 10 })
  await Promise.resolve()
  globalThis.__pcUser.user.role = 'admin'; await nextTick()
  assert.equal(writeSignal.aborted, true)
  lateWrite.resolve(responseHome(99, { announcements: [{ guid: '99', title: 'Leaked', bodyMarkdown: 'secret', effectiveAt: null, isVisible: true, sortOrder: 10 }] }))
  await pending; await flush()
  assert.equal(wrapper.vm.homeDraft, null)
  assert.equal(wrapper.vm.documentsDraft, null)
  assert.equal(wrapper.vm.revision, null)
  wrapper.unmount()
})

test('editing fixed documents invalidates any earlier validation proof before save', async () => {
  const { wrapper } = await setup()
  wrapper.vm.validationProof = { valid: true, revision: 4 }
  await wrapper.get('#content-about').setValue('# Changed')
  await nextTick()
  assert.equal(wrapper.vm.validationProof, null)
  wrapper.unmount()
})

test('Task10 source keeps fixed documents, single-item sort patches, and no draft storage', async () => {
  const source = await readFile(new URL('./PublicContentAdmin.vue', import.meta.url), 'utf8')
  assert.match(source, /documentNames=\['about','terms','privacy'\]/)
  assert.match(source, /homeSections=\['announcements','faqs','featuredModels'\]/)
  assert.match(source, /getHomeDraft/); assert.match(source, /getDocumentsDraft/); assert.match(source, /publicModelAdminApi\.list/)
  assert.doesNotMatch(source, /content-home|localStorage|sessionStorage|dragstart|draggable/)
  assert.match(source, /sort_gap_required/)
})
