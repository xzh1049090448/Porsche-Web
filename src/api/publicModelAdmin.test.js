import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicModelAdminApi, publicModelAdminListResource } from './publicModelAdmin.js'

const headers = {'Cache-Control':'no-store','X-Request-ID':'req-1'}
const ticket = `av_${'A'.repeat(43)}`
const dto = {guid:'123',model_key:'m',upstream_model_id:'up/m',display_name:'M',provider:'P',capabilities:['chat'],context_window:1000,input_price_usd_per_million_tokens:'1.00',output_price_usd_per_million_tokens:null,status:'draft',revision:1,last_upstream_check_at:null,public_display_group:'general',endpoint_types:['chat'],public_restrictions:[],price_source:'catalog',price_reviewer:'root',price_effective_at:1720000000000}
const ok = (data,status=200) => ({data,status,headers})

test('list query is canonical and has no deleted/restore filter', () => {
  assert.equal(publicModelAdminListResource({search:'a b',status:'inactive',upstreamState:'missing',page:2,pageSize:50}),'/admin/v2/public-models?search=a+b&status=inactive&upstream_state=missing&page=2&page_size=50')
  assert.throws(() => publicModelAdminListResource({status:'deleted'}))
  assert.throws(() => publicModelAdminListResource({includeDeleted:true}))
  for(const search of [' padded ','bad\nsearch','bad\u200bsearch','x'.repeat(129)]) assert.throws(()=>publicModelAdminListResource({search}),/invalid_public_model_admin_query/)
})
test('CRUD lifecycle missing and sync use exact routes and bodies', async () => {
  const calls=[]; const api=createPublicModelAdminApi({request:async x=>{calls.push(x); if(x.path.endsWith('/missing')) return ok({observed_without_configuration:['up/new'],configured_missing_upstream:[dto]}); if(x.path.endsWith('/sync')) return ok({accepted:true},202); if(x.method==='DELETE') return ok(null,204); if(x.path==='/admin/v2/public-models'&&x.method==='GET') return ok({items:[dto],page:1,page_size:20,total:1}); return ok(dto,x.method==='POST'&&x.path==='/admin/v2/public-models'?201:200)}})
  assert.equal((await api.list()).items[0].inputPriceUsdPerMillionTokens,'1.00')
  await api.create({upstream_model_id:'up/m'}); await api.update('123',{expected_revision:1}); await api.activate('123',1); await api.deactivate('123',2,'retired'); await api.getMissing(); await api.sync(); await api.deleteModel('123',{expectedRevision:3,reason:'retired',ticket})
  assert.deepEqual(calls.map(c=>[c.method,c.path,c.body,c.headers]),[
    ['GET','/admin/v2/public-models',undefined,undefined],['POST','/admin/v2/public-models',{upstream_model_id:'up/m'},undefined],['PATCH','/admin/v2/public-models/123',{expected_revision:1},undefined],['POST','/admin/v2/public-models/123/activate',{expected_revision:1},undefined],['POST','/admin/v2/public-models/123/deactivate',{expected_revision:2,reason:'retired'},undefined],['GET','/admin/v2/public-models/missing',undefined,undefined],['POST','/admin/v2/public-models/sync',undefined,undefined],['DELETE','/admin/v2/public-models/123',{expected_revision:3,reason:'retired'},{'X-Action-Ticket':ticket}]
  ])
})
test('delete verification keeps password only in request and ticket out of body', async () => {
  const calls=[]; const api=createPublicModelAdminApi({request:async x=>{calls.push(x); return ok({ticket,expires_at:1720000000000},201)}})
  assert.deepEqual(await api.issueDeleteVerification({guid:'123',expectedRevision:2,reason:'retired',currentPassword:'secret'}),{ticket,expiresAt:1720000000000})
  assert.deepEqual(calls[0].body,{action:'public_models.delete',intent:{target_guid:'123',expected_revision:2,reason:'retired'},current_password:'secret'})
  const malformed=createPublicModelAdminApi({request:async()=>ok({ticket:'av_short',expires_at:1720000000000},201)})
  await assert.rejects(malformed.issueDeleteVerification({guid:'123',expectedRevision:2,reason:'retired',currentPassword:'secret'}),/invalid_public_model_admin_response/)
  for(const why of [' padded ','bad\nreason','bad\u200breason','界'.repeat(129)]) assert.throws(()=>api.deleteModel('123',{expectedRevision:2,reason:why,ticket}),/invalid_public_model_admin_request/)
})
test('strict response rejects unknown fields, numeric decimals and unsafe errors', async () => {
  for (const bad of [{...dto,secret:'x'},{...dto,input_price_usd_per_million_tokens:1}]) {
    const api=createPublicModelAdminApi({request:async()=>ok(bad)})
    await assert.rejects(api.get('123'),/invalid_public_model_admin_response/)
  }
  const unsafe=createPublicModelAdminApi({request:async()=>{throw {response:{status:409,data:{error:{code:'stale_revision',message:'raw upstream secret',request_id:'req'}},headers}}}})
  await assert.rejects(unsafe.get('123'),e=>e.code==='request_failed'&&!e.message.includes('secret'))
  const conflict=createPublicModelAdminApi({request:async()=>{throw {response:{status:409,data:{error:{code:'conflict',message:'revision conflict',request_id:'req-1'}},headers}}}})
  await assert.rejects(conflict.get('123'),e=>e.code==='revision_conflict'&&e.message==='请求失败，请刷新后重试')
  const mismatched=createPublicModelAdminApi({request:async()=>{throw {response:{status:409,data:{error:{code:'conflict',message:'revision conflict',request_id:'other'}},headers}}}})
  await assert.rejects(mismatched.get('123'),e=>e.code==='request_failed')
})

