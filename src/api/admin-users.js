export const ADMIN_CAPABILITIES = [
  'users.read', 'users.create', 'users.edit', 'users.enable', 'users.disable', 'users.reset_password',
  'users.sessions.read', 'users.sessions.revoke', 'users.plan.change', 'users.group.change', 'users.quota.adjust',
  'users.delete', 'users.deleted.read', 'users.promote', 'users.demote', 'users.permissions.write', 'users.audit.read',
  'groups.read', 'groups.write', 'public_content.read', 'public_content.edit', 'public_content.preview',
  'public_content.publish', 'public_content.rollback',
]
const ADMIN_BASELINE = new Set(['users.read', 'users.create', 'users.edit', 'users.enable', 'users.disable', 'users.audit.read', 'groups.read'])
const ROOT_ONLY = new Set(['users.promote', 'users.demote', 'users.permissions.write', 'groups.write'])
const UNAVAILABLE = new Set(['users.quota.adjust'])
const NOT_GRANTABLE = new Set([...ROOT_ONLY, ...UNAVAILABLE])
export const ADMIN_CAPABILITY_DEFINITIONS = ADMIN_CAPABILITIES.map(name => ({ name, baseline: ADMIN_BASELINE.has(name), grantable: !NOT_GRANTABLE.has(name), rootOnly: ROOT_ONLY.has(name), available: !UNAVAILABLE.has(name) }))
const ROLES = new Set(['user', 'admin', 'root'])
const STATUSES = new Set(['active', 'disabled', 'deleted'])
const SORTS = new Set(['guid', 'username', 'created_at', 'last_login_at'])
const ORDERS = new Set(['asc', 'desc'])
const PAGE_SIZES = new Set([20, 50, 100]); const MAX_INT32 = 2147483647
const GUID = /^[1-9]\d{0,18}$/
const MAX_INT64 = '9223372036854775807'
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) { if (value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) { index++; continue }; return true }
    if (code >= 0xDC00 && code <= 0xDFFF) return true
  }
  return false
}
function utcRfc3339(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/.exec(value)
  if (!match || Number.isNaN(Date.parse(value))) return false
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]))
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3]
}

function positiveInt(value, fallback, code) {
  if (value == null || value === '') return fallback
  const text = String(value)
  if (!/^[1-9]\d*$/.test(text)) throw new Error(code)
  const n = Number(text)
  if (!Number.isSafeInteger(n) || n > MAX_INT32) throw new Error(code)
  return n
}
function compareDecimal(a, b) { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0) }
function validGuid(value) { return typeof value === 'string' && GUID.test(value) && compareDecimal(value, MAX_INT64) <= 0 }

export function buildAdminUsersQuery(filters = {}) {
  const page = positiveInt(filters.page, 1, 'invalid_page')
  const pageSize = filters.pageSize == null || filters.pageSize === '' ? 20 : Number(filters.pageSize)
  if (!PAGE_SIZES.has(pageSize)) throw new Error('invalid_page_size')
  const qRaw = typeof filters.q === 'string' ? filters.q.trim() : ''
  if (hasLoneSurrogate(qRaw) || [...qRaw].length > 128) throw new Error('invalid_query')
  const q = qRaw
  const role = filters.role || ''
  const status = filters.status || ''
  if (role && !ROLES.has(role)) throw new Error('invalid_role')
  if (status && !STATUSES.has(status) && status !== 'active,disabled') throw new Error('invalid_status')
  const sort = SORTS.has(filters.sort) && ORDERS.has(filters.order) ? filters.sort : 'guid'
  const order = sort === 'guid' && !(SORTS.has(filters.sort) && ORDERS.has(filters.order)) ? 'desc' : filters.order
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (q) params.set('q', q)
  if (role) params.set('role', role)
  if (status && status !== 'active,disabled') params.set('status', status)
  params.set('sort', sort); params.set('order', order || 'desc')
  return params.toString()
}

export function mapUserReadDto(raw) {
  if (!raw || typeof raw !== 'object' || !validGuid(raw.guid)) throw new Error('invalid_guid')
  if (!exactKeys(raw, ['guid', 'username', 'nickname', 'email', 'group', 'plan_type', 'role', 'status', 'auth_version', 'created_at', 'last_login_at'])) throw new Error('invalid_user')
  if (
      !Object.hasOwn(raw, 'username') || ![null].includes(raw.username) && typeof raw.username !== 'string'
      || !Object.hasOwn(raw, 'nickname') || ![null].includes(raw.nickname) && typeof raw.nickname !== 'string'
      || raw.email !== null || typeof raw.group !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(raw.group)
      || !['free', 'professional', 'enterprise'].includes(raw.plan_type)
      || !['user', 'admin'].includes(raw.role) || !STATUSES.has(raw.status)
      || !Number.isInteger(raw.auth_version) || raw.auth_version < 1 || raw.auth_version > MAX_INT32
      || !utcRfc3339(raw.created_at)
      || !(raw.last_login_at === null || utcRfc3339(raw.last_login_at))) throw new Error('invalid_user')
  return { guid: raw.guid, username: raw.username ?? null, nickname: raw.nickname ?? null, email: null, group: raw.group,
    planType: raw.plan_type, role: raw.role, status: raw.status, authVersion: raw.auth_version, createdAt: raw.created_at, lastLoginAt: raw.last_login_at }
}

