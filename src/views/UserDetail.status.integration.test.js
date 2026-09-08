import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/users/123456789012345678', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'Node', 'NodeFilter', 'Element', 'HTMLElement', 'HTMLInputElement', 'SVGElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'AbortController', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key]
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.CSS ||= { supports: () => false }
globalThis.HTMLElement.prototype.scrollIntoView ||= function scrollIntoView() {}

const [{ mount }, pinia, vue] = await Promise.all([import('@vue/test-utils'), import('pinia'), import('vue')])
const { createPinia } = pinia
const { nextTick, reactive } = vue
const vite = await createServer({ root: new URL('../../', import.meta.url).pathname, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', ssr: { noExternal: ['element-plus', 'async-validator'] } })
after(() => vite.close())
const { default: ElementPlus } = await vite.ssrLoadModule('element-plus')
const statusModuleURL = new URL('../stores/admin-user-status.js', import.meta.url).href
const { useAdminUserStatusStore } = await import(statusModuleURL)
const vueURL = new URL('../../node_modules/vue/index.mjs', import.meta.url).href
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const childStub = moduleURL(`import { h } from '${vueURL}'; export default { props:['owner'], emits:['succeeded','conflict','failed','closed'], setup(props,{emit}) { const fire=(name,...args)=>{globalThis.__a06View.stubEvents.push([name,...args]);emit(name,...args)}; return () => h('div', {'data-status-owner': String(Boolean(props.owner))}, [h('button',{id:'emit-status-conflict',onClick:()=>fire('conflict',props.owner)},'conflict'),h('button',{id:'emit-status-forbidden',onClick:()=>fire('failed','forbidden',props.owner)},'forbidden'),h('button',{id:'emit-status-not-found',onClick:()=>fire('failed','not_found',props.owner)},'not found')]) } }`)
const emptyChild = moduleURL(`import { h } from '${vueURL}'; export default { setup(){ return () => h('div') } }`)
const routeModule = moduleURL(`export function useRoute(){ return globalThis.__a06View.route }`)
const userModule = moduleURL(`export function useUserStore(){ return globalThis.__a06View.userStore }`)
const usersModule = moduleURL(`export function useAdminUsersStore(){ return globalThis.__a06View.store }`)
const actionsModule = moduleURL(`export function useAdminUserActionsStore(){ return globalThis.__a06View.actionStore }; export const canDeleteAdminUser=()=>false; export const reconcileDeletedDetail=()=>false; export const refreshDeleteTargetFailClosed=async()=>false; export const restoreDeleteTriggerFocus=()=>false`)
const editModule = moduleURL(`export function useAdminUserEditStore(){ return globalThis.__a06View.editStore }; export const canOpenAdminUserEdit=()=>false`)
const entitlementStoreModule = moduleURL(`export function useAdminUserPasswordResetStore(){ return globalThis.__a06View.entitlementStore }; export function useAdminUserGroupChangeStore(){ return globalThis.__a06View.entitlementStore }; export function useAdminUserPlanChangeStore(){ return globalThis.__a06View.entitlementStore }`)
const entitlementsModule = moduleURL(`export const canOpenPasswordReset=()=>false; export const canOpenGroupChange=()=>false; export const canOpenPlanChange=()=>false`)
const apiModule = moduleURL(`export async function getAdminUser(guid, options){ return globalThis.__a06View.getAdminUser(guid, options) }`)
const i18nModule = moduleURL(`export function useI18n(){ return {t:key=>key} }`)
const messageModule = moduleURL(`export const ElMessage={warning(){}}`)

async function loadViewComponent() {
  const source = await readFile(new URL('./UserDetail.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'UserDetail.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'a06-user-detail-integration', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'a06-user-detail-integration', filename: 'UserDetail.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const replacements = new Map([
    ['vue', vueURL], ['vue-router', routeModule], ['@/stores/user', userModule], ['@/stores/admin-users', usersModule],
    ['@/stores/admin-user-actions', actionsModule], ['@/stores/admin-user-edit', editModule], ['@/stores/admin-user-status', statusModuleURL],
    ['@/stores/admin-user-password-reset', entitlementStoreModule], ['@/stores/admin-user-group-change', entitlementStoreModule],
    ['@/stores/admin-user-plan-change', entitlementStoreModule], ['@/stores/admin-user-entitlements', entitlementsModule],
    ['@/api/admin-users', apiModule], ['@/components/admin/UserSoftDeleteDialog.vue', emptyChild], ['@/components/admin/UserNicknameEditDialog.vue', emptyChild],
    ['@/components/admin/UserStatusDialog.vue', childStub], ['@/components/admin/UserPasswordResetDialog.vue', emptyChild],
    ['@/components/admin/UserGroupChangeDialog.vue', emptyChild], ['@/components/admin/UserPlanChangeDialog.vue', emptyChild],
    ['@/composables/useI18n', i18nModule], ['element-plus', messageModule],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  return (await import(moduleURL(code))).default
}
const View = await loadViewComponent()
const target = Object.freeze({ guid:'123456789012345678', username:'alice', nickname:'Alice', email:null, group:'default', planType:'free', role:'admin', status:'active', authVersion:7, createdAt:'2026-09-08T00:00:00Z', lastLoginAt:null })
const permissions = Object.freeze({ capabilities:[{ name:'users.read', baseline:true, override:'inherit', policy_effective:true, effective:true }] })
const later = () => new Promise(resolve => setTimeout(resolve, 0))
async function flush() { for (let i=0;i<8;i++) await nextTick(); await later(); await nextTick() }
function deferred() { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no}); return {promise,resolve,reject} }

async function mountHarness({ fetchSelf = async()=>{}, loadDetail, getAdminUser } = {}) {
  const route = reactive({ params:{ guid:target.guid } })
  const userStore = reactive({ user:{role:'root',guid:'1'}, permissionProjection:{capabilities:['users.read','users.disable','users.enable']}, identityEpoch:'epoch-1', permissionRevision:1, clearSession(){ this.user=null; this.permissionProjection=null }, fetchSelf })
  const store = reactive({ selected:{...target}, rows:[{...target}], permissions, detailError:null, detailLoading:false, loadCalls:0,
    async loadDetail(guid, options){ this.loadCalls++; if (loadDetail) return loadDetail.call(this,guid,options); return this.selected }, clear(){ this.selected=null; this.rows=[]; this.permissions=null } })
  const actionStore = { owns:()=>false, close:()=>false, open:()=>null, dispose(){}, captureOwnership:()=>null, updateTarget:()=>false, invalidateTarget(){} }
  const editStore = { owns:()=>false, close:()=>false, open:()=>null, dispose(){}, updateContext:()=>false }
  const entitlementStore = { owns:()=>false, close:()=>false, open:()=>null, dispose(){}, updateContext:()=>false, refreshConflict:async()=>false }
  let getCalls=0
  globalThis.__a06View = { route,userStore,store,actionStore,editStore,entitlementStore,stubEvents:[],getAdminUser:async(...args)=>{getCalls++; return getAdminUser(...args)} }
  const wrapper = mount(View, { attachTo:document.body, global:{ plugins:[createPinia(),ElementPlus], mocks:{ $router:{push(){}} } } })
  await flush()
  return { wrapper,route,userStore,store,statusStore:useAdminUserStatusStore(),getCalls:()=>getCalls }
}
function statusButton(wrapper) { return wrapper.findAll('button').find(button => button.text()==='禁用' || button.text()==='启用') }
async function openStatus(state) { const button=statusButton(state.wrapper); assert.ok(button?.exists()); await button.trigger('click'); await flush(); assert.equal(state.statusStore.isOpen,true); assert.equal(state.wrapper.get('[data-status-owner]').attributes('data-status-owner'),'true') }

for (const failure of ['forbidden','not_found']) test(`${failure} invalidates status action and a later current successful detail load restores it without dropping permissions`, async()=>{
  let firstIdentity=true
  let detailAttempt=0
  const state=await mountHarness({ fetchSelf:async()=>{ if(failure==='forbidden'&&firstIdentity){firstIdentity=false;throw new Error('temporary')} },
    loadDetail:async function(){ detailAttempt++; if(failure==='not_found'&&detailAttempt===2) throw new Error('temporary'); return this.selected }, getAdminUser:async()=>({...target}) })
  try {
    await openStatus(state); await state.wrapper.get(failure==='forbidden'?'#emit-status-forbidden':'#emit-status-not-found').trigger('click'); await flush()
    assert.equal(statusButton(state.wrapper),undefined); assert.equal(state.store.permissions,permissions)
    state.userStore.permissionRevision++; await flush()
    assert.ok(statusButton(state.wrapper)?.exists()); assert.equal(state.store.permissions,permissions)
  } finally { state.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a06View }
})

for (const conflictCode of ['auth_version_conflict','user_status_conflict']) test(`${conflictCode} events share exactly one target GET, preserve permissions, and never replay a status mutation`, async()=>{
  const refresh=deferred(); const state=await mountHarness({ getAdminUser:()=>refresh.promise })
  try {
    await openStatus(state); state.statusStore.state='conflict'; state.statusStore.failureCode=conflictCode; state.statusStore.requiresTargetRefresh=true
    const emit=state.wrapper.get('#emit-status-conflict'); await Promise.all([emit.trigger('click'),emit.trigger('click')]); await nextTick()
    assert.equal(globalThis.__a06View.stubEvents.length,2); assert.equal(state.getCalls(),1)
    refresh.resolve({...target,authVersion:8}); await flush()
    assert.equal(state.store.selected.authVersion,8); assert.equal(state.store.permissions,permissions); assert.equal(state.statusStore.isOpen,true)
  } finally { state.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a06View }
})

test('conflict refresh applies a fresh target that makes the original transition ineligible before closing', async()=>{
  const refresh=deferred(); const state=await mountHarness({ getAdminUser:()=>refresh.promise })
  try {
    await openStatus(state); state.statusStore.state='conflict'; state.statusStore.failureCode='user_status_conflict'; state.statusStore.requiresTargetRefresh=true
    await state.wrapper.get('#emit-status-conflict').trigger('click'); await nextTick(); assert.equal(state.getCalls(),1)
    const fresh={...target,status:'disabled',authVersion:8}; refresh.resolve(fresh); await flush()
    assert.equal(state.getCalls(),1); assert.equal(state.statusStore.isOpen,false)
    assert.deepEqual({...state.store.selected},fresh); assert.deepEqual({...state.store.rows[0]},fresh)
    assert.equal(statusButton(state.wrapper)?.text(),'启用')
  } finally { state.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a06View }
})

test('late conflict target is discarded after route identity context changes', async()=>{
  const refresh=deferred(); const state=await mountHarness({ getAdminUser:()=>refresh.promise })
  try {
    await openStatus(state); state.statusStore.state='conflict'; state.statusStore.requiresTargetRefresh=true
    await state.wrapper.get('#emit-status-conflict').trigger('click'); await nextTick(); assert.equal(state.getCalls(),1)
    state.route.params.guid='223456789012345678'; state.userStore.identityEpoch='epoch-2'; await flush()
    const announcement=state.wrapper.get('[role="status"]').text(); refresh.resolve({...target,authVersion:9}); await flush()
    assert.notEqual(state.store.selected?.authVersion,9); assert.equal(state.statusStore.isOpen,false); assert.equal(state.wrapper.get('[role="status"]').text(),announcement)
  } finally { state.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a06View }
})

test('closing the dialog cancels a pending conflict result without changing detail, rows, permissions, or announcement', async()=>{
  const refresh=deferred(); const state=await mountHarness({ getAdminUser:()=>refresh.promise })
  try {
    await openStatus(state); state.statusStore.state='conflict'; state.statusStore.requiresTargetRefresh=true
    await state.wrapper.get('#emit-status-conflict').trigger('click'); await nextTick(); assert.equal(state.getCalls(),1)
    const before={selected:state.store.selected,rows:state.store.rows,permissions:state.store.permissions,announcement:state.wrapper.get('[role="status"]').text()}
    state.statusStore.close(); await nextTick(); refresh.resolve({...target,authVersion:10}); await flush()
    assert.equal(state.store.selected,before.selected); assert.equal(state.store.rows,before.rows); assert.equal(state.store.permissions,before.permissions)
    assert.equal(state.wrapper.get('[role="status"]').text(),before.announcement)
  } finally { state.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a06View }
})

test('status action stays hidden while route is noncanonical or does not own the selected target', async()=>{
  const state=await mountHarness({ getAdminUser:async()=>({...target}) })
  try {
    assert.ok(statusButton(state.wrapper)?.exists()); state.route.params.guid='0123456789012345678'; await flush(); assert.equal(statusButton(state.wrapper),undefined)
    state.route.params.guid='223456789012345678'; await flush(); assert.equal(statusButton(state.wrapper),undefined)
  } finally { state.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a06View }
})
