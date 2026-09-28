import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicModelAdminApi, publicModelAdminListResource } from './publicModelAdmin.js'

const headers = {'Cache-Control':'no-store','X-Request-ID':'req-1'}
const ticket = `av_${'A'.repeat(43)}`
const dto = {guid:'123',model_key:'m',upstream_model_id:'up/m',display_name:'M',provider:'P',capabilities:['chat'],context_window:1000,input_price_usd_per_million_tokens:'1.00',output_price_usd_per_million_tokens:null,status:'draft',revision:1,last_upstream_check_at:null,public_display_group:'general',endpoint_types:['chat'],public_restrictions:[],price_source:'catalog',price_reviewer:'root',price_effective_at:1720000000000}
const mappedCurrent={inputPriceUsdPerMillionTokens:'1.00',outputPriceUsdPerMillionTokens:null,priceSource:'catalog',priceReviewer:'root',priceEffectiveAt:1720000000000}
const form={upstreamModelId:'up/m',modelKey:'m',displayName:'M',provider:'P',capabilities:['chat'],contextWindow:'1000',inputPrice:'1.00',outputPrice:'',publicDisplayGroup:'general',endpointTypes:['chat'],publicRestrictions:[],priceSource:'catalog',priceReviewer:'root',priceEffectiveAt:'1720000000000'}
const ok = (data,status=200) => ({data,status,headers})

test('list query is canonical and has no deleted/restore filter', () => {
  assert.equal(publicModelAdminListResource({search:'a b',status:'inactive',upstreamState:'missing',completeness:'incomplete',page:2,pageSize:50}),'/admin/v2/public-models?search=a+b&status=inactive&upstream_state=missing&completeness=incomplete&page=2&page_size=50')
  assert.throws(() => publicModelAdminListResource({status:'deleted'}))
  assert.throws(() => publicModelAdminListResource({includeDeleted:true}))
  for(const completeness of ['all','Complete',' complete ','']) assert.throws(()=>publicModelAdminListResource({completeness}),/invalid_public_model_admin_query/)
  for(const search of [' padded ','bad\nsearch','bad\u200bsearch','x'.repeat(129)]) assert.throws(()=>publicModelAdminListResource({search}),/invalid_public_model_admin_query/)
})
test('CRUD lifecycle missing and sync use exact routes and bodies', async () => {
  const calls=[]; const api=createPublicModelAdminApi({request:async x=>{calls.push(x); if(x.path.endsWith('/missing')) return ok({observed_without_configuration:['up/new'],configured_missing_upstream:[dto]}); if(x.path.endsWith('/sync')) return ok({accepted:true},202); if(x.method==='DELETE') return ok(null,204); if(x.path==='/admin/v2/public-models'&&x.method==='GET') return ok({items:[dto],page:1,page_size:20,total:1}); return ok(dto,x.method==='POST'&&x.path==='/admin/v2/public-models'?201:200)}})
  assert.equal((await api.list()).items[0].inputPriceUsdPerMillionTokens,'1.00')
  await api.create(form,{recentlyObservedIds:new Set(['up/m'])}); await api.update('123',{expectedRevision:1,displayName:'M'},{current:mappedCurrent}); await api.activate('123',1); await api.deactivate('123',2,'retired'); await api.getMissing(); await api.sync(); await api.deleteModel('123',{expectedRevision:3,reason:'retired',ticket})
  assert.deepEqual(calls.map(c=>[c.method,c.path,c.body,c.headers]),[
    ['GET','/admin/v2/public-models',undefined,undefined],['POST','/admin/v2/public-models',{upstream_model_id:'up/m',model_key:'m',display_name:'M',provider:'P',capabilities:['chat'],context_window:1000,input_price_usd_per_million_tokens:'1.00',output_price_usd_per_million_tokens:null,public_display_group:'general',endpoint_types:['chat'],public_restrictions:[],price_source:'catalog',price_reviewer:'root',price_effective_at:1720000000000},undefined],['PATCH','/admin/v2/public-models/123',{expected_revision:1,display_name:'M'},undefined],['POST','/admin/v2/public-models/123/activate',{expected_revision:1},undefined],['POST','/admin/v2/public-models/123/deactivate',{expected_revision:2,reason:'retired'},undefined],['GET','/admin/v2/public-models/missing',undefined,undefined],['POST','/admin/v2/public-models/sync',undefined,undefined],['DELETE','/admin/v2/public-models/123',{expected_revision:3,reason:'retired'},{'X-Action-Ticket':ticket}]
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
  await assert.rejects(conflict.get('123'),e=>e.requestId==='req-1'&&Object.getOwnPropertyDescriptor(e,'requestId').writable===false&&!Object.hasOwn(e,'response'))
})

test('API normalization is unavoidable for create and update bypass attempts', async () => {
  let calls=0;const api=createPublicModelAdminApi({request:async()=>{calls++;return ok(dto,201)}})
  for(const bad of [{...form,perCallPrice:'1'},{...form,currency:'CNY'},{...form,unknown:'x'}]) await assert.rejects(Promise.resolve().then(()=>api.create(bad,{recentlyObservedIds:new Set(['up/m'])})),/invalid_public_model_form/)
  await assert.rejects(Promise.resolve().then(()=>api.create(form,{recentlyObservedIds:new Set()})),/invalid_public_model_form/)
  for(const bad of [{expectedRevision:1,modelKey:'x'},{expectedRevision:1,upstreamModelId:'x'},{expectedRevision:1,unknown:'x'},{expectedRevision:1,priceSource:''}]) await assert.rejects(Promise.resolve().then(()=>api.update('123',bad,{current:mappedCurrent})),/invalid_public_model_form/)
  assert.equal(calls,0)
})

test('store cannot bypass API normalization with raw mutation payloads', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js');let calls=0
  const api=createPublicModelAdminApi({request:async()=>{calls++;return ok(dto,201)}})
  const state={items:[],page:1,pageSize:20,total:0,detail:null,missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state})
  assert.equal(await store.create({...form,unknown:'x'},new Set(['up/m'])),null);assert.equal(state.loading,false);assert.deepEqual(state.error,{code:'request_failed',requestId:null})
  assert.equal(await store.update('123',{expectedRevision:1,upstreamModelId:'changed'},mappedCurrent),null);assert.equal(state.loading,false);assert.deepEqual(state.error,{code:'request_failed',requestId:null})
  assert.equal(calls,0)
})

