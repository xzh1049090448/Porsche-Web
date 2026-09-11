import test from 'node:test'
import assert from 'node:assert/strict'
import { createRootNotificationsCoordinator } from './rootNotifications.js'

const note = overrides => ({ guid: '101', type: 'upstream_missing', state: 'active', read: false, acknowledged: false, createdAt: 1, updatedAt: 2, ...overrides })
function authHarness(initial = { state: 'anonymous', accessToken: null, user: null }) {
  let current = initial
  const listeners = new Set()
  return { subscribe(fn) { listeners.add(fn); fn(current); return () => listeners.delete(fn) }, emit(next) { current = next; for (const fn of listeners) fn(next) } }
}

test('polls unread only for authenticated Root and synchronously clears on logout or demotion', async () => {
  const auth = authHarness(), timers = [], cleared = []
  const state = { active: [], resolved: [], unreadCount: 0 }
  const api = { unreadCount: async () => 4, list: async ({ state }) => ({ items: [note({ state })], page: 1, pageSize: 20, total: 1 }) }
  const coordinator = createRootNotificationsCoordinator({ api, auth, state, setIntervalFn(fn) { timers.push(fn); return timers.length }, clearIntervalFn(id) { cleared.push(id) }, pollMs: 100 })
  assert.equal(timers.length, 0)
  auth.emit({ state: 'authenticated', accessToken: 'token', user: { role: 'root' } })
  await coordinator.ready()
  assert.equal(state.unreadCount, 4)
  assert.equal(timers.length, 1)
  state.active = [note({})]; state.resolved = [note({ state: 'resolved' })]
  auth.emit({ state: 'authenticated', accessToken: 'token', user: { role: 'admin' } })
  assert.deepEqual([state.active, state.resolved, state.unreadCount], [[], [], 0])
  assert.deepEqual(cleared, [1])
  coordinator.dispose()
})

test('ignores late reads after identity loss and applies read/ack receipts independently', async () => {
  const auth = authHarness({ state: 'authenticated', accessToken: 'token', user: { role: 'root' } })
  let resolveList
  const state = { active: [], resolved: [], unreadCount: 1 }
  const api = {
    unreadCount: async () => 1,
    list: ({ state }) => state === 'active' ? new Promise(resolve => { resolveList = resolve }) : Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 }),
    markRead: async () => note({ read: true }), acknowledge: async () => note({ read: true, acknowledged: true }),
  }
  const coordinator = createRootNotificationsCoordinator({ api, auth, state, setIntervalFn: () => 1, clearIntervalFn: () => {} })
  await Promise.resolve()
  auth.emit({ state: 'anonymous', accessToken: null, user: null })
  resolveList({ items: [note({})], page: 1, pageSize: 20, total: 1 })
  await coordinator.ready()
  assert.deepEqual(state.active, [])
  auth.emit({ state: 'authenticated', accessToken: 'token2', user: { role: 'root' } })
  resolveList({ items: [note({})], page: 1, pageSize: 20, total: 1 })
  await coordinator.ready()
  state.active = [note({})]
  await coordinator.markRead('101')
  assert.deepEqual([state.active[0].read, state.active[0].acknowledged, state.unreadCount], [true, false, 0])
  await coordinator.acknowledge('101')
  assert.deepEqual([state.active[0].read, state.active[0].acknowledged], [true, true])
  coordinator.dispose()
})

test('concurrent independent read and acknowledgement receipts decrement unread only once', async () => {
  const auth=authHarness({state:'authenticated',accessToken:'token',user:{role:'root'}}),state={active:[note({})],resolved:[],unreadCount:2}
  let readDone,ackDone
  const api={unreadCount:async()=>2,list:async({state})=>({items:state==='active'?[note({})]:[],page:1,pageSize:20,total:state==='active'?1:0}),markRead:()=>new Promise(resolve=>{readDone=resolve}),acknowledge:()=>new Promise(resolve=>{ackDone=resolve})}
  const coordinator=createRootNotificationsCoordinator({api,auth,state,setIntervalFn:()=>1,clearIntervalFn:()=>{}});await coordinator.ready()
  const reading=coordinator.markRead('101'),acknowledging=coordinator.acknowledge('101');ackDone(note({read:true,acknowledged:true}));await acknowledging;readDone(note({read:true}));await reading
  assert.equal(state.unreadCount,1);assert.deepEqual([state.active[0].read,state.active[0].acknowledged],[true,true]);coordinator.dispose()
})