test('strict DTO enforces int64 identities and every backend-safe scalar and array', async () => {
  const mutations=[
    {guid:'9223372036854775808'},{guid:'01'},{model_key:'m-'},{model_key:'m--x'},{upstream_model_id:'org/../m'},
    {display_name:' bad'},{provider:'bad\u200bprovider'},{capabilities:['chat','chat']},{capabilities:['Chat']},
    {endpoint_types:['chat','chat']},{public_restrictions:['Bad']},{public_display_group:'General'},
    {price_source:'bad\nsource'},{price_reviewer:'bad\u200breviewer'},
  ]
  for(const change of mutations){const api=createPublicModelAdminApi({request:async()=>ok({...dto,...change})});await assert.rejects(api.get('123'),/invalid_public_model_admin_response/)}
  assert.throws(()=>createPublicModelAdminApi({request:async()=>ok(dto)}).get('9223372036854775808'),/invalid_public_model_admin_request/)
})

test('store cancels old reads and suppresses stale responses and delete tickets', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js')
  let resolveFirst; const state={items:[],page:1,pageSize:20,total:0,detail:null,missing:null,loading:false,error:null}
  const api={list:()=>new Promise(r=>{resolveFirst=r}),get:async()=>dto,getMissing:async()=>({}),sync:async()=>({accepted:true}),issueDeleteVerification:async()=>({ticket,expiresAt:1}),deleteModel:async()=>true}
  const c=createPublicModelAdminCoordinator({api,state});const first=c.load();await c.loadDetail('123');resolveFirst({items:[dto],page:1,pageSize:20,total:1});await first
  assert.equal(state.detail,dto);assert.deepEqual(state.items,[])
  await c.remove({guid:'123',expectedRevision:1,reason:'retired',currentPassword:'secret'});assert.equal(JSON.stringify(state).includes(ticket),false)
})

test('store exposes create update activate and inactivate without retaining request secrets', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js');const calls=[]
  const changed={...dto,revision:2,status:'active'};const api={list:async()=>{},get:async()=>{},getMissing:async()=>{},sync:async()=>{},create:async(body)=>{calls.push(['create',body]);return dto},update:async(id,body)=>{calls.push(['update',id,body]);return changed},activate:async(id,rev)=>{calls.push(['activate',id,rev]);return changed},deactivate:async(id,rev,reason)=>{calls.push(['deactivate',id,rev,reason]);return {...changed,status:'inactive'}},issueDeleteVerification:async()=>({ticket,expiresAt:1}),deleteModel:async()=>true}
  const state={items:[],page:1,pageSize:20,total:0,detail:null,missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state})
  await store.create({model_key:'m'});await store.update('123',{expected_revision:1});await store.activate('123',2);await store.deactivate('123',3,'retired')
  assert.deepEqual(calls,[['create',{model_key:'m'}],['update','123',{expected_revision:1}],['activate','123',2],['deactivate','123',3,'retired']]);assert.equal(JSON.stringify(state).includes('ticket'),false)
})
