/**
 * Request coordination for the B1-D read-only user management views.
 * It is deliberately framework-free so identity and late-response behavior can
 * be exercised without a browser or a Pinia instance.
 */
export function createAdminUsersState({ auth, api, state } = {}) {
  const value = state ?? {
    rows: [], total: 0, page: 1, pageSize: 20, recoveredPage: null, recoveryRevision: 0,
    selected: null, permissions: null, catalog: null,
    loading: false, detailLoading: false, error: null, detailError: null,
  }
  let listRequest = 0
  let detailRequest = 0
  let listAbort = null
  let detailAbort = null

  const current = (context, requestId, latest) => {
    if (requestId !== latest()) return false
    ;(auth.assertSnapshot ?? auth.assertCurrent)(context)
    return true
  }
  const clearList = () => { value.rows = []; value.total = 0; value.error = null; value.loading = false }
  const clearDetail = () => { value.selected = null; value.permissions = null; value.catalog = null; value.detailError = null; value.detailLoading = false }

  async function loadList(filters = {}, recoveredPage = false) {
    const requestId = ++listRequest
    const context = auth.capture()
    listAbort?.abort()
    listAbort = new AbortController()
    value.loading = true
    value.error = null
    if (!recoveredPage) value.recoveredPage = null
    try {
      const result = await api.list(filters, { signal: listAbort.signal })
      if (!current(context, requestId, () => listRequest)) return undefined
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize))
      if (!recoveredPage && result.items.length === 0 && result.total > 0 && Number(filters.page) > lastPage) {
        // Tell the controlled pagination its final page before the fallback
        // response changes total. Element Plus otherwise emits a duplicate
        // current-change while it clamps an out-of-range page.
        value.recoveredPage = lastPage
        value.recoveryRevision++
        return loadList({ ...filters, page: lastPage }, true)
      }
      value.rows = result.items
      value.total = result.total
      value.page = result.page
      value.pageSize = result.pageSize
      return result
    } catch (error) {
      try {
        if (!current(context, requestId, () => listRequest)) return undefined
      } catch { return undefined }
      value.rows = []
      value.total = 0
      value.error = error
      throw error
    } finally {
      try {
        if (current(context, requestId, () => listRequest)) value.loading = false
      } catch { /* Snapshot invalidation already cleared this state. */ }
    }
  }

  async function loadDetail(guid, { isRoot = false } = {}) {
    const requestId = ++detailRequest
    const context = auth.capture()
    detailAbort?.abort()
    detailAbort = new AbortController()
    value.detailLoading = true
    value.detailError = null
    value.selected = null
    value.permissions = null
    value.catalog = null
    try {
      const detail = await api.detail(guid, { signal: detailAbort.signal })
      if (!current(context, requestId, () => detailRequest)) return undefined
      value.selected = detail
      if (isRoot && detail.role === 'admin') {
        const [permissions, catalog] = await Promise.all([
          api.permissions(guid, { signal: detailAbort.signal }),
          api.catalog({ signal: detailAbort.signal }),
        ])
        if (!current(context, requestId, () => detailRequest)) return undefined
        value.permissions = permissions
        value.catalog = catalog
      }
      return detail
    } catch (error) {
      try {
        if (!current(context, requestId, () => detailRequest)) return undefined
      } catch { return undefined }
      value.selected = null
      value.permissions = null
      value.catalog = null
      value.detailError = error
      throw error
    } finally {
      try {
        if (current(context, requestId, () => detailRequest)) value.detailLoading = false
      } catch { /* Snapshot invalidation already cleared this state. */ }
    }
  }

  function clear() {
    listRequest++
    detailRequest++
    listAbort?.abort()
    detailAbort?.abort()
    clearList()
    clearDetail()
  }

  auth.onInvalidate?.(clear)
  auth.onSnapshotInvalidate?.(clear)
  return { value, loadList, loadDetail, clear }
}
