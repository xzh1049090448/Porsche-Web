import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { ADMIN_CAPABILITY_DEFINITIONS } from '../../api/admin-users.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'https://local.test/users/9', pretendToBeVisual:true })
for (const key of ['window','document','navigator','Node','NodeFilter','Element','HTMLElement','HTMLInputElement','SVGElement','Event','CustomEvent','KeyboardEvent','MouseEvent','FocusEvent','MutationObserver','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) {
  const value=['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key]
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
}
globalThis.ResizeObserver=class { observe(){} unobserve(){} disconnect(){} }
globalThis.CSS||={supports:()=>false}
globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}}
globalThis.HTMLElement.prototype.scrollIntoView||=function(){}

const [{mount},{createPinia},vue]=await Promise.all([import('@vue/test-utils'),import('pinia'),import('vue')])
const {defineComponent,h,nextTick,ref}=vue
const vite=await createServer({root:new URL('../../../',import.meta.url).pathname,logLevel:'silent',server:{middlewareMode:true},appType:'custom',ssr:{noExternal:['element-plus','async-validator']}})
after(()=>vite.close())
const [{default:ElementPlus},focusTrap,{useAdminUserRolePermissionsStore}]=await Promise.all([
  vite.ssrLoadModule('element-plus'), vite.ssrLoadModule('/node_modules/element-plus/es/components/focus-trap/src/utils.mjs'), import('../../stores/admin-user-role-permissions.js'),
])
const catalog={catalog_version:1,override_effects:['inherit','allow','deny'],capabilities:ADMIN_CAPABILITY_DEFINITIONS.map(item=>({name:item.name,admin_default:item.baseline,grantable:item.grantable,root_only:item.rootOnly,available:item.available}))}
const policy={user_guid:'9',role:'admin',status:'active',catalog_version:1,permissions_version:'3',capabilities:ADMIN_CAPABILITY_DEFINITIONS.map((definition,index)=>{const override=index===0?'deny':'inherit';const policyEffective=!definition.available||definition.rootOnly?false:override==='deny'?false:definition.baseline;return{name:definition.name,baseline:definition.baseline,override,policy_effective:policyEffective,effective:policyEffective}})}
const configs=[
  {name:'UserPromoteDialog',scope:'users.promote',method:'openPromote',role:'user',form:'admin-user-promote-form',width:'min(720px, 94vw)'},
  {name:'UserDemoteDialog',scope:'users.demote',method:'openDemote',role:'admin',form:'admin-user-demote-form',width:'min(560px, 94vw)'},
  {name:'UserPermissionsDialog',scope:'users.permissions.write',method:'openPermissions',role:'admin',form:'admin-user-permissions-form',width:'min(720px, 94vw)'},
]
const context=role=>Object.freeze({target:Object.freeze({guid:'9',username:'alice',role,status:'active',authVersion:7}),routeGuid:'9',identityEpoch:'epoch-1',capabilityRevision:4,permissionsVersion:3,catalogVersion:1})
const flush=async()=>{for(let i=0;i<8;i++)await nextTick();await new Promise(resolve=>setTimeout(resolve,0));await nextTick()}
async function loadEditorURL(){
  const source=await readFile(new URL('./UserPermissionEditor.vue',import.meta.url),'utf8');const descriptor=parse(source,{filename:'UserPermissionEditor.vue'}).descriptor
  const script=compileScript(descriptor,{id:'a08-real-permission-editor',genDefaultAs:'__sfc__'});const template=compileTemplate({id:'a08-real-permission-editor',filename:'UserPermissionEditor.vue',source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[])
  let code=`${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  const replacements=new Map([['vue',new URL('../../../node_modules/vue/index.mjs',import.meta.url).href],['../../api/admin-users.js',new URL('../../api/admin-users.js',import.meta.url).href]])
  for(const[specifier,replacement]of replacements)code=code.replaceAll(`from '${specifier}'`,`from '${replacement}'`).replaceAll(`from "${specifier}"`,`from "${replacement}"`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const editorModuleURL=await loadEditorURL()
async function loadDialog(name){
  const source=await readFile(new URL(`./${name}.vue`,import.meta.url),'utf8');const descriptor=parse(source,{filename:`${name}.vue`}).descriptor
  const script=compileScript(descriptor,{id:`a08-${name}`,genDefaultAs:'__sfc__'});const template=compileTemplate({id:`a08-${name}`,filename:`${name}.vue`,source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[])
  let code=`${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  const replacements=new Map([['vue',new URL('../../../node_modules/vue/index.mjs',import.meta.url).href],['../../stores/admin-user-role-permissions.js',new URL('../../stores/admin-user-role-permissions.js',import.meta.url).href],['../../api/admin-user-roles-permissions.js',new URL('../../api/admin-user-roles-permissions.js',import.meta.url).href],['./UserPermissionEditor.vue',editorModuleURL]])
  for(const[specifier,replacement]of replacements)code=code.replaceAll(`from '${specifier}'`,`from '${replacement}'`).replaceAll(`from "${specifier}"`,`from "${replacement}"`)
  return(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}
async function harness(config){
  const Dialog=await loadDialog(config.name)
  const state={wrapper:null,store:null,owner:null,events:[],submitted:[],trigger:null}
  const Harness=defineComponent({setup(){state.store=useAdminUserRolePermissionsStore();state.owner=ref(null);return()=>h('main',[h('button',{id:'entry',onClick(event){state.trigger=event.currentTarget;state.owner.value=state.store[config.method](context(config.role))}},'open'),h(Dialog,{owner:state.owner.value,catalog,...(config.scope==='users.promote'?{}:{policy}),onClosed:token=>{state.events.push(['closed',token]);nextTick(()=>state.trigger?.focus())},onSucceeded:(result,token)=>state.events.push(['succeeded',result,token]),onConflict:token=>state.events.push(['conflict',token]),onFailed:(code,token)=>state.events.push(['failed',code,token])})])}})
  state.wrapper=mount(Harness,{attachTo:document.body,global:{plugins:[createPinia(),ElementPlus]}})
  const entry=state.wrapper.get('#entry');entry.element.focus();await entry.trigger('click');await flush();return{...state,entry}
}
function cleanup(state){state?.wrapper?.unmount();document.body.innerHTML=''}

for(const config of configs)test(`${config.scope} traps focus, closes on Escape, restores its trigger, and uses a narrow width`,async()=>{let state;try{state=await harness(config);const dialog=state.wrapper.get('[role="dialog"]');const container=dialog.get('.el-dialog');const textarea=state.wrapper.get('textarea');assert.equal(document.activeElement,textarea.element);assert.equal(state.wrapper.findComponent({name:'ElDialog'}).props('width'),config.width);const[first,last]=focusTrap.getEdges(container.element);assert.ok(first);assert.ok(last);last.focus();last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true,cancelable:true}));await flush();assert.equal(document.activeElement,first);document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));await flush();assert.equal(state.store.isOpen,false);assert.equal(document.activeElement,state.entry.element)}finally{cleanup(state)}})