test('store retains only validated safe error code and correlation request id', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js')
  const state={items:[],page:1,pageSize:20,total:0,detail:null,missing:null,loading:false,error:null}
  const api={list:async()=>{const error=new Error('safe public error');error.code='unavailable';error.requestId='req-safe-42';error.response={data:{secret:'must-not-survive'}};throw error}}
  const store=createPublicModelAdminCoordinator({api,state})
  await store.load()
  assert.deepEqual(state.error,{code:'unavailable',requestId:'req-safe-42'})
  assert.equal(JSON.stringify(state).includes('must-not-survive'),false)
})

test('every synchronous validator settles safely and a later valid load recovers', async () => {
  let calls=0;const api=createPublicModelAdminApi({request:async args=>{calls++;if(args.method==='GET'&&args.path==='/admin/v2/public-models')return ok({items:[],page:1,page_size:20,total:0});return ok(dto)}})
  const state={items:[],page:1,pageSize:20,total:0,detail:null,missing:null,loading:false,error:null};const store=(await import('../stores/publicModelAdmin.js')).createPublicModelAdminCoordinator({api,state})
  const invalid=[
    ()=>store.load({status:'deleted'}),
    ()=>store.create({...form,unknown:'x'},new Set(['up/m'])),
    ()=>store.update('123',{expectedRevision:1,modelKey:'changed'},mappedCurrent),
    ()=>store.activate('123',0),
    ()=>store.deactivate('123',1,' bad '),
    ()=>store.remove({guid:'123',expectedRevision:1,reason:'retired',currentPassword:''}),
  ]
  for(const run of invalid){assert.equal(await run(),null);assert.equal(state.loading,false);assert.deepEqual(state.error,{code:'request_failed',requestId:null})}
  assert.equal(calls,0);await store.load();assert.equal(calls,1);assert.equal(state.loading,false);assert.deepEqual(state.mutationError,{code:'request_failed',requestId:null})
})

