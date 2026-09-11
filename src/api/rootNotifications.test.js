import test from 'node:test'
import assert from 'node:assert/strict'
import { createRootNotificationsApi, createRootNotificationsProductionRequest, rootNotificationListResource } from './rootNotifications.js'

const headers = { 'Cache-Control': 'no-store', 'X-Request-ID': 'req-notify-1' }
const raw = (overrides = {}) => ({ guid: '101', type: 'upstream_missing', state: 'active', read: false, acknowledged: false, created_at: 1720000000000, updated_at: 1720000000100, ...overrides })

test('notification API uses exact list, unread, read, and acknowledge routes without mutation bodies', async () => {
  const calls = []
  const api = createRootNotificationsApi({ request: async input => {
    calls.push(input)
    if (input.path.includes('unread-count')) return { data: { unread_count: 3 }, status: 200, headers }
    if (input.method === 'GET') return { data: { items: [raw()], page: 1, page_size: 20, total: 1 }, status: 200, headers }
    return { data: raw(input.path.endsWith('/acknowledge') ? { acknowledged: true } : { read: true }), status: 200, headers }
  } })
  assert.equal(rootNotificationListResource({ state: 'resolved', page: 2, pageSize: 50 }), '/admin/v2/notifications?state=resolved&page=2&page_size=50')
  assert.equal((await api.list({ state: 'active' })).items[0].type, 'upstream_missing')
  assert.equal(await api.unreadCount(), 3)
  assert.equal((await api.markRead('101')).read, true)
  assert.equal((await api.acknowledge('101')).acknowledged, true)
  assert.deepEqual(calls.map(({ method, path, body }) => [method, path, body]), [
    ['GET', '/admin/v2/notifications?state=active&page=1&page_size=20', undefined],
    ['GET', '/admin/v2/notifications/unread-count', undefined],
    ['POST', '/admin/v2/notifications/101/read', undefined],
    ['POST', '/admin/v2/notifications/101/acknowledge', undefined],
  ])
})

test('notification response accepts only exact safe DTO and mandatory no-store request metadata', async () => {
  for (const bad of [
    raw({ payload: { token: 'secret' } }),
    raw({ type: 'unknown' }),
    raw({ state: 'deleted' }),
    raw({ guid: '01' }),
    raw({ created_at: 0 }),
    raw({ updated_at: 1719999999999 }),
  ]) {
    const api = createRootNotificationsApi({ request: async () => ({ data: { items: [bad], page: 1, page_size: 20, total: 1 }, status: 200, headers }) })
    await assert.rejects(api.list(), /invalid_root_notifications_response/)
  }
  for (const badHeaders of [{ 'X-Request-ID': 'r' }, { 'Cache-Control': 'no-store' }, { ...headers, extra: 'allowed-at-transport' }]) {
    const api = createRootNotificationsApi({ request: async () => ({ data: { unread_count: 1 }, status: 200, headers: badHeaders }) })
    if (badHeaders.extra) assert.equal(await api.unreadCount(), 1)
    else await assert.rejects(api.unreadCount(), /invalid_root_notifications_response/)
  }
})

test('notification API validates query, count, errors, and never exposes raw server messages', async () => {
  for (const value of [{ state: 'all' }, { page: 0 }, { pageSize: 10 }, { unknown: true }]) assert.throws(() => rootNotificationListResource(value), /invalid_root_notifications_request/)
  const bad = createRootNotificationsApi({ request: async () => ({ data: { unread_count: -1 }, status: 200, headers }) })
  await assert.rejects(bad.unreadCount(), /invalid_root_notifications_response/)
  const api = createRootNotificationsApi({ request: async () => { throw { response: { status: 403, headers, data: { error: { code: 'root_role_required', message: 'Bearer raw-secret', request_id: 'req-notify-1' } } } } } })
  await assert.rejects(api.list(), error => error.code === 'root_required' && error.requestId === 'req-notify-1' && !error.message.includes('raw-secret'))
  const unsafe = createRootNotificationsApi({ request: async () => { throw { response: { status: 403, headers, data: { error: { code: 'root_role_required', message: 'raw', request_id: 'wrong' } } } } } })
  await assert.rejects(unsafe.list(), error => error.code === 'request_failed' && error.requestId === null)
})

test('read and acknowledgement remain independent receipt updates', async () => {
  const api = createRootNotificationsApi({ request: async ({ path }) => ({ data: raw(path.endsWith('/read') ? { read: true, acknowledged: false } : { read: true, acknowledged: true }), status: 200, headers }) })
  const read = await api.markRead('101')
  assert.deepEqual([read.read, read.acknowledged], [true, false])
  const acknowledged = await api.acknowledge('101')
  assert.deepEqual([acknowledged.read, acknowledged.acknowledged], [true, true])
})

test('production adapter uses refreshable GET and one-shot bodyless receipt POST', async () => {
  const calls=[],signal=new AbortController().signal
  const request=createRootNotificationsProductionRequest({
    get:async(path,options)=>{calls.push(['get',path,options]);return{data:{},status:200,headers}},
    post:async(path,options)=>{calls.push(['post',path,options]);return{data:{},status:200,headers}},
  })
  await request({method:'GET',path:'/admin/v2/notifications',signal})
  await request({method:'POST',path:'/admin/v2/notifications/101/read',signal})
  assert.deepEqual(calls,[['get','/admin/v2/notifications',{signal}],['post','/admin/v2/notifications/101/read',{signal}]])
})
