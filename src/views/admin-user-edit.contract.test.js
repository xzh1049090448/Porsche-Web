import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'
import { parse as parseScript } from '@babel/parser'
import { createPinia, setActivePinia } from 'pinia'
import { useAdminUsersStore } from '../stores/admin-users.js'
import { canOpenAdminUserEdit, useAdminUserEditStore } from '../stores/admin-user-edit.js'

const source = await readFile(new URL('./UserDetail.vue', import.meta.url), 'utf8')
const descriptor = parseSFC(source, { filename: 'UserDetail.vue' }).descriptor
const template = parseTemplate(descriptor.template.content)
const setup = parseScript(descriptor.scriptSetup.content, { sourceType: 'module' })
function walk(node, visit) { if (!node || typeof node !== 'object') return; visit(node); for (const [key, value] of Object.entries(node)) { if (key === 'loc') continue; if (Array.isArray(value)) value.forEach(item => walk(item, visit)); else if (value && typeof value === 'object') walk(value, visit) } }
const elements = []; walk(template, node => { if (node.type === 1) elements.push(node) })
const calls = name => { const found = []; walk(setup, node => { if (node.type === 'CallExpression' && node.callee?.name === name) found.push(node) }); return found }
const directive = (node, name, argument) => node?.props.find(prop => prop.type === 7 && prop.name === name && (argument == null || prop.arg?.content === argument))
async function helpers() {
  assert.ok(descriptor.script?.content, 'UserDetail must expose pure reconciliation helpers')
  return import(`data:text/javascript;base64,${Buffer.from(descriptor.script.content).toString('base64')}`)
}

test('detail exposes edit only through the exact manageable-target predicate', () => {
  const button = elements.find(node => node.tag === 'el-button' && directive(node, 'on', 'click')?.exp?.content?.includes('openEdit'))
  assert.ok(button); assert.equal(directive(button, 'if')?.exp?.content, 'canEditTarget')
  const base = { actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target: { guid: '3', role: 'user', status: 'active', authVersion: 7 } }
  assert.equal(canOpenAdminUserEdit(base), true)
  for (const next of [{ capabilities: [] }, { actorGuid: '3' }, { target: { ...base.target, role: 'admin' } }, { target: { ...base.target, status: 'deleted' } }, { target: { ...base.target, authVersion: 0 } }]) assert.equal(canOpenAdminUserEdit({ ...base, ...next }), false)
})

test('success reconciliation updates only the owned detail and matching cached row', async () => {
  const { reconcileAdminUserEditSuccess } = await helpers()
  const old = { guid: '3', nickname: 'Old', authVersion: 7 }; const other = { guid: '4', nickname: 'Other', authVersion: 2 }; const newer = { ...old, nickname: 'Newer cache', authVersion: 8 }; const fresh = { ...old, nickname: 'New' }
  const state = { selected: old, rows: [other, newer, old] }
  assert.equal(reconcileAdminUserEditSuccess({ state, user: fresh, targetGuid: '3', expectedAuthVersion: 7, isCurrent: () => true }), true)
  assert.equal(state.selected, fresh); assert.deepEqual(state.rows, [other, newer, fresh])
  const stale = { selected: old, rows: [old] }
  assert.equal(reconcileAdminUserEditSuccess({ state: stale, user: fresh, targetGuid: '3', expectedAuthVersion: 7, isCurrent: () => false }), false)
  assert.equal(stale.selected, old)
})

test('forbidden recovery stays invalidated until identity and target refresh both confirm editability', async () => {
  const { recoverAdminUserEditForbidden } = await helpers()
  assert.equal(typeof recoverAdminUserEditForbidden, 'function')
  let invalidated = true
  let targetLoads = 0
  const target = { guid: '3', role: 'user', status: 'active', authVersion: 7 }
  const base = { isCurrent: () => true, refreshTarget: async () => { targetLoads++; return target },
    canRestore: fresh => canOpenAdminUserEdit({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target: fresh }),
    restore: () => { invalidated = false } }
  assert.equal(await recoverAdminUserEditForbidden({ ...base, refreshIdentity: async () => { throw new Error('offline') } }), false)
  assert.equal(targetLoads, 0); assert.equal(invalidated, true)
  assert.equal(await recoverAdminUserEditForbidden({ ...base, refreshIdentity: async () => {}, canRestore: () => false }), false)
  assert.equal(targetLoads, 1); assert.equal(invalidated, true)
  assert.equal(await recoverAdminUserEditForbidden({ ...base, refreshIdentity: async () => {} }), true)
  assert.equal(targetLoads, 2); assert.equal(invalidated, false)
})

