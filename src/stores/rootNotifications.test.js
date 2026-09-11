import test from 'node:test'
import assert from 'node:assert/strict'
import { createRootNotificationsCoordinator } from './rootNotifications.js'

const note = overrides => ({ guid: '101', type: 'upstream_missing', state: 'active', read: false, acknowledged: false, createdAt: 1, updatedAt: 2, ...overrides })
function authHarness(initial = { state: 'anonymous', accessToken: null, user: null }) {
  let current = initial
  const listeners = new Set()
  return { state:()=>current.state,accessToken:()=>current.accessToken,user:()=>current.user,capture:()=>current,subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }, emit(next) { current = next; for (const fn of listeners) fn(next) } }
}

test('polls unread only for authenticated Root and synchronously clears on logout or demotion', async () => {
  const auth = authHarness(), timers = [], cleared = []
  const state = { active: [], resolved: [], unreadCount: 0 }
  const api = { unreadCount: async () => 4, list: async ({ state }) => ({ items: [note({ state })], page: 1, pageSize: 20, total: 1 }) }
  const coordinator = createRootNotificationsCoordinator({ api, auth, state, setIntervalFn(fn) { timers.push(fn); return timers.length }, clearIntervalFn(id) { cleared.push(id) }, pollMs: 100 })
  assert.equal(timers.length, 0)
  auth.emit({ state: 'authenticated', accessToken: 'token', epoch:'root-a', user: { guid:'1',role: 'root' } })
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
  const auth = authHarness({ state: 'authenticated', accessToken: 'token', epoch:'root-a',user: { guid:'1',role: 'root' } })
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
  auth.emit({ state: 'authenticated', accessToken: 'token2', epoch:'root-b',user: { guid:'2',role: 'root' } })
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
  const auth=authHarness({state:'authenticated',accessToken:'token',epoch:'root-a',user:{guid:'1',role:'root'}}),state={active:[note({})],resolved:[],unreadCount:2}
  let readDone,ackDone
  const api={unreadCount:async()=>2,list:async({state})=>({items:state==='active'?[note({})]:[],page:1,pageSize:20,total:state==='active'?1:0}),markRead:()=>new Promise(resolve=>{readDone=resolve}),acknowledge:()=>new Promise(resolve=>{ackDone=resolve})}
  const coordinator=createRootNotificationsCoordinator({api,auth,state,setIntervalFn:()=>1,clearIntervalFn:()=>{}});await coordinator.ready()
  const reading=coordinator.markRead('101'),acknowledging=coordinator.acknowledge('101');ackDone(note({read:true,acknowledged:true}));await acknowledging;readDone(note({read:true}));await reading
  assert.equal(state.unreadCount,1);assert.deepEqual([state.active[0].read,state.active[0].acknowledged],[true,true]);coordinator.dispose()
})

test('Root A to Root B changes identity epoch, clears synchronously, and rejects A late finalizers', async()=>{
  const auth=authHarness({state:'authenticated',accessToken:'a',epoch:'epoch-a',user:{guid:'1',role:'root'}}),timers=[],cleared=[],pending=[]
  const api={list:({state})=>new Promise(resolve=>pending.push({kind:state,resolve})),unreadCount:()=>new Promise(resolve=>pending.push({kind:'count',resolve}))}
  const state={},coordinator=createRootNotificationsCoordinator({api,auth,state,setIntervalFn:fn=>(timers.push(fn),timers.length),clearIntervalFn:id=>cleared.push(id)})
  assert.equal(timers.length,1);state.active=[note({})];state.unreadCount=9
  auth.emit({state:'authenticated',accessToken:'b',epoch:'epoch-b',user:{guid:'2',role:'root'}})
  assert.deepEqual([state.active,state.unreadCount,state.loading],[[],0,true]);assert.deepEqual(cleared,[1]);assert.equal(timers.length,2)
  for(const item of pending.slice(0,3))item.resolve(item.kind==='count'?8:{items:[note({guid:'111'})],page:1,pageSize:20,total:1})
  await Promise.resolve();assert.deepEqual(state.active,[]);assert.equal(state.loading,true)
  for(const item of pending.slice(3))item.resolve(item.kind==='count'?2:{items:[note({guid:item.kind==='active'?'202':'203',state:item.kind})],page:1,pageSize:20,total:1})
  await coordinator.ready();assert.equal(state.active[0].guid,'202');assert.equal(state.unreadCount,2);assert.equal(state.loading,false);coordinator.dispose()
})

test('newer refresh owns list count and loading against out-of-order stale completion',async()=>{
  const auth=authHarness({state:'authenticated',accessToken:'a',epoch:'e',user:{guid:'1',role:'root'}}),requests=[]
  const api={list:({state})=>new Promise(resolve=>requests.push({kind:state,resolve})),unreadCount:()=>new Promise(resolve=>requests.push({kind:'count',resolve}))}
  const state={},c=createRootNotificationsCoordinator({api,auth,state,setIntervalFn:()=>1,clearIntervalFn:()=>{}});const first=c.ready(),second=c.refresh()
  for(const item of requests.slice(3))item.resolve(item.kind==='count'?2:{items:[note({guid:item.kind==='active'?'201':'202',state:item.kind})],page:1,pageSize:20,total:1});await second
  assert.deepEqual([state.active[0].guid,state.resolved[0].guid,state.unreadCount,state.loading],['201','202',2,false])
  for(const item of requests.slice(0,3))item.resolve(item.kind==='count'?9:{items:[note({guid:'101',state:item.kind})],page:1,pageSize:20,total:1});await first
  assert.deepEqual([state.active[0].guid,state.resolved[0].guid,state.unreadCount,state.loading],['201','202',2,false]);c.dispose()
})

