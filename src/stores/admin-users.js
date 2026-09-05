import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { listAdminUsers, getAdminUser, getAdminUserPermissions, getAuthzCatalog } from '@/api/admin-users'
import { createAdminUsersState } from '@/api/admin-users-state'
import { authSession } from '@/api/request'

export const useAdminUsersStore = defineStore('adminUsers', () => {
  const state = reactive({ rows: [], total: 0, page: 1, pageSize: 20, recoveredPage: null, recoveryRevision: 0, selected: null, permissions: null, catalog: null, loading: false, detailLoading: false, error: null, detailError: null })
  const service = createAdminUsersState({ auth: authSession, state, api: { list: listAdminUsers, detail: getAdminUser, permissions: getAdminUserPermissions, catalog: getAuthzCatalog } })
  return { ...toRefs(state), loadList: service.loadList, loadDetail: service.loadDetail, clear: service.clear }
})
