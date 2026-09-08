import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { listAdminUsers, getAdminUser, getAdminUserPermissions, getAuthzCatalog } from '../api/admin-users.js'
import { createAdminUsersState } from '../api/admin-users-state.js'
import { authSession } from '../api/request.js'

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
  return { ...toRefs(state), loadList: service.loadList, loadDetail: service.loadDetail, clear: service.clear }
})