test('stale lists and counts cannot roll back receipts or inflate unread after read and acknowledge',async()=>{
  const auth=authHarness({state:'authenticated',accessToken:'a',epoch:'e',user:{guid:'1',role:'root'}}),requests=[]
  const api={list:({state})=>new Promise(resolve=>requests.push({kind:state,resolve})),unreadCount:()=>new Promise(resolve=>requests.push({kind:'count',resolve})),markRead:async()=>note({read:true}),acknowledge:async()=>note({read:true,acknowledged:true})}
  const state={},c=createRootNotificationsCoordinator({api,auth,state,setIntervalFn:()=>1,clearIntervalFn:()=>{}})
  requests.find(x=>x.kind==='active').resolve({items:[note({})],page:1,pageSize:20,total:1});requests.find(x=>x.kind==='resolved').resolve({items:[],page:1,pageSize:20,total:0});requests.find(x=>x.kind==='count').resolve(2);await c.ready()
  const stale=c.refresh(),old=requests.slice(3);await c.markRead('101');await c.acknowledge('101');assert.deepEqual([state.active[0].read,state.active[0].acknowledged,state.unreadCount],[true,true,1])
  for(const item of old)item.resolve(item.kind==='count'?2:{items:item.kind==='active'?[note({})]:[],page:1,pageSize:20,total:item.kind==='active'?1:0});await stale
  assert.deepEqual([state.active[0].read,state.active[0].acknowledged,state.unreadCount],[true,true,1]);c.dispose()
})

test('active and resolved pagination are independent deduplicated and reject stale pages',async()=>{
  const auth=authHarness({state:'authenticated',accessToken:'a',epoch:'e',user:{guid:'1',role:'root'}}),calls=[]
  const api={unreadCount:async()=>0,list:({state,page})=>{calls.push([state,page]);return Promise.resolve({items:page===1?[note({guid:state==='active'?'101':'201',state})]:[note({guid:state==='active'?'101':'201',state}),note({guid:state==='active'?'102':'202',state})],page,pageSize:20,total:2})}}
  const state={},c=createRootNotificationsCoordinator({api,auth,state,setIntervalFn:()=>1,clearIntervalFn:()=>{}});await c.ready();await Promise.all([c.loadMore('active'),c.loadMore('active'),c.loadMore('resolved')])
  assert.deepEqual(calls,[['active',1],['resolved',1],['active',2],['resolved',2]]);assert.deepEqual(state.active.map(x=>x.guid),['101','102']);assert.deepEqual(state.resolved.map(x=>x.guid),['201','202']);assert.deepEqual([state.activePage,state.resolvedPage],[2,2]);c.dispose()
})

test('a stale group page cannot append after a newer page-one refresh',async()=>{
  const auth=authHarness({state:'authenticated',accessToken:'a',epoch:'e',user:{guid:'1',role:'root'}});let pageTwo
  const api={unreadCount:async()=>0,list:({state,page})=>state==='active'&&page===2?new Promise(resolve=>{pageTwo=resolve}):Promise.resolve({items:state==='active'?[note({guid:page===1?'101':'301'})]:[],page,pageSize:20,total:state==='active'?2:0})}
  const state={},c=createRootNotificationsCoordinator({api,auth,state,setIntervalFn:()=>1,clearIntervalFn:()=>{}});await c.ready();const old=c.loadMore('active'),fresh=c.refresh();await fresh;pageTwo({items:[note({guid:'102'})],page:2,pageSize:20,total:2});await old
  assert.deepEqual(state.active.map(x=>x.guid),['101']);assert.equal(state.activePage,1);assert.equal(state.activeLoadingMore,false);c.dispose()
})

test('rapid demotion and Root relogin keeps the new loading owner against old finalizers',async()=>{
  const auth=authHarness({state:'authenticated',accessToken:'a',epoch:'a',user:{guid:'1',role:'root'}}),pending=[];const api={list:({state})=>new Promise(resolve=>pending.push({state,resolve})),unreadCount:()=>new Promise(resolve=>pending.push({state:'count',resolve}))}
  const state={},c=createRootNotificationsCoordinator({api,auth,state,setIntervalFn:()=>1,clearIntervalFn:()=>{}});auth.emit({state:'anonymous',accessToken:null,epoch:'out',user:null});auth.emit({state:'authenticated',accessToken:'b',epoch:'b',user:{guid:'2',role:'root'}});assert.equal(state.loading,true)
  for(const request of pending.slice(0,3))request.resolve(request.state==='count'?8:{items:[note({guid:'111',state:request.state})],page:1,pageSize:20,total:1});await Promise.resolve();assert.equal(state.loading,true);assert.deepEqual(state.active,[])
  for(const request of pending.slice(3))request.resolve(request.state==='count'?1:{items:[note({guid:'222',state:request.state})],page:1,pageSize:20,total:1});await c.ready();assert.equal(state.loading,false);assert.equal(state.active[0].guid,'222');c.dispose()
})
