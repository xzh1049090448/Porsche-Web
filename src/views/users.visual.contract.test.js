import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const users = readFileSync(new URL('./Users.vue', import.meta.url), 'utf8')
const detail = readFileSync(new URL('./UserDetail.vue', import.meta.url), 'utf8')

test('user list uses the shared console hierarchy with responsive table and card views', () => {
  for (const marker of [
    'PageHeader',
    'console-page',
    'surface-card',
    'filter-toolbar',
    'responsive-table',
    'mobile-user-cards',
    'StatusBadge',
    'pagination-bar',
  ]) assert.match(users, new RegExp(marker), `missing ${marker}`)

  for (const label of ['详情', "t('deleteUser.confirm')"]) assert.ok(users.includes(label), `missing visible action ${label}`)
  for (const status of ['active', 'disabled', 'deleted']) assert.match(users, new RegExp(status))
  assert.match(users, /statusTone/)
})

test('user detail uses shared surfaces while retaining owned guarded mutations and recovery', () => {
  for (const marker of [
    'page-header',
    'console-page',
    'surface-card',
    'detail-action-toolbar',
    'responsive-table',
    'status-badge',
  ]) assert.match(detail, new RegExp(marker), `missing ${marker}`)

  for (const predicate of [
    'canPromoteTarget',
    'canPermissionsTarget',
    'canDemoteTarget',
    'canPasswordResetTarget',
    'canStatusTarget',
    'canDeleteTarget',
  ]) assert.match(detail, new RegExp(`v-if="${predicate}"`), `missing guarded ${predicate}`)

  for (const safety of [
    'rolePermissionToken',
    'statusToken',
    'deleteToken',
    'restoreStatusFocus',
    'restoreDeleteFocus',
    'restoreRolePermissionFocus',
    'onRolePermissionConflict',
    'onStatusConflict',
  ]) assert.match(detail, new RegExp(safety), `missing safety anchor ${safety}`)
})
