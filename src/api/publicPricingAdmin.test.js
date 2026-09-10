import test from 'node:test'
import assert from 'node:assert/strict'
import { createIdempotencyKey, createPublicPricingAdminApi, createPublicPricingAdminProductionRequest, createPricingPublicationCoordinator, createPricingValidationCoordinator } from './publicPricingAdmin.js'

const headers={'Cache-Control':'no-store','X-Request-ID':'req-8'}
const ok=(data,status=200)=>({data,status,headers})
const ticket=`av_${'A'.repeat(43)}`, key=`ik_${'B'.repeat(42)}A`
const adminModel={guid:'11',model_key:'m',upstream_model_id:'up/m',display_name:'Model',provider:'P',capabilities:['chat'],context_window:1000,input_price_usd_per_million_tokens:'1.20',output_price_usd_per_million_tokens:null,status:'active',revision:2,last_upstream_check_at:null,public_display_group:'general',endpoint_types:['chat'],public_restrictions:[],price_source:'catalog',price_reviewer:'root',price_effective_at:1720000000000}
const visible={model_key:'m',display_name:'Model',provider:'P',capabilities:['chat'],context_window:1000,input_price_usd_per_million_tokens:'1.20',price_visibility:'visible',release_version:1,pricing_type:'token',public_display_group:'general',endpoint_types:['chat'],public_restrictions:[],price_source:'catalog',price_reviewer:'root',effective_at:'2026-09-10T00:00:00Z',updated_at:'2026-09-10T00:00:00Z'}
const release={guid:'101',version:1,reason:'root_publish',source_revision:2,created_at:'2026-09-10T00:00:00Z'}

test('uses exact draft validation history and immutable release routes',async()=>{
 const calls=[];const api=createPublicPricingAdminApi({request:async x=>{calls.push(x);if(x.path==='/admin/v2/public-pricing/draft')return ok(x.method==='GET'?{revision:2,models:[adminModel],currency:'USD',unit:'million_tokens'}:{revision:3,models:[adminModel],currency:'USD',unit:'million_tokens'});if(x.path.endsWith('/validate'))return ok({valid:false,issues:[{field:'models[0].price_source',code:'required'}]});if(x.path.startsWith('/admin/v2/public-pricing/releases?'))return ok({items:[release],page:1,page_size:20,total:1});return ok({release,items:[visible]})}})
 assert.equal((await api.getDraft()).currency,'USD');await api.saveDraft(2,[adminModel]);assert.deepEqual(await api.validate(2),{valid:false,issues:[{field:'models[0].price_source',code:'required'}]});await api.listReleases({page:1,pageSize:20});const detail=await api.getRelease('101');assert.equal(detail.items[0].outputPriceUsdPerMillionTokens,null)
 assert.deepEqual(calls.map(x=>[x.method,x.path,x.body]),[['GET','/admin/v2/public-pricing/draft',undefined],['PUT','/admin/v2/public-pricing/draft',{expected_revision:2,models:[adminModel]}],['POST','/admin/v2/public-pricing/validate',{expected_revision:2}],['GET','/admin/v2/public-pricing/releases?page=1&page_size=20',undefined],['GET','/admin/v2/public-pricing/releases/101',undefined]])
})

test('production adapter preserves exact HTTP methods and action headers',async()=>{
 const calls=[],adapter=createPublicPricingAdminProductionRequest({get:async(...x)=>{calls.push(['get',...x]);return ok({})},mutation:async x=>{calls.push(['mutation',x]);return ok({})},actionPost:async(...x)=>{calls.push(['action',...x]);return ok({})}})
 const signal=new AbortController().signal;await adapter({method:'GET',path:'/g',signal});await adapter({method:'PUT',path:'/draft',body:{a:1},signal});await adapter({method:'POST',path:'/publish',body:{b:2},headers:{'Idempotency-Key':key,'X-Action-Ticket':ticket},signal})
 assert.equal(calls[0][0],'get');assert.deepEqual(calls[1],["mutation",{method:'PUT',path:'/draft',body:{a:1},signal}]);assert.equal(calls[2][0],'action');assert.equal(calls[2][1],'/publish');assert.deepEqual(calls[2][3].headers,{'Idempotency-Key':key,'X-Action-Ticket':ticket})
})

test('publish and restore keep ticket/key in headers and password only in verification body',async()=>{
 const calls=[];const api=createPublicPricingAdminApi({request:async x=>{calls.push(x);if(x.path==='/admin/v2/action-verifications')return ok({ticket,expires_at:1720000000000},201);return ok({...release,reason:x.path.endsWith('/restore')?'restore':'root_publish'},201)}})
 await api.issuePublishVerification(2,'secret');await api.publish(2,{ticket,idempotencyKey:key});await api.issueRestoreVerification('101',2,'secret');await api.restore('101',2,{ticket,idempotencyKey:key})
 assert.deepEqual(calls.map(x=>[x.path,x.body,x.headers]),[
  ['/admin/v2/action-verifications',{action:'public_pricing.publish',intent:{expected_revision:2},current_password:'secret'},undefined],
  ['/admin/v2/public-pricing/publish',{expected_revision:2},{'Idempotency-Key':key,'X-Action-Ticket':ticket}],
  ['/admin/v2/action-verifications',{action:'public_pricing.restore',intent:{release_guid:'101',expected_revision:2},current_password:'secret'},undefined],
  ['/admin/v2/public-pricing/releases/101/restore',{expected_revision:2},{'Idempotency-Key':key,'X-Action-Ticket':ticket}],
 ])
})

