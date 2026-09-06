import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ADMIN_GROUP_CHOICE,
  createAdminGroupsApi,
  loadAdminGroupChoices,
  mapActiveAdminGroups,
  serializeAdminGroupChoice,
} from './admin-groups.js'

const rawDirectory = {
  items: [
    { guid: '101', key: 'alpha', display_name: 'Alpha' },
    { guid: '102', key: 'default', display_name: 'Default' },
    { guid: '103', key: 'team_1', display_name: 'Team 1' },
  ],
}

test('group mapper accepts only the exact ordered active directory DTO', () => {
  const mapped = mapActiveAdminGroups(rawDirectory)
  assert.deepEqual(mapped, {
    items: [
      { guid: '101', key: 'alpha', displayName: 'Alpha' },
      { guid: '102', key: 'default', displayName: 'Default' },
      { guid: '103', key: 'team_1', displayName: 'Team 1' },
    ],
  })
  assert.equal(Object.isFrozen(mapped), true)
  assert.equal(Object.isFrozen(mapped.items), true)
  assert.equal(Object.isFrozen(mapped.items[0]), true)

  const invalid = [
    { ...rawDirectory, internal_id: 1 },
    { items: [{ ...rawDirectory.items[0], id: 1 }, ...rawDirectory.items.slice(1)] },
    { items: [rawDirectory.items[0], rawDirectory.items[2]] },
    { items: [rawDirectory.items[1], rawDirectory.items[0]] },
    { items: [rawDirectory.items[1], rawDirectory.items[1]] },
    { items: [{ ...rawDirectory.items[0], guid: '01' }, ...rawDirectory.items.slice(1)] },
    { items: [{ ...rawDirectory.items[0], key: 'Alpha' }, ...rawDirectory.items.slice(1)] },
    { items: [{ ...rawDirectory.items[0], display_name: '' }, ...rawDirectory.items.slice(1)] },
  ]
  for (const value of invalid) assert.throws(() => mapActiveAdminGroups(value), /invalid_groups/)
})

test('group API calls only the exact active directory path', async () => {
  const calls = []
  const api = createAdminGroupsApi({
    get: async (path, options) => { calls.push([path, options]); return rawDirectory },
  })
  const options = { signal: new AbortController().signal }
  const result = await api.active(options)
  assert.equal(result.items[1].key, 'default')
  assert.deepEqual(calls, [['/admin/v2/groups?status=active', options]])
  assert.equal(Object.isFrozen(api), true)
})

test('group choices do not call the directory without groups.read and omit group_guid', async () => {
  let calls = 0
  const api = { active: async () => { calls++; return mapActiveAdminGroups(rawDirectory) } }
  for (const permissions of [undefined, null, [], ['users.create']]) {
    const choices = await loadAdminGroupChoices(permissions, { api })
    assert.equal(calls, 0)
    assert.deepEqual(choices, [DEFAULT_ADMIN_GROUP_CHOICE])
    assert.equal(Object.isFrozen(choices), true)
    assert.equal(Object.isFrozen(choices[0]), true)
    const serialized = serializeAdminGroupChoice(choices[0])
    assert.deepEqual(serialized, {})
    assert.equal(Object.hasOwn(serialized, 'group_guid'), false)
    assert.equal(JSON.stringify(serialized), '{}')
  }

  const choices = await loadAdminGroupChoices(['users.create', 'groups.read'], { api })
  assert.equal(calls, 1)
  assert.deepEqual(choices, mapActiveAdminGroups(rawDirectory).items)
  assert.deepEqual(serializeAdminGroupChoice(choices[0]), { group_guid: '101' })
})
