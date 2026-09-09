import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/users/9', pretendToBeVisual: true })
for (const key of ['window','document','navigator','Node','NodeFilter','Element','HTMLElement','HTMLInputElement','SVGElement','Event','CustomEvent','KeyboardEvent','MouseEvent','FocusEvent','MutationObserver','AbortController','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) {
  const value = ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key]
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.CSS ||= { supports: () => false }
globalThis.HTMLElement.prototype.scrollIntoView ||= function () {}
const [{ mount }, { createPinia }, vue] = await Promise.all([import('@vue/test-utils'), import('pinia'), import('vue')])
const { h, nextTick, reactive } = vue
const vite = await createServer({ root: new URL('../../', import.meta.url).pathname, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', ssr: { noExternal: ['element-plus','async-validator'] } })
after(() => vite.close())
const { default: ElementPlus } = await vite.ssrLoadModule('element-plus')
const vueURL = new URL('../../node_modules/vue/index.mjs', import.meta.url).href
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const empty = moduleURL(`import{h}from'${vueURL}';export default{setup(){return()=>h('div')}}`)
const roleChild = moduleURL(`import{h}from'${vueURL}';export default{props:['owner'],emits:['succeeded','conflict','failed','closed'],setup(p,{emit}){return()=>h('div',{'data-role-owner':String(Boolean(p.owner))},[h('button',{id:'role-success',onClick:()=>{emit('succeeded',globalThis.__a08.result,p.owner);globalThis.__a08.roleStore.close(p.owner)}},'success'),h('button',{id:'role-conflict',onClick:()=>emit('conflict',p.owner)},'conflict')])}}`)
const routeModule = moduleURL(`export function useRoute(){return globalThis.__a08.route}`)
const userModule = moduleURL(`export function useUserStore(){return globalThis.__a08.userStore}`)
const usersModule = moduleURL(`export function useAdminUsersStore(){return globalThis.__a08.store};export function useAdminUserRolePermissionsStore(){return globalThis.__a08.roleStore}`)
const actionsModule = moduleURL(`export function useAdminUserActionsStore(){return globalThis.__a08.dummy};export const canDeleteAdminUser=()=>false,reconcileDeletedDetail=()=>false,refreshDeleteTargetFailClosed=async()=>false,restoreDeleteTriggerFocus=()=>false`)
const editModule = moduleURL(`export function useAdminUserEditStore(){return globalThis.__a08.dummy};export const canOpenAdminUserEdit=()=>false`)
const statusModule = moduleURL(`export function useAdminUserStatusStore(){return globalThis.__a08.dummy};export const canOpenAdminUserStatus=()=>false`)
const otherStores = moduleURL(`export function useAdminUserPasswordResetStore(){return globalThis.__a08.dummy};export function useAdminUserGroupChangeStore(){return globalThis.__a08.dummy};export function useAdminUserPlanChangeStore(){return globalThis.__a08.dummy}`)
const entitlements = moduleURL(`export const canOpenPasswordReset=()=>false,canOpenGroupChange=()=>false,canOpenPlanChange=()=>false`)
const api = moduleURL(`export async function getAdminUser(){return globalThis.__a08.store.selected}`)
const i18n = moduleURL(`export function useI18n(){return{t:k=>k}}`)
const message = moduleURL(`export const ElMessage={warning(){}}`)

async function loadView() {
  const source = await readFile(new URL('./UserDetail.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'UserDetail.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'a08-view', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'a08-view', filename: 'UserDetail.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const replacements = new Map([
    ['vue',vueURL],['vue-router',routeModule],['@/stores/user',userModule],['@/stores/admin-users',usersModule],['@/stores/admin-user-actions',actionsModule],['@/stores/admin-user-edit',editModule],['@/stores/admin-user-status',statusModule],['@/stores/admin-user-password-reset',otherStores],['@/stores/admin-user-group-change',otherStores],['@/stores/admin-user-plan-change',otherStores],['@/stores/admin-user-entitlements',entitlements],['@/api/admin-users',api],['@/components/admin/UserSoftDeleteDialog.vue',empty],['@/components/admin/UserNicknameEditDialog.vue',empty],['@/components/admin/UserStatusDialog.vue',empty],['@/components/admin/UserPasswordResetDialog.vue',empty],['@/components/admin/UserGroupChangeDialog.vue',empty],['@/components/admin/UserPlanChangeDialog.vue',empty],['@/components/admin/UserPromoteDialog.vue',roleChild],['@/components/admin/UserDemoteDialog.vue',roleChild],['@/components/admin/UserPermissionsDialog.vue',roleChild],['@/composables/useI18n',i18n],['element-plus',message],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [from,to] of replacements) code = code.replaceAll(`from '${from}'`,`from '${to}'`).replaceAll(`from "${from}"`,`from '${to}'`).replaceAll(`import('${from}')`,`import('${to}')`).replaceAll(`import("${from}")`,`import('${to}')`)
  return (await import(moduleURL(code))).default
}
const View = await loadView()
const base = { guid:'9', username:'target', nickname:null, email:null, group:'default', planType:'free', role:'user', status:'active', authVersion:7, createdAt:'2026-09-09T00:00:00Z', lastLoginAt:null }
const catalog = { catalog_version:1, capabilities:[] }
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
async function flush() { for (let i=0;i<8;i++) await nextTick(); await new Promise(resolve=>setTimeout(resolve,0)); await nextTick() }
async function harness({ actorRole='root', actorGuid='2', target=base, capabilities=['users.read','users.promote','users.demote','users.permissions.write'], refresh=null }={}) {
  const route=reactive({params:{guid:target.guid}})
  const userStore=reactive({user:{role:actorRole,guid:actorGuid},permissionProjection:{capabilities},identityEpoch:'e1',permissionRevision:1,clearSession(){},fetchSelf:async()=>{}})
  let refreshCalls=0
  const store=reactive({selected:{...target},rows:[{...target}],permissions:target.role==='admin'?{user_guid:target.guid,role:'admin',permissions_version:'3',capabilities:[]}:null,catalog:{...catalog},detailError:null,detailLoading:false,async loadDetail(){return this.selected},async refreshRolePermissionTarget(){refreshCalls++;return refresh?refresh.promise:globalThis.__a08.fresh},clear(){this.selected=null;this.rows=[]}})
  let owner=null,sequence=0
  const roleStore=reactive({isOpen:false,action:null,openPromote(){owner=Object.freeze({id:++sequence});this.isOpen=true;this.action='users.promote';return owner},openDemote(){owner=Object.freeze({id:++sequence});this.isOpen=true;this.action='users.demote';return owner},openPermissions(){owner=Object.freeze({id:++sequence});this.isOpen=true;this.action='users.permissions.write';return owner},owns:t=>t===owner,close(t=owner){if(t!==owner)return false;owner=null;this.isOpen=false;this.action=null;return true},updateContext(){return true},dispose(){owner=null;this.isOpen=false}})
  const dummy={owns:()=>false,close:()=>false,open:()=>null,dispose(){},updateContext:()=>false}
  globalThis.__a08={route,userStore,store,roleStore,dummy,result:{targetGuid:target.guid,resultingRole:'admin',resultingAuthVersion:8,resultingPermissionsVersion:1},fresh:{target:{...target,role:'admin',authVersion:8},permissions:{user_guid:target.guid,role:'admin',permissions_version:'1',capabilities:[]}}}
  const wrapper=mount(View,{attachTo:document.body,global:{plugins:[createPinia(),ElementPlus],mocks:{$router:{push(){}}}}})
  await flush(); return {wrapper,route,userStore,store,roleStore,getRefreshCalls:()=>refreshCalls}
}

test('mounted UserDetail exposes exact A08 controls and excludes non-Root, self, Root, deleted, and stale route targets', async () => {
  const cases = [
    [{},['提升为管理员']],
    [{target:{...base,role:'admin'}},['权限设置','降级为普通用户']],
    [{actorRole:'admin'},[]], [{actorGuid:'9'},[]], [{target:{...base,role:'root'}},[]], [{target:{...base,status:'deleted'}},[]],
  ]
  for (const [input,expected] of cases) { const s=await harness(input); try { const labels=s.wrapper.findAll('button').map(x=>x.text()); for(const text of ['提升为管理员','权限设置','降级为普通用户']) assert.equal(labels.includes(text),expected.includes(text)) } finally { s.wrapper.unmount(); document.body.innerHTML='' } }
  const stale=await harness(); try { stale.route.params.guid='10'; await flush(); assert.equal(stale.wrapper.findAll('button').some(x=>x.text()==='提升为管理员'),false) } finally { stale.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a08 }
})

test('mounted trusted success performs exactly one fresh snapshot and applies no optimistic state', async () => {
  const refresh=deferred(); const s=await harness({refresh}); try {
    const open=s.wrapper.findAll('button').find(x=>x.text()==='提升为管理员'); assert.ok(open); await open.trigger('click'); await flush()
    assert.equal(s.wrapper.get('[data-role-owner]').attributes('data-role-owner'),'true')
    await s.wrapper.get('#role-success').trigger('click'); await flush()
    assert.equal(s.getRefreshCalls(),1); assert.equal(s.store.selected.role,'user')
    refresh.resolve(globalThis.__a08.fresh); await flush()
    assert.equal(s.getRefreshCalls(),1); assert.equal(s.store.selected.role,'admin'); assert.equal(s.store.selected.authVersion,8)
    assert.equal(s.store.permissions.permissions_version,'1')
  } finally { s.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a08 }
})

test('mounted success drops late snapshots after route, identity, capability, target version, catalog, or owner drift', async () => {
  for (const drift of ['route','identity','capability','version','catalog','owner']) {
    const refresh=deferred(); const s=await harness({refresh}); try {
      const open=s.wrapper.findAll('button').find(x=>x.text()==='提升为管理员'); await open.trigger('click'); await flush(); await s.wrapper.get('#role-success').trigger('click'); await flush()
      assert.equal(s.getRefreshCalls(),1)
      if(drift==='route')s.route.params.guid='10'
      if(drift==='identity')s.userStore.identityEpoch='e2'
      if(drift==='capability')s.userStore.permissionRevision=2
      if(drift==='version')s.store.selected.authVersion=9
      if(drift==='catalog')s.store.catalog.catalog_version=2
      if(drift==='owner'){const again=s.wrapper.findAll('button').find(x=>x.text()==='提升为管理员');await again.trigger('click')}
      refresh.resolve(globalThis.__a08.fresh); await flush()
      assert.notEqual(s.store.selected.role,'admin',drift)
    } finally { s.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a08 }
  }
})

test('mounted 409 shares one owned refresh, closes the attempt, and requires a new gesture', async () => {
  const first=deferred(); const s=await harness({refresh:first}); try {
    let open=s.wrapper.findAll('button').find(x=>x.text()==='提升为管理员'); await open.trigger('click'); await flush()
    await Promise.all([s.wrapper.get('#role-conflict').trigger('click'),s.wrapper.get('#role-conflict').trigger('click')]); await flush()
    assert.equal(s.getRefreshCalls(),1)
    first.resolve({target:{...base,authVersion:8},permissions:null}); await flush()
    assert.equal(s.roleStore.isOpen,false); assert.equal(s.store.selected.authVersion,8)
    open=s.wrapper.findAll('button').find(x=>x.text()==='提升为管理员'); assert.ok(open); await open.trigger('click'); await flush()
    assert.equal(s.roleStore.isOpen,true)
  } finally { s.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a08 }
})

test('untrusted stable result never starts a snapshot request', async () => {
  const s=await harness(); try {
    const open=s.wrapper.findAll('button').find(x=>x.text()==='提升为管理员'); await open.trigger('click'); await flush()
    globalThis.__a08.result={...globalThis.__a08.result,resultingAuthVersion:99}
    await s.wrapper.get('#role-success').trigger('click'); await flush()
    assert.equal(s.getRefreshCalls(),0)
    assert.equal(s.store.selected.role,'user')
  } finally { s.wrapper.unmount(); document.body.innerHTML=''; delete globalThis.__a08 }
})
