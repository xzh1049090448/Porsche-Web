import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {readFile} from 'node:fs/promises'
import {compileScript,compileTemplate,parse} from '@vue/compiler-sfc'

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://local.test/admin/public-models',pretendToBeVisual:true})
for(const key of ['window','document','navigator','Node','NodeFilter','Element','HTMLElement','HTMLInputElement','SVGElement','Event','CustomEvent','KeyboardEvent','MouseEvent','FocusEvent','MutationObserver','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']){const value=['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key];Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})}
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}
globalThis.CSS||={supports:()=>false}
const [{mount},{defineComponent,h,ref,nextTick}]=await Promise.all([import('@vue/test-utils'),import('vue')])
const source=await readFile(new URL('./PublicModelForm.vue',import.meta.url),'utf8'),descriptor=parse(source,{filename:'PublicModelForm.vue'}).descriptor,script=compileScript(descriptor,{id:'public-model-form-mounted',genDefaultAs:'__sfc__'}),template=compileTemplate({id:'public-model-form-mounted',filename:'PublicModelForm.vue',source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[])
const vueURL=new URL('../../../node_modules/vue/index.mjs',import.meta.url).href,i18n=`data:text/javascript;base64,${Buffer.from("export const useI18n=()=>({t:key=>key})").toString('base64')}`;let code=`${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`;code=code.replaceAll("from 'vue'",`from '${vueURL}'`).replaceAll('from "vue"',`from '${vueURL}'`).replaceAll("from '@/composables/useI18n'",`from '${i18n}'`).replaceAll('from "@/composables/useI18n"',`from '${i18n}'`);const Form=(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
const flush=async()=>{for(let i=0;i<6;i++)await nextTick();await new Promise(r=>setTimeout(r,0));await nextTick()}

test('mounted model form forwards close icon and Escape state to its owner',async()=>{
  const state={updates:[],closed:0}
  const DialogStub=defineComponent({props:{modelValue:Boolean},emits:['update:modelValue','closed'],setup(props,{emit,slots}){const close=()=>{emit('update:modelValue',false);emit('closed')};return()=>props.modelValue?h('div',{role:'dialog',onKeydown:event=>{if(event.key==='Escape')close()}},[h('button',{class:'el-dialog__headerbtn',onClick:close},'close'),slots.default?.(),slots.footer?.()]):null}})
  const Harness=defineComponent({setup(){const open=ref(true);return()=>h('main',[h('button',{id:'reopen',onClick:()=>{open.value=true}},'open'),h(Form,{modelValue:open.value,observedIds:['up/m'],'onUpdate:modelValue':value=>{state.updates.push(value);open.value=value},onClosed:()=>state.closed++})])}})
  const wrapper=mount(Harness,{attachTo:document.body,global:{stubs:{ElDialog:DialogStub,ElForm:true,ElFormItem:true,ElSelect:true,ElOption:true,ElInput:true,ElAlert:true,ElButton:true}}})
  await flush();assert.ok(wrapper.find('[role="dialog"]').exists())
  wrapper.get('.el-dialog__headerbtn').element.click();await new Promise(r=>setTimeout(r,250));await flush()
  assert.deepEqual(state.updates,[false]);assert.equal(wrapper.find('[role="dialog"]').exists(),false);assert.equal(state.closed,1)
  await wrapper.get('#reopen').trigger('click');await flush();await wrapper.get('[role="dialog"]').trigger('keydown',{code:'Escape',key:'Escape'});await new Promise(r=>setTimeout(r,250));await flush()
  assert.deepEqual(state.updates,[false,false]);assert.equal(wrapper.find('[role="dialog"]').exists(),false);assert.equal(state.closed,2)
  wrapper.unmount()
})