test('frozen delete input does not poison state and verification handoff is scrubbed', async () => {
  let captured;const api={issueDeleteVerification:async value=>{captured=value;return {ticket,expiresAt:1}},deleteModel:async()=>true}
  const state={items:[{guid:'123'}],page:1,pageSize:20,total:1,detail:null,missing:null,loading:false,error:null};const store=(await import('../stores/publicModelAdmin.js')).createPublicModelAdminCoordinator({api,state})
  const input=Object.freeze({guid:'123',expectedRevision:1,reason:'retired',currentPassword:'secret'});assert.equal(await store.remove(input),true)
  assert.equal(captured.currentPassword,null);assert.equal(state.loading,false);assert.equal(state.error,null);assert.equal(JSON.stringify(state).includes('secret'),false)
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

test('strict DTO rejects lone surrogates and incomplete price provenance while accepting unpriced drafts', async () => {
  for(const change of [
    {display_name:'bad\uD800'},{provider:'bad\uDC00'},{upstream_model_id:'org/\uD800'},
    {price_source:'bad\uD800'},{price_reviewer:'bad\uDC00'},
    {price_source:''},{price_reviewer:''},{price_effective_at:null},
  ]){const api=createPublicModelAdminApi({request:async()=>ok({...dto,...change})});await assert.rejects(api.get('123'),/invalid_public_model_admin_response/)}
  const unpriced={...dto,input_price_usd_per_million_tokens:null,output_price_usd_per_million_tokens:null,price_source:'',price_reviewer:'',price_effective_at:null}
  const api=createPublicModelAdminApi({request:async()=>ok(unpriced)});assert.equal((await api.get('123')).inputPriceUsdPerMillionTokens,null)
})

test('store keeps list and missing request ownership independent', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js')
  let resolveList; const state={items:[],page:1,pageSize:20,total:0,detail:null,missing:null,loading:false,error:null}
  const missingError=new Error();missingError.code='unavailable';missingError.requestId='req-missing'
  const api={list:()=>new Promise(r=>{resolveList=r}),getMissing:async()=>{throw missingError}}
  const c=createPublicModelAdminCoordinator({api,state});const list=c.load();await c.loadMissing()
  assert.equal(state.listLoading,true);assert.equal(state.missingLoading,false);assert.deepEqual(state.missingError,{code:'unavailable',requestId:'req-missing'})
  resolveList({items:[dto],page:1,pageSize:20,total:1});await list
  assert.equal(state.listError,null);assert.deepEqual(state.missingError,{code:'unavailable',requestId:'req-missing'});assert.equal(state.items.length,1)
})

test('clearing detail invalidates an older route request before loading the next model', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js')
  const pending=new Map();const api={get:(guid)=>new Promise(resolve=>pending.set(guid,resolve))}
  const state={items:[],page:1,pageSize:20,total:0,detail:null,missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state})
  const a=store.loadDetail('111');store.clearDetail();assert.equal(state.detail,null)
  const b=store.loadDetail('222');pending.get('222')({...dto,guid:'222',modelKey:'b'});await b
  pending.get('111')({...dto,guid:'111',modelKey:'a'});await a
  assert.equal(state.detail.guid,'222');assert.equal(state.detail.modelKey,'b');assert.equal(state.detailLoading,false)
})

test('writes are single-submit and one mutation cannot abort or replace another', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js');let finish,calls=0
  const api={activate:()=>{calls++;return new Promise(r=>{finish=r})}}
  const state={items:[dto],page:1,pageSize:20,total:1,detail:dto,missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state})
  const first=store.activate('123',1),second=store.activate('123',1)
  await Promise.resolve();assert.equal(first,second);assert.equal(calls,1);assert.equal(state.statusSaving,true)
  finish({...dto,status:'active',revision:2});await first;assert.equal(state.statusSaving,false)
})

test('a mutation from route A cannot publish success or failure after context moves to B', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js');let resolveUpdate,rejectStatus
  const api={update:()=>new Promise(resolve=>{resolveUpdate=resolve}),activate:()=>new Promise((_,reject)=>{rejectStatus=reject})}
  const state={items:[{...dto,guid:'222'}],page:1,pageSize:20,total:1,detail:{...dto,guid:'222'},missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state})
  store.setMutationContext('detail:111');const update=store.update('111',{expectedRevision:1},mappedCurrent);await Promise.resolve();store.setMutationContext('detail:222')
  resolveUpdate({...dto,guid:'111',revision:2});assert.equal(await update,null);assert.equal(state.detail.guid,'222');assert.equal(state.modelSaving,false);assert.equal(state.mutationError,null)
  store.setMutationContext('detail:111');const status=store.activate('111',1);await Promise.resolve();store.setMutationContext('detail:222');const error=new Error();error.code='revision_conflict';error.requestId='req-old';rejectStatus(error);assert.equal(await status,null);assert.equal(state.mutationError,null);assert.equal(state.statusSaving,false)
})

