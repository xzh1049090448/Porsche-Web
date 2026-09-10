import test from 'node:test'
import assert from 'node:assert/strict'
import { publicModelAdminFiltersFromRoute,publicModelAdminRouteQuery,publicModelAdminServerFilters,resetPublicModelAdminPage } from './public-model-admin-route-query.js'

test('admin model filters round-trip completeness and pagination through one canonical URL',()=>{
  const filters=publicModelAdminFiltersFromRoute({search:'glm',status:'active',upstream_state:'present',completeness:'complete',page:'3',page_size:'50'})
  assert.deepEqual(filters,{search:'glm',status:'active',upstreamState:'present',completeness:'complete',page:3,pageSize:50})
  assert.deepEqual(publicModelAdminRouteQuery(filters),{search:'glm',status:'active',upstream_state:'present',completeness:'complete',page:'3',page_size:'50'})
  assert.deepEqual(publicModelAdminServerFilters(filters),{search:'glm',status:'active',upstreamState:'present',completeness:'complete',page:3,pageSize:50})
})

test('invalid completeness is blocked before it can become a backend request',()=>{
  for(const value of ['all','Complete',' incomplete ','']) {
    if(value==='') continue
    assert.throws(()=>publicModelAdminFiltersFromRoute({completeness:value}),/invalid_public_model_admin_query/)
  }
  assert.throws(()=>publicModelAdminRouteQuery({search:'',status:'',upstreamState:'',completeness:'bad',page:1,pageSize:20}),/invalid_public_model_admin_query/)
})

test('changing filters resets only page while later pagination preserves all filters',()=>{
  const current={search:'deepseek',status:'inactive',upstreamState:'missing',completeness:'incomplete',page:7,pageSize:100}
  const reset=resetPublicModelAdminPage(current);assert.deepEqual(reset,{...current,page:1});assert.equal(current.page,7)
  assert.equal(publicModelAdminServerFilters({...reset,page:2}).completeness,'incomplete')
})