test('coordinator single-submits and retains key only for ambiguous retry',async()=>{
 let executeCalls=0,finish;const api={issuePublishVerification:async()=>({ticket,expiresAt:1}),publish:async(_r,o)=>{executeCalls++;assert.equal(o.idempotencyKey,key);if(executeCalls===1)throw Object.assign(new Error(),{code:'network_error'});return release}}
 const state={draft:{revision:2},history:[]};const c=createPricingPublicationCoordinator({api,state,generateKey:()=>key})
 const input={currentPassword:'secret'};const first=c.publish(input),duplicate=c.publish(input);assert.equal(first,duplicate);assert.equal(input.currentPassword,null);assert.equal(await first,null);assert.equal(state.pendingRecovery,true);assert.equal(JSON.stringify(state).includes('secret'),false);assert.equal(JSON.stringify(state).includes(ticket),false)
 const retry={currentPassword:'again'};assert.deepEqual(await c.publish(retry),release);assert.equal(retry.currentPassword,null);assert.equal(executeCalls,2);assert.equal(state.pendingRecovery,false);assert.equal(state.idempotencyKey,undefined)
})

test('known failure clears logical attempt while 409 exposes refresh comparison',async()=>{
 const keys=[key,`ik_${'C'.repeat(42)}A`];let n=0;const api={issuePublishVerification:async()=>({ticket,expiresAt:1}),publish:async()=>{throw Object.assign(new Error(),{code:'revision_conflict',requestId:'req-conflict'})}}
 const state={draft:{revision:2},history:[]};const c=createPricingPublicationCoordinator({api,state,generateKey:()=>keys[n++]});await c.publish({currentPassword:'x'});assert.equal(state.pendingRecovery,false);assert.deepEqual(state.error,{code:'revision_conflict',requestId:'req-conflict'});assert.equal(state.conflict,true);await c.publish({currentPassword:'x'});assert.equal(n,2)
})

test('validated 503 clears the key while network ambiguity retains it',async()=>{
 let keys=0,mode='unavailable';const api={issuePublishVerification:async()=>({ticket,expiresAt:1}),publish:async()=>{throw Object.assign(new Error(),{code:mode})}},state={draft:{revision:2},history:[]};const c=createPricingPublicationCoordinator({api,state,generateKey:()=>{keys++;return key}})
 await c.publish({currentPassword:'x'});assert.equal(state.pendingRecovery,false);await c.publish({currentPassword:'x'});assert.equal(keys,2);mode='network_error';await c.publish({currentPassword:'x'});assert.equal(state.pendingRecovery,true);await c.publish({currentPassword:'x'});assert.equal(keys,3)
})

test('verification network failure is known before dispatch for publish and restore',async()=>{
 for(const kind of ['publish','restore']){let keys=0,executes=0;const api={issuePublishVerification:async()=>{throw Object.assign(new Error(),{code:'network_error'})},issueRestoreVerification:async()=>{throw Object.assign(new Error(),{code:'network_error'})},publish:async()=>{executes++},restore:async()=>{executes++}},state={draft:{revision:2}};const c=createPricingPublicationCoordinator({api,state,generateKey:()=>{keys++;return key}});await(kind==='publish'?c.publish({currentPassword:'x'}):c.restore('101',{currentPassword:'x'}));assert.equal(state.pendingRecovery,false);assert.equal(state.error.code,'action_dependency_unavailable');await(kind==='publish'?c.publish({currentPassword:'x'}):c.restore('101',{currentPassword:'x'}));assert.equal(keys,2);assert.equal(executes,0)}
})

test('ambiguous retry is bound to its original revision and rejects drift',async()=>{
 const api={issuePublishVerification:async()=>({ticket,expiresAt:1}),publish:async()=>{throw Object.assign(new Error(),{code:'network_error'})}},state={draft:{revision:2},history:[]};const c=createPricingPublicationCoordinator({api,state,generateKey:()=>key});await c.publish({currentPassword:'x'});state.draft={revision:3};assert.equal(await c.publish({currentPassword:'x'}),null);assert.equal(state.pendingRecovery,false);assert.equal(state.reconcileRequired,true);assert.equal(state.error.code,'revision_conflict')
})

