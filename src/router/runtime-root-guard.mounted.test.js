import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
const dom=new JSDOM('<!doctype html><html><body></body></html>');for(const key of ['window','document','navigator','Node','Element','HTMLElement','SVGElement'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]})
const [{mount},{defineComponent,h,nextTick,reactive},{installRuntimeRootGuard}]=await Promise.all([import('@vue/test-utils'),import('vue'),import('./runtime-root-guard.js')])

test('mounted root route fails closed immediately when live role projection is demoted',async()=>{
  const route=reactive({meta:{rootOnly:true}}),userStore=reactive({user:{role:'root'}}),replaced=[],cancelled=[]
  const Harness=defineComponent({setup(){installRuntimeRootGuard({route,userStore,router:{replace:value=>replaced.push(value)},cancelAdmin:()=>cancelled.push(true)});return()=>h('div')}})
  const wrapper=mount(Harness);userStore.user={role:'admin'};assert.equal(cancelled.length,1);assert.deepEqual(replaced,[{path:'/chat',replace:true}]);await nextTick();wrapper.unmount()
})
