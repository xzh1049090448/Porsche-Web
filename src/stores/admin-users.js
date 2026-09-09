import { defineStore } from 'pinia'
import { reactive, toRaw, toRefs } from 'vue'
import { listAdminUsers, getAdminUser, getAdminUserPermissions, getAdminUserRolePermissionSnapshot, getAuthzCatalog } from '../api/admin-users.js'
import { createAdminUsersState } from '../api/admin-users-state.js'
import { authSession } from '../api/request.js'
export { useAdminUserRolePermissionsStore } from './admin-user-role-permissions.js'

export function isCurrentAdminUserDetail(selected, detail) {
  return toRaw(selected) === detail
}

export async function reconcileCreatedAdminUser({ state, filters, createdUser, reload }) {
  if (createdUser) {
    state.rows = [createdUser, ...state.rows.filter(user => user.guid !== createdUser.guid)]
    state.total++
  }
  filters.page = 1
  await reload()
}

export const useAdminUsersStore = defineStore('adminUsers', () => {
  const state = reactive({ rows: [], total: 0, page: 1, pageSize: 20, recoveredPage: null, recoveryRevision: 0, selected: null, permissions: null, catalog: null, loading: false, detailLoading: false, error: null, detailError: null })
  const service = createAdminUsersState({ auth: authSession, state, api: { list: listAdminUsers, detail: getAdminUser, permissions: getAdminUserPermissions, catalog: getAuthzCatalog } })
  async function loadDetail(guid, options = {}) {
    const detail = await service.loadDetail(guid, options)
    if (options.isRoot && detail?.role === 'user' && isCurrentAdminUserDetail(state.selected, detail) && state.catalog == null) {
      try {
        const catalog = await getAuthzCatalog()
        if (isCurrentAdminUserDetail(state.selected, detail)) state.catalog = catalog
      } catch (error) {
        if (!isCurrentAdminUserDetail(state.selected, detail)) return undefined
        state.selected = null
        state.permissions = null
        state.catalog = null
        state.detailError = error
        throw error
      }
    }
    return detail
  }
  const refreshRolePermissionTarget = (guid, options = {}) => getAdminUserRolePermissionSnapshot(guid, options)
  return { ...toRefs(state), loadList: service.loadList, loadDetail, refreshRolePermissionTarget, clear: service.clear }
})