export function mapPermissionProjection(raw) {
  const capabilities = raw?.admin_permissions
  const version = raw?.permissions_version
  if (!Array.isArray(capabilities) || capabilities.some(value => typeof value !== 'string' || !ADMIN_CAPABILITIES.includes(value) || value === 'users.quota.adjust')
      || new Set(capabilities).size !== capabilities.length || typeof version !== 'string' || !/^\d+$/.test(version)
      || (version !== '0' && version.startsWith('0')) || compareDecimal(version, '9223372036854775807') > 0) return null
  return { capabilities: [...capabilities], version }
}

export function mapAuthzCatalog(raw) {
  if (!exactKeys(raw, ['catalog_version', 'override_effects', 'capabilities']) || raw.catalog_version !== 1 || !Array.isArray(raw.override_effects)
      || raw.override_effects.join('\0') !== 'inherit\0allow\0deny'
      || !Array.isArray(raw.capabilities) || raw.capabilities.length !== ADMIN_CAPABILITIES.length
      || raw.capabilities.map(item => item?.name).join('\0') !== ADMIN_CAPABILITIES.join('\0')
      || raw.capabilities.some(item => !exactKeys(item, ['name', 'admin_default', 'grantable', 'root_only', 'available']) || typeof item.admin_default !== 'boolean'
        || typeof item.grantable !== 'boolean' || typeof item.root_only !== 'boolean' || typeof item.available !== 'boolean')
      || raw.capabilities.some((item, index) => {
        const definition = ADMIN_CAPABILITY_DEFINITIONS[index]
        return item.admin_default !== definition.baseline || item.grantable !== definition.grantable || item.root_only !== definition.rootOnly || item.available !== definition.available
      })) throw new Error('invalid_catalog')
  return raw
}

export async function listAdminUsers(filters, options = {}) {
  const { default: request } = await import('./request.js')
  const raw = await request.get(`/admin/v2/users?${buildAdminUsersQuery(filters)}`, options)
  if (!exactKeys(raw, ['items', 'total', 'page', 'page_size']) || !Array.isArray(raw.items) || !Number.isInteger(raw.total) || raw.total < 0 || !Number.isInteger(raw.page) || raw.page < 1 || !PAGE_SIZES.has(raw.page_size)) throw new Error('invalid_users_response')
  return { items: raw.items.map(mapUserReadDto), total: raw.total, page: raw.page, pageSize: raw.page_size }
}
export async function getAdminUser(guid, options = {}) {
  if (!validGuid(guid)) throw new Error('invalid_guid')
  const { default: request } = await import('./request.js')
  return mapUserReadDto(await request.get(`/admin/v2/users/${encodeURIComponent(guid)}`, options))
}
export function mapUserPermissions(raw, guid) {
  if (!exactKeys(raw, ['user_guid', 'role', 'status', 'catalog_version', 'permissions_version', 'capabilities']) || raw.user_guid !== guid || raw.catalog_version !== 1 || !['admin'].includes(raw.role) || !['active', 'disabled'].includes(raw.status)
      || typeof raw.permissions_version !== 'string' || !/^(0|[1-9]\d*)$/.test(raw.permissions_version) || compareDecimal(raw.permissions_version, '9223372036854775807') > 0
      || !Array.isArray(raw.capabilities) || raw.capabilities.length !== 24 || raw.capabilities.map(item => item?.name).join('\0') !== ADMIN_CAPABILITIES.join('\0')
      || raw.capabilities.some((item, index) => {
        if (!exactKeys(item, ['name', 'baseline', 'override', 'policy_effective', 'effective']) || !['inherit', 'allow', 'deny'].includes(item.override) || typeof item.baseline !== 'boolean' || typeof item.policy_effective !== 'boolean' || typeof item.effective !== 'boolean') return true
        const definition = ADMIN_CAPABILITY_DEFINITIONS[index]
        if (item.baseline !== definition.baseline) return true
        if (item.override === 'allow' && !definition.grantable) return true
        const policy = !definition.available || definition.rootOnly ? false : item.override === 'deny' ? false : item.override === 'allow' ? definition.grantable : definition.baseline
        return item.policy_effective !== policy || item.effective !== (raw.status === 'active' && policy)
      })) throw new Error('invalid_permissions')
  return raw
}
export async function getAdminUserPermissions(guid, options = {}) {
  if (!validGuid(guid)) throw new Error('invalid_guid')
  const { default: request } = await import('./request.js')
  return mapUserPermissions(await request.get(`/admin/v2/users/${encodeURIComponent(guid)}/permissions`, options), guid)
}
export async function getAuthzCatalog(options = {}) { const { default: request } = await import('./request.js'); return mapAuthzCatalog(await request.get('/admin/v2/authz/catalog', options)) }

export function createAdminUserRolePermissionSnapshotReader({ detail = getAdminUser, permissions = getAdminUserPermissions } = {}) {
  if (typeof detail !== 'function' || typeof permissions !== 'function') throw new TypeError('invalid_role_permission_snapshot_reader')
  return async (guid, options = {}) => {
    const target = await detail(guid, options)
    const policy = target?.role === 'admin' ? await permissions(guid, options) : null
    return Object.freeze({ target, permissions:policy })
  }
}
export const getAdminUserRolePermissionSnapshot = createAdminUserRolePermissionSnapshotReader()