test('forbidden recovery shares the watcher detail GET for the refreshed identity snapshot and restores only after it settles', async () => {
  const { createAdminUserDetailLoadSingleflight, recoverAdminUserEditForbidden } = await helpers()
  assert.equal(typeof createAdminUserDetailLoadSingleflight, 'function')
  setActivePinia(createPinia())
  const users = useAdminUsersStore()
  const target = { guid: '3', username: 'alice', nickname: 'A', role: 'user', status: 'active', authVersion: 7 }
  let detailCalls = 0
  let releaseDetail
  const pendingDetail = new Promise(resolve => { releaseDetail = () => resolve(target) })
  users.loadDetail = async guid => { detailCalls++; assert.equal(guid, target.guid); const detail = await pendingDetail; users.selected = detail; return detail }
  const loads = createAdminUserDetailLoadSingleflight()
  let identityEpoch = 'epoch-1'
  let permissionVersion = 1
  let invalidated = true
  let watcherLoad = null
  const load = () => loads.run({ guid: target.guid, identityEpoch, permissionVersion,
    load: async () => (await users.loadDetail(target.guid))?.guid === target.guid })
  const recovery = recoverAdminUserEditForbidden({
    refreshIdentity: async () => { identityEpoch = 'epoch-2'; permissionVersion = 2; watcherLoad = load() },
    refreshTarget: async () => await load() ? users.selected : null,
    isCurrent: () => identityEpoch === 'epoch-2' && permissionVersion === 2,
    canRestore: fresh => canOpenAdminUserEdit({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target: fresh }),
    restore: () => { invalidated = false },
  })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(detailCalls, 1); assert.equal(invalidated, true)
  releaseDetail()
  assert.equal(await watcherLoad, true); assert.equal(await recovery, true)
  assert.equal(detailCalls, 1); assert.equal(invalidated, false)
})

test('conflict singleflight binds reuse to one owner and drops an old result after a new owner opens', async () => {
  const { createAdminUserEditConflictSingleflight } = await helpers()
  assert.equal(typeof createAdminUserEditConflictSingleflight, 'function')
  setActivePinia(createPinia())
  const editStore = useAdminUserEditStore()
  const ownership = { actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target: { guid: '3', username: 'alice', nickname: 'A', role: 'user', status: 'active', authVersion: 7 },
    routeGuid: '3', identityEpoch: 'epoch-1', permissionVersion: 1 }
  const flight = createAdminUserEditConflictSingleflight()
  const contextA = Object.freeze({ targetGuid: '3', authVersion: 7 })
  const tokenA = editStore.open(ownership)
  let releaseA
  const pendingA = new Promise(resolve => { releaseA = resolve })
  const a = flight.run({ token: tokenA, context: contextA, isCurrent: owner => editStore.owns(owner), execute: async current => { await pendingA; return current() } })
  assert.equal(flight.run({ token: tokenA, context: contextA, isCurrent: owner => editStore.owns(owner), execute: async () => true }), a)
  flight.cancel()
  const tokenB = editStore.open(ownership)
  const b = flight.run({ token: tokenB, context: Object.freeze({ targetGuid: '3', authVersion: 7 }), isCurrent: owner => editStore.owns(owner), execute: async current => current() })
  assert.notEqual(a, b); assert.equal(await b, true)
  releaseA(); assert.equal(await a, false)
})

test('view wires owned success, one conflict refresh, failure handling, focus restoration, and the Task5 store', () => {
  assert.ok(elements.some(node => node.tag === 'UserNicknameEditDialog'))
  for (const name of ['useAdminUserEditStore', 'canOpenAdminUserEdit', 'reconcileAdminUserEditSuccess', 'getAdminUser']) assert.ok(calls(name).length, `missing ${name}`)
  for (const name of ['onEditSucceeded', 'onEditConflict', 'onEditFailed', 'restoreEditFocus']) assert.match(descriptor.scriptSetup.content, new RegExp(name))
  assert.match(descriptor.scriptSetup.content, /failureCode === 'authentication_failed'|code === 'authentication_failed'/)
  assert.match(descriptor.scriptSetup.content, /\['forbidden', 'not_found'\]/)
  assert.match(descriptor.scriptSetup.content, /createAdminUserEditConflictSingleflight/)
  assert.match(descriptor.scriptSetup.content, /detailLoadFlight = createAdminUserDetailLoadSingleflight\(\)/)
  assert.match(descriptor.scriptSetup.content, /function openEdit[\s\S]*?cancelEditRefresh\(\)/)
  assert.match(descriptor.scriptSetup.content, /const detail = await store\.loadDetail[\s\S]*?return detail\?\.guid === guid/)
  assert.match(descriptor.scriptSetup.content, /editStore\.owns\(editToken\.value\)/)
  assert.match(descriptor.scriptSetup.content, /userStore\.identityEpoch/)
  assert.match(descriptor.template.content, /aria-live="polite"/)
  assert.doesNotMatch(source, /adminActionPost|\/admin\/users\//)
})
