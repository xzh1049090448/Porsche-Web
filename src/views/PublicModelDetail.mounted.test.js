import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {readFile} from 'node:fs/promises'
import {compileScript,compileTemplate,parse} from '@vue/compiler-sfc'

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://local.test/admin/public-models/111',pretendToBeVisual:true})
for(const key of ['window','document','navigator','Node','NodeFilter','Element','HTMLElement','HTMLInputElement','SVGElement','Event','CustomEvent','KeyboardEvent','MouseEvent','FocusEvent','MutationObserver','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']){const value=['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key];Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})}
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}
globalThis.CSS||={supports:()=>false}
const [{mount},{defineComponent,h,nextTick,reactive}]=await Promise.all([import('@vue/test-utils'),import('vue')])
const source=await readFile(new URL('./PublicModelDetail.vue',import.meta.url),'utf8'),descriptor=parse(source,{filename:'PublicModelDetail.vue'}).descriptor,script=compileScript(descriptor,{id:'public-model-detail-mounted',genDefaultAs:'__sfc__'}),template=compileTemplate({id:'public-model-detail-mounted',filename:'PublicModelDetail.vue',source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[])
const vueURL=new URL('../../node_modules/vue/index.mjs',import.meta.url).href
const data=value=>`data:text/javascript;base64,${Buffer.from(value).toString('base64')}`
const router=data("export const useRoute=()=>globalThis.__detailMount.route;export const useRouter=()=>globalThis.__detailMount.router")
const store=data("export const usePublicModelAdminStore=()=>globalThis.__detailMount.store")
const i18n=data("export const useI18n=()=>({t:key=>key})")
const element=data("export const ElMessage={warning(){}}")
const form=data("export default {name:'PublicModelForm',props:['modelValue','model','busy','error'],emits:['update:modelValue','submit'],render(){return null}}")
const shell=data(`import{defineComponent,h}from'${vueURL}';export default defineComponent({inheritAttrs:false,setup(_,{attrs,slots}){return()=>h('section',attrs,[slots.default?.(),slots.actions?.()])}})`)
let code=`${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
for(const [from,to] of [['vue',vueURL],['vue-router',router],['element-plus',element],['@/stores/publicModelAdmin',store],['@/composables/useI18n',i18n],['@/components/public-admin/PublicModelForm.vue',form],['@/components/shell/PageHeader.vue',shell],['@/components/shell/StatusBadge.vue',shell]]) code=code.replaceAll(`from '${from}'`,`from '${to}'`).replaceAll(`from "${from}"`,`from '${to}'`)
const Detail=(await import(data(code))).default
const flush=async()=>{for(let i=0;i<5;i++)await nextTick();await new Promise(r=>setTimeout(r,0));await nextTick()}
const model=guid=>({guid,modelKey:`model-${guid}`,upstreamModelId:`up/${guid}`,displayName:`Model ${guid}`,provider:'P',capabilities:[],contextWindow:1000,inputPriceUsdPerMillionTokens:null,outputPriceUsdPerMillionTokens:null,status:'draft',revision:1,lastUpstreamCheckAt:null,publicDisplayGroup:null,endpointTypes:[],publicRestrictions:[],priceSource:null,priceReviewer:null,priceEffectiveAt:null})
const stubs={ElButton:true,ElSkeleton:true,ElAlert:true,ElDropdown:true,ElDropdownMenu:true,ElDropdownItem:true,ElDescriptions:true,ElDescriptionsItem:true,ElDialog:true,ElInput:true,ElForm:true,ElFormItem:true}

test('mounted detail clears A synchronously and ignores A after route changes to B',async()=>{
  const route=reactive({params:{guid:'111'}}),calls=[],pending=new Map()
  const store=reactive({detail:null,detailLoading:false,detailError:null,mutationError:null,modelSaving:false,statusSaving:false,deleteSaving:false,setMutationContext(){},clearMutationError(){this.mutationError=null},clearDetail(){calls.push(['clear',this.detail?.guid??null]);this.detail=null},loadDetail(guid){calls.push(['load',guid]);this.detailLoading=true;return new Promise(resolve=>pending.set(guid,value=>{if(route.params.guid===guid)this.detail=value;this.detailLoading=false;resolve(value)}))},cancel(){},update(){},activate(){},deactivate(){},remove(){}})
  globalThis.__detailMount={route,store,router:{push(){},replace(){}}};const wrapper=mount(Detail,{global:{stubs}});await flush();assert.deepEqual(calls,[['clear',null],['load','111']])
  store.detail=model('111');route.params.guid='222';await nextTick();assert.equal(store.detail,null);assert.deepEqual(calls.at(-2),['clear','111']);assert.deepEqual(calls.at(-1),['load','222'])
  pending.get('222')(model('222'));await flush();pending.get('111')(model('111'));await flush();assert.equal(store.detail.guid,'222');wrapper.unmount()
})

test('mounted delete action preserves exact password bytes at handoff then clears its reactive copy',async()=>{
  const route=reactive({params:{guid:'333'}}),seen=[];let finish
  const store=reactive({detail:model('333'),detailLoading:false,detailError:null,mutationError:null,modelSaving:false,statusSaving:false,deleteSaving:false,setMutationContext(){},clearMutationError(){},clearDetail(){},loadDetail(){return Promise.resolve()},cancel(){},remove(input){seen.push({...input});this.deleteSaving=true;return new Promise(resolve=>{finish=()=>{this.deleteSaving=false;resolve(true)}})}})
  globalThis.__detailMount={route,store,router:{push(){},replace(){return Promise.resolve()}}};const wrapper=mount(Detail,{global:{stubs}});await flush();wrapper.vm.deleteForm.reason='retired';wrapper.vm.deleteForm.currentPassword=' secret ';const pending=wrapper.vm.remove();assert.equal(wrapper.vm.deleteForm.currentPassword,'');assert.equal(seen[0].currentPassword,' secret ');finish();await pending;wrapper.unmount()
})

test('every mounted delete dismissal clears password and reason before close completion',async()=>{
  const route=reactive({params:{guid:'444'}}),store=reactive({detail:model('444'),detailLoading:false,detailError:null,mutationError:null,modelSaving:false,statusSaving:false,deleteSaving:false,setMutationContext(){},clearDetail(){},loadDetail(){return Promise.resolve(this.detail)},cancel(){}})
  globalThis.__detailMount={route,store,router:{push(){},replace(){}}};const wrapper=mount(Detail,{global:{stubs}});await flush()
  wrapper.vm.showDelete=true;wrapper.vm.deleteForm.reason='reason';wrapper.vm.deleteForm.currentPassword='secret';wrapper.vm.deleteVisibility(false);assert.equal(wrapper.vm.showDelete,false);assert.deepEqual({...wrapper.vm.deleteForm},{reason:'',currentPassword:''})
  wrapper.vm.showDelete=true;wrapper.vm.deleteForm.reason='again';wrapper.vm.deleteForm.currentPassword='secret2';let completed=false;wrapper.vm.beforeDeleteClose(()=>{completed=true});assert.equal(completed,true);assert.equal(wrapper.vm.showDelete,false);assert.deepEqual({...wrapper.vm.deleteForm},{reason:'',currentPassword:''});wrapper.unmount()
})

test('mounted conflict maps form prices to exact DTO fields only after matching refresh',async()=>{
  const route=reactive({params:{guid:'555'}}),before=model('555'),latest={...model('555'),inputPriceUsdPerMillionTokens:'1.2300',outputPriceUsdPerMillionTokens:'4.5600',revision:2};let loads=0
  const store=reactive({detail:before,detailLoading:false,detailError:null,mutationError:null,modelSaving:false,statusSaving:false,deleteSaving:false,setMutationContext(){},clearDetail(){this.detail=null},loadDetail(){this.detail=loads++?latest:before;return Promise.resolve(this.detail)},cancel(){},update(){this.mutationError={code:'revision_conflict',requestId:'req-conflict'};return Promise.resolve(null)}})
  globalThis.__detailMount={route,store,router:{push(){},replace(){}}};const wrapper=mount(Detail,{global:{stubs}});await flush();await wrapper.vm.update({expectedRevision:1,inputPrice:'1.2300',outputPrice:'4.5600',displayName:'Changed'});await flush()
  assert.deepEqual(wrapper.vm.conflictComparison.attempted,{displayName:'Changed',inputPriceUsdPerMillionTokens:'1.2300',outputPriceUsdPerMillionTokens:'4.5600'});assert.equal(wrapper.vm.conflictComparison.latest.guid,'555');assert.equal(wrapper.vm.conflictRows.find(x=>x.key==='inputPriceUsdPerMillionTokens').attempted,'1.2300');wrapper.unmount()
})

test('mounted conflict refresh failure reports correlation without inventing latest values',async()=>{
  const route=reactive({params:{guid:'666'}}),before=model('666');let loads=0
  const store=reactive({detail:before,detailLoading:false,detailError:null,mutationError:null,modelSaving:false,statusSaving:false,deleteSaving:false,setMutationContext(){},clearDetail(){this.detail=null},loadDetail(){if(loads++===0){this.detail=before;return Promise.resolve(before)}this.detailError={code:'unavailable',requestId:'req-refresh'};return Promise.resolve(null)},cancel(){},update(){this.mutationError={code:'revision_conflict',requestId:'req-conflict'};return Promise.resolve(null)}})
  globalThis.__detailMount={route,store,router:{push(){},replace(){}}};const wrapper=mount(Detail,{global:{stubs}});await flush();await wrapper.vm.update({expectedRevision:1,inputPrice:'9.00'});await flush();assert.deepEqual(wrapper.vm.conflictComparison,{unavailable:true,requestId:'req-refresh'});assert.equal(wrapper.vm.conflictComparison.latest,undefined);wrapper.unmount()
})

test('mounted destructive dialogs reject whitespace and keep server errors inside the dialog',async()=>{
  const route=reactive({params:{guid:'777'}}),calls=[]
  const store=reactive({detail:model('777'),detailLoading:false,detailError:null,mutationError:null,modelSaving:false,statusSaving:false,deleteSaving:false,setMutationContext(){},clearDetail(){},loadDetail(){return Promise.resolve(this.detail)},cancel(){},deactivate(){calls.push('deactivate')},remove(){calls.push('remove');this.mutationError={code:'unavailable',requestId:'req-dialog'};return Promise.resolve(null)}})
  globalThis.__detailMount={route,store,router:{push(){},replace(){}}};const wrapper=mount(Detail,{global:{stubs}});await flush()
  wrapper.vm.showDeactivate=true;wrapper.vm.deactivateReason='   ';await wrapper.vm.deactivate();assert.equal(calls.includes('deactivate'),false);assert.equal(wrapper.vm.dialogError.code,'reason_required')
  wrapper.vm.showDelete=true;wrapper.vm.deleteForm.reason='  ';wrapper.vm.deleteForm.currentPassword='  ';await wrapper.vm.remove();assert.equal(calls.includes('remove'),false);assert.equal(wrapper.vm.dialogError.code,'reason_required')
  wrapper.vm.deleteForm.reason='valid';wrapper.vm.deleteForm.currentPassword='secret';await wrapper.vm.remove();assert.equal(calls.includes('remove'),true);assert.deepEqual(wrapper.vm.dialogError,{code:'unavailable',requestId:'req-dialog'});assert.equal(wrapper.vm.showDelete,true);wrapper.unmount()
})
