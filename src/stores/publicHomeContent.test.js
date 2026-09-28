import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicHomeContentState } from './publicHomeContent.js'

const result = data => ({ data, etag: '"a"', resourceKey: '/api/v1/public/home-config', publicationVersions: { content: 2, price: 3 } })
const data = Object.freeze({ announcements: Object.freeze([]), faqs: Object.freeze([]), featuredModelKeys: Object.freeze(['deepseek-chat']), contentReleaseVersion: 2, priceReleaseVersion: 3 })

test('public home state clears stale data and only current generation becomes immutable ready', async () => {
  let resolveFirst; const first=new Promise(resolve=>{resolveFirst=resolve});let call=0
  const state=createPublicHomeContentState({api:{getHomeConfig:async()=>++call===1?first:result(data)}})
  const one=state.load();assert.equal(state.value.value.status,'loading');assert.equal(state.value.value.data,null)
  const two=state.load();await two;resolveFirst(result({...data,featuredModelKeys:['late']}));await one
  assert.equal(state.value.value.status,'ready');assert.deepEqual(state.value.value.data.featuredModelKeys,['deepseek-chat']);assert.ok(Object.isFrozen(state.value.value.data))
})

test('public home failures hide safely and abort/dispose never restores old state', async () => {
  let rejectPending;const pending=new Promise((_resolve,reject)=>{rejectPending=reject})
  const state=createPublicHomeContentState({api:{getHomeConfig:()=>pending}});const load=state.load();state.dispose();rejectPending(new DOMException('stop','AbortError'));await load
  assert.deepEqual(state.value.value,{status:'idle',data:null,error:null})
  state.setApi({getHomeConfig:async()=>{throw Object.assign(new Error('password=secret'),{code:'unavailable',requestId:'req-safe',body:'markdown'})}});await state.load()
  assert.deepEqual(state.value.value,{status:'hidden',data:null,error:{code:'unavailable',requestId:'req-safe'}})
  state.setApi({getHomeConfig:async()=>{throw Object.assign(new Error('secret'),{code:'password_secret',requestId:'bad request id!'})}});await state.load()
  assert.deepEqual(state.value.value.error,{code:'request_failed',requestId:null})
})

test('valid 304 cached result remains ready', async () => {
  const state=createPublicHomeContentState({api:{getHomeConfig:async()=>({...result(data),notModified:true})}});await state.load();assert.equal(state.value.value.status,'ready');assert.deepEqual(state.value.value.data,data);assert.ok(Object.isFrozen(state.value.value.data))
})

test('forged cancellation names settle hidden without invoking accessors', async () => {
  const forged = { name: 'AbortError', code: 'unavailable', requestId: 'req-forged' }
  const state = createPublicHomeContentState({ api: { getHomeConfig: async () => { throw forged } } })
  assert.equal(await state.load(), null)
  assert.deepEqual(state.value.value, { status: 'hidden', data: null, error: { code: 'unavailable', requestId: 'req-forged' } })

  let nameReads = 0; let codeReads = 0; let requestIdReads = 0
  const accessorForgery = {}
  Object.defineProperties(accessorForgery, {
    name: { enumerable: true, get: () => { nameReads++; throw new Error('name secret') } },
    code: { enumerable: true, get: () => { codeReads++; throw new Error('code secret') } },
    requestId: { enumerable: true, get: () => { requestIdReads++; throw new Error('request secret') } },
  })
  state.setApi({ getHomeConfig: async () => { throw accessorForgery } })
  assert.equal(await state.load(), null)
  assert.deepEqual(state.value.value, { status: 'hidden', data: null, error: { code: 'request_failed', requestId: null } })
  assert.deepEqual([nameReads, codeReads, requestIdReads], [0, 0, 0])

  state.setApi({ getHomeConfig: async () => { throw new DOMException('unexpected', 'AbortError') } })
  assert.equal(await state.load(), null)
  assert.deepEqual(state.value.value, { status: 'hidden', data: null, error: { code: 'request_failed', requestId: null } })
})

test('only this state controller cancellation suppresses an obsolete attempt', async () => {
  let call = 0; let firstSignal
  const state = createPublicHomeContentState({ api: { getHomeConfig: ({ signal }) => {
    if (++call > 1) return Promise.resolve(result(data))
    firstSignal = signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError')), { once: true }))
  } } })
  const first = state.load()
  const second = state.load()
  assert.equal(firstSignal.aborted, true)
  await Promise.all([first, second])
  assert.equal(state.value.value.status, 'ready')
  assert.deepEqual(state.value.value.data.featuredModelKeys, ['deepseek-chat'])
})