test('route/demotion cancellation owns late ticket and never starts publish',async()=>{
 let resolveTicket,publishes=0;const api={issuePublishVerification:(_r,_p,o)=>new Promise(resolve=>{resolveTicket=resolve;assert.equal(o.signal.aborted,false)}),publish:async()=>{publishes++}}
 const state={draft:{revision:2},history:[]};const c=createPricingPublicationCoordinator({api,state,generateKey:()=>key});const pending=c.publish({currentPassword:'secret'});await Promise.resolve();c.cancel();resolveTicket({ticket,expiresAt:1});assert.equal(await pending,null);assert.equal(publishes,0);assert.equal(state.busy,false)
})

test('idempotency keys use exactly 32 random bytes and random failure settles safely',async()=>{
 let length=0;const generated=createIdempotencyKey({getRandomValues(bytes){length=bytes.length;bytes.fill(0);return bytes}});assert.equal(length,32);assert.match(generated,/^ik_[A-Za-z0-9_-]{43}$/)
 const state={draft:{revision:2},history:[]};const c=createPricingPublicationCoordinator({api:{},state,generateKey:()=>{throw new Error('no random')}});const input={currentPassword:'secret'};assert.equal(await c.publish(input),null);assert.equal(input.currentPassword,null);assert.equal(state.busy,false);assert.deepEqual(state.error,{code:'request_failed',requestId:null})
})

test('an ambiguous operation cannot lend its idempotency key to another action',async()=>{
 const api={issuePublishVerification:async()=>({ticket,expiresAt:1}),publish:async()=>{throw Object.assign(new Error(),{code:'network_error'})},issueRestoreVerification:async()=>{throw new Error('must not run')}};const state={draft:{revision:2},history:[]};const c=createPricingPublicationCoordinator({api,state,generateKey:()=>key});await c.publish({currentPassword:'secret'});assert.equal(state.pendingOperation,'publish');assert.equal(await c.restore('101',{currentPassword:'other'}),null);assert.equal(state.pendingOperation,'publish')
})

test('validation belongs to one exact draft revision and ignores stale completion',async()=>{
 const pending=new Map(),state={};const coordinator=createPricingValidationCoordinator({state,api:{validate:revision=>new Promise(resolve=>pending.set(revision,resolve))}});coordinator.setRevision(2);const old=coordinator.validate();coordinator.setRevision(3);const current=coordinator.validate();pending.get(2)({valid:true,issues:[]});assert.equal(await old,null);assert.equal(coordinator.isCurrent(3),false);pending.get(3)({valid:true,issues:[]});assert.equal((await current).validatedRevision,3);assert.equal(coordinator.isCurrent(3),true);coordinator.setRevision(4);assert.equal(coordinator.isCurrent(4),false);assert.equal(state.result,null)
})

test('rejects unsafe DTOs, unknown fields, raw errors and forbidden rollback inputs',async()=>{
 for(const bad of [{...release,rollback:true},{...release,reason:'manual'},{...release,created_at:'local time'}]){const api=createPublicPricingAdminApi({request:async()=>ok({items:[bad],page:1,page_size:20,total:1})});await assert.rejects(api.listReleases(),/invalid_public_pricing_admin_response/)}
 const api=createPublicPricingAdminApi({request:async()=>{throw {response:{status:409,data:{error:{code:'conflict',message:'secret raw',request_id:'req-8'}},headers}}}});await assert.rejects(api.publish(2,{ticket,idempotencyKey:key}),e=>e.code==='revision_conflict'&&e.requestId==='req-8'&&!e.message.includes('secret'))
 await assert.rejects(Promise.resolve().then(()=>api.restore('101',2,{ticket,idempotencyKey:key,rollbackSchema:true})),/invalid_public_pricing_admin_request/)
})

test('visible snapshot timestamps require real UTC calendar instants',async()=>{
 for(const field of ['updated_at','effective_at'])for(const value of ['2026-13-10T00:00:00Z','2026-02-30T00:00:00Z','2026-09-10T25:00:00Z']){const bad={...visible,[field]:value};const api=createPublicPricingAdminApi({request:async()=>ok({release,items:[bad]})});await assert.rejects(api.getRelease('101'),/invalid_public_pricing_admin_response/)}
})

test('action verification maps only the exact admin-action envelope with request ID',async()=>{
 const actionHeaders={'Cache-Control':'no-store','X-Request-ID':'req-action'}
 for(const [status,code] of [[403,'action_verification_rejected'],[409,'action_verification_conflict'],[422,'action_inactive']]){const api=createPublicPricingAdminApi({request:async()=>{throw{response:{status,headers:actionHeaders,data:{error:{code,message:'请求无法完成',type:'admin_action_error',request_id:'req-action'}}}}}});await assert.rejects(api.issuePublishVerification(2,'wrong'),e=>e.code===code&&e.requestId==='req-action')}
 const unsafe=createPublicPricingAdminApi({request:async()=>{throw{response:{status:403,headers:actionHeaders,data:{error:{code:'action_verification_rejected',message:'raw secret',type:'admin_action_error',request_id:'req-action'}}}}}});await assert.rejects(unsafe.issuePublishVerification(2,'wrong'),e=>e.code==='request_failed'&&!e.message.includes('secret'))
})
