const GUID = /^[1-9]\d{0,18}$/
const MAX_INT64 = '9223372036854775807'
const GROUP_KEY = /^[a-z][a-z0-9_-]{0,63}$/

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const compareDecimal = (left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0)
const validGuid = value => typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) { index++; continue }
      return true
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return true
  }
  return false
}

function mapGroup(raw) {
  if (!exactKeys(raw, ['guid', 'key', 'display_name']) || !validGuid(raw.guid) || !GROUP_KEY.test(raw.key)
      || typeof raw.display_name !== 'string' || raw.display_name.length === 0 || hasLoneSurrogate(raw.display_name) || [...raw.display_name].length > 64) throw new Error('invalid_groups')
  return Object.freeze({ guid: raw.guid, key: raw.key, displayName: raw.display_name })
}

export function mapActiveAdminGroups(raw) {
  if (!exactKeys(raw, ['items']) || !Array.isArray(raw.items)) throw new Error('invalid_groups')
  const items = raw.items.map(mapGroup)
  const guids = new Set()
  let defaultCount = 0
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (guids.has(item.guid) || index > 0 && item.key <= items[index - 1].key) throw new Error('invalid_groups')
    guids.add(item.guid)
    if (item.key === 'default') defaultCount++
  }
  if (defaultCount !== 1) throw new Error('invalid_groups')
  return Object.freeze({ items: Object.freeze(items) })
}

export function createAdminGroupsApi({ get }) {
  if (typeof get !== 'function') throw new Error('invalid_groups_api')
  return Object.freeze({
    async active(options = {}) {
      return mapActiveAdminGroups(await get('/admin/v2/groups?status=active', options))
    },
  })
}

export async function getActiveAdminGroups(options = {}) {
  const { default: request } = await import('./request.js')
  return createAdminGroupsApi({ get: request.get.bind(request) }).active(options)
}

export const DEFAULT_ADMIN_GROUP_CHOICE = Object.freeze({ guid: null, key: 'default', displayName: 'Default' })

export async function loadAdminGroupChoices(permissions, { api, options = {} } = {}) {
  if (!Array.isArray(permissions) || !permissions.includes('groups.read')) return Object.freeze([DEFAULT_ADMIN_GROUP_CHOICE])
  const source = api ?? Object.freeze({ active: getActiveAdminGroups })
  if (typeof source.active !== 'function') throw new Error('invalid_groups_api')
  const directory = await source.active(options)
  return directory.items
}

export function serializeAdminGroupChoice(choice) {
  if (choice === DEFAULT_ADMIN_GROUP_CHOICE || exactKeys(choice, ['guid', 'key', 'displayName']) && choice.guid === null && choice.key === 'default' && choice.displayName === 'Default') return Object.freeze({})
  if (!exactKeys(choice, ['guid', 'key', 'displayName']) || !validGuid(choice.guid) || !GROUP_KEY.test(choice.key)
      || typeof choice.displayName !== 'string' || choice.displayName.length === 0) throw new Error('invalid_group_choice')
  return Object.freeze({ group_guid: choice.guid })
}