test('store exposes create update activate and inactivate without retaining request secrets', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js');const calls=[]
  const changed={...dto,revision:2,status:'active'};const api={list:async()=>{},get:async()=>{},getMissing:async()=>{},sync:async()=>{},create:async(body)=>{calls.push(['create',body]);return dto},update:async(id,body)=>{calls.push(['update',id,body]);return changed},activate:async(id,rev)=>{calls.push(['activate',id,rev]);return changed},deactivate:async(id,rev,reason)=>{calls.push(['deactivate',id,rev,reason]);return {...changed,status:'inactive'}},issueDeleteVerification:async()=>({ticket,expiresAt:1}),deleteModel:async()=>true}
  const state={items:[],page:1,pageSize:20,total:0,detail:null,missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state})
  await store.create(form,new Set(['up/m']));await store.update('123',{expectedRevision:1},mappedCurrent);await store.activate('123',2);await store.deactivate('123',3,'retired')
  assert.deepEqual(calls,[['create',form],['update','123',{expectedRevision:1}],['activate','123',2],['deactivate','123',3,'retired']]);assert.equal(JSON.stringify(state).includes('ticket'),false)
})

test('delete coordinator scrubs caller password before hanging delete phase', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js');let finishDelete,issueObject
  const api={issueDeleteVerification:async value=>{issueObject=value;return {ticket,expiresAt:1}},deleteModel:()=>new Promise(r=>{finishDelete=r})}
  const state={items:[{guid:'123'}],page:1,pageSize:20,total:1,detail:null,missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state});const input={guid:'123',expectedRevision:1,reason:'retired',currentPassword:'secret'}
  const pending=store.remove(input);await new Promise(setImmediate)
  assert.equal(input.currentPassword,null);assert.equal(issueObject.currentPassword,null);assert.equal(JSON.stringify(state).includes('secret'),false)
  issueObject=null;finishDelete(true);await pending;assert.equal(JSON.stringify(state).includes(ticket),false)
})

test('delete ticket resolving after route change or unmount can never start DELETE', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js')
  for (const invalidate of [store=>store.setMutationContext('detail:222'),store=>store.cancel()]) {
    let resolveTicket,deletes=0,signal
    const api={issueDeleteVerification:(_value,options)=>{signal=options.signal;return new Promise(resolve=>{resolveTicket=resolve})},deleteModel:async()=>{deletes++;return true}}
    const state={items:[{guid:'111'}],page:1,pageSize:20,total:1,detail:{guid:'111'},missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state});store.setMutationContext('detail:111')
    const pending=store.remove({guid:'111',expectedRevision:1,reason:'retired',currentPassword:'secret'});await Promise.resolve();invalidate(store);assert.equal(signal.aborted,true)
    resolveTicket({ticket,expiresAt:1});assert.equal(await pending,null);assert.equal(deletes,0)
  }
})

test('every non-delete mutation receives an AbortSignal and suppresses its late result after cancel', async () => {
  const {createPublicModelAdminCoordinator}=await import('../stores/publicModelAdmin.js')
  const cases=[
    ['sync',(store)=>store.sync(),(_args)=>_args[0]],
    ['create',(store)=>store.create(form,new Set(['up/m'])),args=>args[1]],
    ['update',(store)=>store.update('123',{expectedRevision:1},mappedCurrent),args=>args[2]],
    ['activate',(store)=>store.activate('123',1),args=>args[2]],
    ['deactivate',(store)=>store.deactivate('123',1,'retired'),args=>args[3]],
  ]
  for(const [name,start,options] of cases){let resolve,captured;const api={[name]:(...args)=>{captured=options(args);return new Promise(r=>{resolve=r})}};const original={...dto};const state={items:[original],page:1,pageSize:20,total:1,detail:original,missing:null,loading:false,error:null};const store=createPublicModelAdminCoordinator({api,state});store.setMutationContext('test');const pending=start(store);await Promise.resolve();assert.equal(captured.signal instanceof AbortSignal,true,name);store.cancel();assert.equal(captured.signal.aborted,true,name);resolve(name==='sync'?{accepted:true}:{...dto,revision:2});assert.equal(await pending,null,name);assert.equal(state.detail,original,name)}
})

test('admin API forwards the caller signal through every mutation transport', async () => {
  const calls=[],controller=new AbortController(),api=createPublicModelAdminApi({request:async args=>{calls.push(args);if(args.path.endsWith('/sync'))return ok({accepted:true},202);return ok(dto,args.method==='POST'&&args.path==='/admin/v2/public-models'?201:200)}})
  await api.sync({signal:controller.signal});await api.create(form,{recentlyObservedIds:new Set(['up/m']),signal:controller.signal});await api.update('123',{expectedRevision:1},{current:mappedCurrent,signal:controller.signal});await api.activate('123',1,{signal:controller.signal});await api.deactivate('123',1,'retired',{signal:controller.signal})
  assert.equal(calls.length,5);for(const call of calls)assert.equal(call.signal,controller.signal)
})