for(const config of configs)test(`${config.scope} submits once through the owner reader and emits the exact terminal contract`,async()=>{let state;try{state=await harness(config);let resolve;const terminal=new Promise(done=>{resolve=done});state.store.submit=(token,reader)=>{state.submitted.push([token,reader()]);state.store.phase='verifying';return terminal};await state.wrapper.get('textarea').setValue('  review  ');const password=state.wrapper.get('input[type="password"]');await password.setValue(' Root1!! ');const submitButton=state.wrapper.get(`button[form="${config.form}"]`);submitButton.element.click();submitButton.element.click();await flush();assert.equal(state.submitted.length,1);assert.equal(password.element.value,'');assert.equal(state.submitted[0][1].reason,'review');assert.equal(state.submitted[0][1].currentPassword,' Root1!! ');if(config.scope==='users.demote')assert.equal(Object.hasOwn(state.submitted[0][1],'overrides'),false);else if(config.scope==='users.promote')assert.deepEqual(state.submitted[0][1].overrides,[]);else assert.deepEqual(state.submitted[0][1].overrides,[{capability:'users.read',effect:'deny'}]);const result={phase:'succeeded',scope:config.scope,operationRef:'op_safe'};state.store.phase='succeeded';resolve(result);await flush();assert.deepEqual(state.events.find(item=>item[0]==='succeeded'),['succeeded',result,state.owner.value])}finally{cleanup(state)}})

test('promotion without a policy starts at baseline and its real editor emits selected overrides',async()=>{let state;try{state=await harness(configs[0]);assert.equal(state.wrapper.findComponent({name:'UserPermissionEditor'}).exists(),false);await state.wrapper.get('.permission-toggle').trigger('click');await flush();assert.equal(state.wrapper.findComponent({name:'UserPermissionEditor'}).exists(),true);await state.wrapper.get('[data-capability="users.reset_password"] input[value="allow"]').trigger('change');await flush();state.store.submit=(token,reader)=>{state.submitted.push([token,reader()]);return Promise.resolve({phase:'failed',failureCode:'request_failed'})};await state.wrapper.get('textarea').setValue('promote');await state.wrapper.get('input[type="password"]').setValue('Root1!!');await state.wrapper.get('form').trigger('submit');await flush();assert.deepEqual(state.submitted[0][1].overrides,[{capability:'users.reset_password',effect:'allow'}])}finally{cleanup(state)}})

test('conflict, failure, and pending recovery stay visible with safe text and focused errors',async()=>{for(const[phase,expectedEvent,text]of[['conflict','conflict','状态已变化'],['failed','failed','请求失败'],['pending_recovery',null,'结果待确认']]){let state;try{state=await harness(configs[1]);state.store.submit=(token,reader)=>{reader();state.store.phase=phase;state.store.failureCode=phase==='failed'?'request_failed':phase==='conflict'?'target_version_conflict':null;return Promise.resolve({phase,failureCode:state.store.failureCode})};await state.wrapper.get('textarea').setValue('review');await state.wrapper.get('input[type="password"]').setValue('Root1!!');await state.wrapper.get('form').trigger('submit');await flush();assert.equal(state.store.isOpen,true);assert.match(state.wrapper.text(),new RegExp(text));if(expectedEvent)assert.equal(state.events.filter(item=>item[0]===expectedEvent).length,1);else assert.equal(state.events.filter(item=>['succeeded','conflict','failed'].includes(item[0])).length,0);if(phase!=='pending_recovery'){const alert=state.wrapper.get('[role="alert"]');assert.equal(document.activeElement,alert.element,`active=${document.activeElement?.outerHTML} alert=${alert.element.outerHTML}`)}}finally{cleanup(state)}}})

test('unmount clears the native password and closes the active owner',async()=>{let state;try{state=await harness(configs[0]);const password=state.wrapper.get('input[type="password"]');await password.setValue('UnmountSecret1!!');const native=password.element;state.wrapper.unmount();assert.equal(native.value,'');assert.equal(state.store.isOpen,false);state=null}finally{cleanup(state)}})
