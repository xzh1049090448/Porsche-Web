import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'

import { ADMIN_CAPABILITIES, ADMIN_CAPABILITY_DEFINITIONS } from '../../api/admin-users.js'

const source = await readFile(new URL('./UserPermissionEditor.vue', import.meta.url), 'utf8')
const descriptor = parse(source, { filename: 'UserPermissionEditor.vue' }).descriptor
const vite = await createServer({
  root: new URL('../../../', import.meta.url).pathname,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
})
after(() => vite.close())
const { buildPermissionEditorModel } = await vite.ssrLoadModule('/src/components/admin/UserPermissionEditor.vue')

const catalog = () => ({
  catalog_version: 1,
  override_effects: ['inherit', 'allow', 'deny'],
  capabilities: ADMIN_CAPABILITY_DEFINITIONS.map(item => ({
    name: item.name, admin_default: item.baseline, grantable: item.grantable,
    root_only: item.rootOnly, available: item.available,
  })),
})
const projection = (overrides = new Map(), status = 'active') => ({
  user_guid: '9', role: 'admin', status, catalog_version: 1, permissions_version: '3',
  capabilities: ADMIN_CAPABILITY_DEFINITIONS.map(definition => {
    const override = overrides.get(definition.name) ?? 'inherit'
    const policyEffective = !definition.available || definition.rootOnly ? false
      : override === 'deny' ? false : override === 'allow' ? true : definition.baseline
    return { name: definition.name, baseline: definition.baseline, override, policy_effective: policyEffective, effective: status === 'active' && policyEffective }
  }),
})

test('component is controlled and contains no API, authorization, or dialog behavior', () => {
  assert.ok(descriptor.scriptSetup)
  assert.match(descriptor.scriptSetup.content, /defineProps/)
  assert.match(descriptor.scriptSetup.content, /defineEmits/)
  assert.doesNotMatch(source, /request\.js|admin-user-roles-permissions|fetch\(|axios|useAdminUserRolePermissionsStore|el-dialog|currentPassword|ticket|idempotency/i)
  assert.match(descriptor.template.content, /el-radio-group/)
  assert.match(descriptor.template.content, /aria-labelledby/)
})

test('builds all 24 rows in canonical order and stable module groups', () => {
  const result = buildPermissionEditorModel(catalog(), projection(), [])
  assert.equal(result.valid, true)
  assert.deepEqual(result.rows.map(row => row.name), ADMIN_CAPABILITIES)
  assert.deepEqual(result.groups.map(group => [group.key, group.rows.length]), [
    ['users', 17], ['groups', 2], ['public_content', 5],
  ])
  assert.deepEqual(result.rows[0], {
    name: 'users.read', baseline: true, override: 'inherit', policyEffective: true,
    effective: true, source: 'baseline', grantable: true, rootOnly: false, available: true, locked: false,
  })
})

test('shows baseline override effective and source while locking Root-only and unavailable rows', () => {
  const model = buildPermissionEditorModel(catalog(), projection(), [
    { capability: 'users.read', effect: 'deny' },
    { capability: 'groups.read', effect: 'allow' },
  ])
  assert.equal(model.rows[0].baseline, true)
  assert.equal(model.rows[0].override, 'deny')
  assert.equal(model.rows[0].effective, false)
  assert.equal(model.rows[0].source, 'override_deny')
  assert.equal(model.rows[17].source, 'override_allow')
  for (const name of ['users.quota.adjust', 'users.promote', 'users.demote', 'users.permissions.write', 'groups.write']) {
    assert.equal(model.rows.find(row => row.name === name).locked, true)
  }
})

test('fails closed for unknown duplicate noncanonical or contradictory inputs', () => {
  const cases = [
    [catalog(), projection(), [{ capability: 'unknown', effect: 'allow' }]],
    [catalog(), projection(), [{ capability: 'users.read', effect: 'allow' }, { capability: 'users.read', effect: 'deny' }]],
    [catalog(), projection(), [{ capability: 'users.read', effect: 'inherit' }]],
    [{ ...catalog(), capabilities: catalog().capabilities.reverse() }, projection(), []],
    [catalog(), { ...projection(), capabilities: projection().capabilities.slice(0, 23) }, []],
    [catalog(), { ...projection(), user_guid: '01' }, []],
    [catalog(), { ...projection(), permissions_version: '9223372036854775808' }, []],
  ]
  for (const args of cases) {
    const model = buildPermissionEditorModel(...args)
    assert.equal(model.valid, false)
    assert.deepEqual(model.rows, [])
    assert.deepEqual(model.groups, [])
  }
})

test('does not trust later mutation of exported capability metadata', () => {
  const original = ADMIN_CAPABILITY_DEFINITIONS[0].baseline
  try {
    ADMIN_CAPABILITY_DEFINITIONS[0].baseline = !original
    assert.equal(buildPermissionEditorModel(catalog(), projection(), []).valid, false)
  } finally {
    ADMIN_CAPABILITY_DEFINITIONS[0].baseline = original
  }
})
