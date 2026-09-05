import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'
import { parse as parseScript } from '@babel/parser'
import { canDeleteAdminUser, reconcileDeletedDetail, reconcileDeletedList, refreshDeleteTargetFailClosed, restoreDeleteTriggerFocus } from '../stores/admin-user-actions.js'

const sources = await Promise.all(['Users.vue', 'UserDetail.vue'].map(name => readFile(new URL(`./${name}`, import.meta.url), 'utf8')))
const templates = sources.map((source, index) => parseTemplate(parseSFC(source, { filename: index ? 'UserDetail.vue' : 'Users.vue' }).descriptor.template.content))
const scripts = sources.map((source, index) => parseScript(parseSFC(source, { filename: index ? 'UserDetail.vue' : 'Users.vue' }).descriptor.scriptSetup.content, { sourceType: 'module' }))
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue
    if (Array.isArray(value)) value.forEach(item => walk(item, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}
function deleteButtons(ast) {
  const found = []
  walk(ast, node => {
    if (node.type !== 1 || node.tag !== 'el-button') return
    if (node.props.some(prop => prop.type === 6 && prop.name === 'type' && prop.value?.content === 'danger')) found.push(node)
  })
  return found
}
const ifExpression = node => node.props.find(prop => prop.type === 7 && prop.name === 'if')?.exp?.content
const calls = (ast, name) => {
  const found = []
  walk(ast, node => { if (node.type === 'CallExpression' && node.callee?.name === name) found.push(node) })
  return found
}

test('compiled list and detail templates bind the delete control to the actual three-condition predicate', () => {
  assert.equal(ifExpression(deleteButtons(templates[0])[0]), 'canDeleteTarget(row)')
  assert.equal(ifExpression(deleteButtons(templates[1])[0]), 'canDeleteTarget')
  assert.equal(canDeleteAdminUser({ actorRole: 'admin', capabilities: ['users.delete'], target: { role: 'user', status: 'active' } }), true)
  for (const input of [
    { actorRole: 'admin', capabilities: [], target: { role: 'user', status: 'active' } },
    { actorRole: 'admin', capabilities: ['users.delete'], target: { role: 'admin', status: 'active' } },
    { actorRole: 'root', capabilities: ['users.delete'], target: { role: 'root', status: 'active' } },
    { actorRole: 'root', capabilities: ['users.delete'], target: { role: 'user', status: 'deleted' } },
  ]) assert.equal(canDeleteAdminUser(input), false)
})

test('view scripts execute the tested reconciliation, direct-detail refresh, and focus helpers', () => {
  assert.equal(calls(scripts[0], 'reconcileDeletedList').length, 1)
  assert.equal(calls(scripts[1], 'reconcileDeletedDetail').length, 1)
  for (const script of scripts) {
    const refresh = calls(script, 'refreshDeleteTargetFailClosed')[0]
    assert.ok(refresh)
    const options = refresh.arguments[0]
    const loadTarget = options.properties.find(property => property.key?.name === 'loadTarget')
    let directDetail = loadTarget.value.name === 'getAdminUser'
    walk(loadTarget.value, node => { if (node.type === 'CallExpression' && node.callee?.name === 'getAdminUser') directDetail = true })
    assert.equal(directDetail, true)
    assert.equal(calls(script, 'restoreDeleteTriggerFocus').length, 1)
  }
})

test('list reconciliation removes only the committed row and preserves page filters and sort', async () => {
  const filters = { page: 3, pageSize: 20, q: '张', role: 'user', status: 'active', sort: 'username', order: 'asc' }
  const state = { rows: [{ guid: '42' }], total: 41 }
  const reloads = []
  await reconcileDeletedList({ state, filters, guid: '42', reload: () => reloads.push({ ...filters }) })
  assert.deepEqual(state, { rows: [], total: 40 })
  assert.deepEqual(filters, { page: 2, pageSize: 20, q: '张', role: 'user', status: 'active', sort: 'username', order: 'asc' })
  assert.deepEqual(reloads, [{ ...filters }])
  const first = { rows: [{ guid: '42' }, { guid: '43' }], total: 2 }
  await reconcileDeletedList({ state: first, filters: { ...filters, page: 1 }, guid: '42', reload: () => assert.fail('must not reload nonempty page') })
  assert.deepEqual(first, { rows: [{ guid: '43' }], total: 1 })
})

test('detail reconciliation changes only a matching committed target to deleted read-only state', () => {
  const state = { selected: { guid: '42', status: 'active', authVersion: 7 }, permissions: { unsafe: true }, catalog: { unsafe: true } }
  assert.equal(reconcileDeletedDetail({ state, guid: '43' }), false)
  assert.equal(state.selected.status, 'active')
  assert.equal(reconcileDeletedDetail({ state, guid: '42' }), true)
  assert.equal(state.selected.status, 'deleted')
  assert.equal(state.permissions, null)
  assert.equal(state.catalog, null)
})

test('409 refresh replaces the exact target version only when detail remains manageable', async () => {
  const events = []
  const fresh = { guid: '42', role: 'user', status: 'active', authVersion: 8 }
  const result = await refreshDeleteTargetFailClosed({
    guid: '42', token: 'dialog', loadTarget: async () => fresh, canManage: target => target.authVersion === 8,
    replaceTarget: (token, target) => { events.push(['replace', token, target]); return true }, invalidateTarget: () => events.push(['invalidate']),
    onUnauthorized: () => events.push(['unauthorized']), onUnavailable: () => events.push(['warning']),
  })
  assert.equal(result, true)
  assert.deepEqual(events, [['replace', 'dialog', fresh]])
})

test('409 refresh fails closed on missing, deleted, unmanageable, 401, and any read failure', async () => {
  const cases = [
    { load: async () => null },
    { load: async () => ({ guid: '42', role: 'user', status: 'deleted', authVersion: 8 }) },
    { load: async () => ({ guid: '42', role: 'admin', status: 'active', authVersion: 8 }) },
    { load: async () => { throw { response: { status: 404 } } } },
    { load: async () => { throw { response: { status: 503 } } } },
    { load: async () => { throw { response: { status: 401 } } }, unauthorized: true },
  ]
  for (const item of cases) {
    const events = []
    const result = await refreshDeleteTargetFailClosed({
      guid: '42', token: 'dialog', loadTarget: item.load, canManage: target => target?.status === 'active' && target.role === 'user',
      replaceTarget: () => { events.push('replace'); return true }, invalidateTarget: () => events.push('invalidate'),
      onUnauthorized: () => events.push('unauthorized'), onUnavailable: () => events.push('warning'),
    })
    assert.equal(result, false)
    assert.equal(events.includes('replace'), false)
    assert.equal(events.includes('invalidate'), true)
    assert.equal(events.includes('warning'), true)
    assert.equal(events.includes('unauthorized'), item.unauthorized === true)
  }
})

test('a deferred 42 refresh cannot replace selected user after route changes to 43', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let routeGuid = '42'
  let selectedGuid = '42'
  let owner = true
  const events = []
  const running = refreshDeleteTargetFailClosed({
    guid: '42', token: 'dialog-a', loadTarget: () => pending,
    isContextCurrent: () => owner && routeGuid === '42' && selectedGuid === '42',
    canManage: () => true, replaceTarget: () => { events.push('replace'); return true },
    invalidateTarget: () => events.push('invalidate'), onUnauthorized: () => events.push('unauthorized'), onUnavailable: () => events.push('warning'),
  })
  routeGuid = '43'; selectedGuid = '43'; owner = false
  release({ guid: '42', role: 'user', status: 'active', authVersion: 8 })
  assert.equal(await running, false)
  assert.equal(events.includes('replace'), false)
})

test('a deferred list refresh cannot replace a target after page context changes', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let pageRevision = 1
  const events = []
  const running = refreshDeleteTargetFailClosed({
    guid: '42', token: 'dialog-a', loadTarget: () => pending, isContextCurrent: () => pageRevision === 1,
    canManage: () => true, replaceTarget: () => { events.push('replace'); return true },
    invalidateTarget: () => events.push('invalidate'), onUnauthorized: () => {}, onUnavailable: () => events.push('warning'),
  })
  pageRevision = 2
  release({ guid: '42', role: 'user', status: 'active', authVersion: 8 })
  assert.equal(await running, false)
  assert.deepEqual(events, [])
})

test('focus restoration executes against a connected trigger or stable fallback', () => {
  for (const connected of [true, false]) {
    const calls = []
    restoreDeleteTriggerFocus({
      trigger: { isConnected: connected, focus: () => calls.push('trigger') }, fallback: { focus: () => calls.push('fallback') },
      nextTick: callback => { calls.push('tick'); callback() },
    })
    assert.deepEqual(calls, ['tick', connected ? 'trigger' : 'fallback'])
  }
})
