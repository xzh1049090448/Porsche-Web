import { publicModelAdminListResource } from '../api/publicModelAdmin.js'

const scalar = value => typeof value === 'string' ? value : undefined
const integer = (value, fallback) => /^\d+$/.test(scalar(value) ?? '') ? Number(value) : fallback

export function publicModelAdminFiltersFromRoute(query = {}) {
  const filters = {
    search: scalar(query.search) ?? '',
    status: scalar(query.status) ?? '',
    upstreamState: scalar(query.upstream_state) ?? '',
    completeness: scalar(query.completeness) ?? '',
    page: integer(query.page, 1),
    pageSize: integer(query.page_size, 20),
  }
  publicModelAdminListResource(publicModelAdminServerFilters(filters))
  return filters
}

export function publicModelAdminServerFilters(filters) {
  return { search:filters.search||undefined,status:filters.status||undefined,upstreamState:filters.upstreamState||undefined,completeness:filters.completeness||undefined,page:filters.page,pageSize:filters.pageSize }
}

export function publicModelAdminRouteQuery(filters) {
  publicModelAdminListResource(publicModelAdminServerFilters(filters))
  return { ...(filters.search?{search:filters.search}:{}),...(filters.status?{status:filters.status}:{}),...(filters.upstreamState?{upstream_state:filters.upstreamState}:{}),...(filters.completeness?{completeness:filters.completeness}:{}),page:String(filters.page),page_size:String(filters.pageSize) }
}

export function resetPublicModelAdminPage(filters) { return { ...filters, page:1 } }
