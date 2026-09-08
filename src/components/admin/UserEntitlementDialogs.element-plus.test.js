import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { compileScript,compileTemplate,parse } from '@vue/compiler-sfc'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'https://local.test/users/9', pretendToBeVisual:true })
for (const key of ['window','document','navigator','Node','NodeFilter','Element','HTMLElement','HTMLInputElement','SVGElement','Event','CustomEvent','KeyboardEvent','MouseEvent','FocusEvent','MutationObserver','AbortController','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) {
  const value=['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key]
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
}
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}
globalThis.CSS||={supports:()=>false}
globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}}
globalThis.HTMLElement.prototype.scrollIntoView||=function(){}

const [{mount},{createPinia},vue]=await Promise.all([import('@vue/test-utils'),import('pinia'),import('vue')])
const {defineComponent,h,nextTick,ref}=vue
const vite=await createServer({root:new URL('../../../',import.meta.url).pathname,logLevel:'silent',server:{middlewareMode:true},appType:'custom',ssr:{noExternal:['element-plus','async-validator']}})
after(()=>vite.close())
const [{default:ElementPlus},passwordStoreModule,groupStoreModule,planStoreModule]=await Promise.all([
  vite.ssrLoadModule('element-plus'),
  import('../../stores/admin-user-password-reset.js'),
  import('../../stores/admin-user-group-change.js'),
  import('../../stores/admin-user-plan-change.js'),
])
const vueURL=new URL('../../../node_modules/vue/index.mjs',import.meta.url).href
const moduleURL=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
async function loadDialog(file,aliases){const source=await readFile(new URL(`./${file}`,import.meta.url),'utf8'),descriptor=parse(source,{filename:file}).descriptor,script=compileScript(descriptor,{id:`a07-${file}`,genDefaultAs:'__sfc__'}),template=compileTemplate({id:`a07-${file}`,filename:file,source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);let code=`${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`;for(const[specifier,replacement]of new Map([['vue',vueURL],...aliases]))for(const quote of ["'",'"'])code=code.replaceAll(`from ${quote}${specifier}${quote}`,`from ${quote}${replacement}${quote}`).replaceAll(`from${quote}${specifier}${quote}`,`from ${quote}${replacement}${quote}`);return(await import(moduleURL(code))).default}
const [PasswordDialog,GroupDialog,PlanDialog]=await Promise.all([
  loadDialog('UserPasswordResetDialog.vue',[['@/stores/admin-user-password-reset',new URL('../../stores/admin-user-password-reset.js',import.meta.url).href],['@/api/admin-user-entitlements',new URL('../../api/admin-user-entitlements.js',import.meta.url).href]]),
  loadDialog('UserGroupChangeDialog.vue',[['@/stores/admin-user-group-change',new URL('../../stores/admin-user-group-change.js',import.meta.url).href],['@/api/admin-user-entitlements',new URL('../../api/admin-user-entitlements.js',import.meta.url).href]]),
  loadDialog('UserPlanChangeDialog.vue',[['@/stores/admin-user-plan-change',new URL('../../stores/admin-user-plan-change.js',import.meta.url).href],['@/api/admin-user-entitlements',new URL('../../api/admin-user-entitlements.js',import.meta.url).href]]),
])

const target=Object.freeze({guid:'9',username:'target',nickname:null,email:null,group:'default',planType:'free',role:'user',status:'active',authVersion:7,createdAt:'2026-09-08T00:00:00Z',lastLoginAt:null})
const ownership=capabilities=>Object.freeze({actorRole:'root',actorGuid:'2',capabilities,target,routeGuid:'9',identityEpoch:'epoch-1',permissionVersion:1})
async function flush(){for(let step=0;step<8;step++)await nextTick();await new Promise(resolve=>setTimeout(resolve,0));await nextTick()}

for(const [name,Dialog,useStore,capabilities,title] of [
  ['password',PasswordDialog,passwordStoreModule.useAdminUserPasswordResetStore,['users.reset_password'],'重置用户密码'],
  ['group',GroupDialog,groupStoreModule.useAdminUserGroupChangeStore,['users.group.change','groups.read'],'变更用户分组'],
  ['plan',PlanDialog,planStoreModule.useAdminUserPlanChangeStore,['users.plan.change'],'变更用户套餐'],
])test(`real ${name} entitlement dialog opens and closes through its public store contract`,async()=>{
  const state={store:null,owner:ref(null)}
  const Harness=defineComponent({setup(){state.store=useStore();return()=>h('main',[h('button',{id:`open-${name}`,onClick(){state.owner.value=state.store.open(ownership(capabilities))}},'open'),h(Dialog,{owner:state.owner.value})])}})
  const wrapper=mount(Harness,{attachTo:document.body,global:{plugins:[createPinia(),ElementPlus]}})
  try{
    await wrapper.get(`#open-${name}`).trigger('click');await flush()
    assert.equal(state.store.isOpen,true)
    assert.equal(wrapper.get('[role="dialog"]').text().includes(title),true)
    const cancel=wrapper.findAll('button').find(button=>button.text()==='取消')
    assert.ok(cancel?.exists());await cancel.trigger('click');await flush()
    assert.equal(state.store.isOpen,false)
    assert.equal(wrapper.find('[role="dialog"]').isVisible(),false)
  }finally{wrapper.unmount();document.body.innerHTML=''}
})

test('real password dialog renders pending recovery read-only and disables reset confirmation',async()=>{
  const state={store:null,owner:ref(null),submits:0}
  const Harness=defineComponent({setup(){state.store=passwordStoreModule.useAdminUserPasswordResetStore();return()=>h('main',[h('button',{id:'open-password-pending',onClick(){state.owner.value=state.store.open(ownership(['users.reset_password']))}},'open'),h(PasswordDialog,{owner:state.owner.value})])}})
  const wrapper=mount(Harness,{attachTo:document.body,global:{plugins:[createPinia(),ElementPlus]}})
  try{
    await wrapper.get('#open-password-pending').trigger('click');await flush()
    state.store.state='pending_recovery';state.store.submit=()=>{state.submits++;return Promise.resolve({state:'pending_recovery'})};await flush()
    assert.equal(wrapper.get('[role="alert"]').text().includes('结果仍在确认中'),true)
    const confirm=wrapper.findAll('button').find(button=>button.text()==='确认重置')
    assert.ok(confirm?.exists());assert.notEqual(confirm.attributes('disabled'),undefined)
    await confirm.trigger('click');await flush();assert.equal(state.submits,0)
  }finally{wrapper.unmount();document.body.innerHTML=''}
})
