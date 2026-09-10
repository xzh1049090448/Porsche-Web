import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalContentDraft, contentValidationProofMatches, createContentPublicationCoordinator, createContentValidationProof, createPublicContentAdminApi, hashCanonicalContent } from './publicContentAdmin.js'

const headers = new Headers({'Cache-Control':'no-store','X-Request-ID':'req-1'})
const ok = (data,status=200,extra={})=>({data,status,headers:new Headers({...Object.fromEntries(headers),...extra})})
const draft={revision:2,home:'# Home',about:'# About',terms:'# Terms',privacy:'# Privacy',legal_reviewed:true}

test('content admin uses exact draft, preview and pagination contracts',async()=>{
 const calls=[];const api=createPublicContentAdminApi({request:async x=>{calls.push(x);if(x.path.includes('/preview'))return ok({document:'{"home":"<h1>Home</h1>","about":"","terms":"","privacy":""}',revision:2},200,{'X-Robots-Tag':'noindex, nofollow'});if(x.path.includes('/releases'))return ok({items:[],page:1,page_size:20,total:0});return ok(draft)}})
 assert.deepEqual(await api.getDraft(),{revision:2,home:'# Home',about:'# About',terms:'# Terms',privacy:'# Privacy',legalReviewed:true})
 assert.equal((await api.preview(2)).revision,2)
 assert.equal((await api.listReleases()).pageSize,20)
 assert.equal(calls[1].path,'/admin/v2/public-content/preview?revision=2')
})

test('save sends safe full shape and optimistic revision',async()=>{
 let call;const api=createPublicContentAdminApi({request:async x=>(call=x,ok({...draft,revision:3}))})
 const out=await api.saveDraft({revision:2,home:'# Home',about:'# About',terms:'# Terms',privacy:'# Privacy',legalReviewed:true})
 assert.equal(out.revision,3)
 assert.deepEqual(call.body,{expected_revision:2,home:'# Home',about:'# About',terms:'# Terms',privacy:'# Privacy',legal_reviewed:true})
})

test('validation preserves exact backend issue codes',async()=>{
 const api=createPublicContentAdminApi({request:async()=>ok({valid:false,issues:[{field:'terms',code:'legal_review_required'}]})})
 assert.deepEqual(await api.validate(2),{valid:false,issues:[{field:'terms',code:'legal_review_required'}]})
})

test('publish verification, ticket and idempotency match backend',async()=>{
 const calls=[];const api=createPublicContentAdminApi({request:async x=>{calls.push(x);return x.path.endsWith('action-verifications')?ok({ticket:'av_'+('A'.repeat(42))+'Q',expires_at:10},201):ok({guid:'9',version:3,reason:'root_publish',source_revision:2,created_at:'2026-09-11T00:00:00Z'},201)}})
 const v=await api.issuePublishVerification(2,'Password!9','7')
 await api.publish(2,'7',{ticket:v.ticket,idempotencyKey:'ik_'+('A'.repeat(42))+'Q'})
 assert.equal(calls[0].body.action,'public_content.publish')
 assert.deepEqual(calls[0].body.intent,{price_release_guid:'7',expected_revision:2})
 assert.equal(calls[1].headers['X-Action-Ticket'],v.ticket)
})

test('malformed response is rejected without prototype fallback',async()=>{
 const inherited=Object.create({home:'# forged'});Object.assign(inherited,{revision:2,about:'a',terms:'t',privacy:'p',legal_reviewed:true})
 const api=createPublicContentAdminApi({request:async()=>ok(inherited)})
 await assert.rejects(()=>api.getDraft(),/invalid_public_content_admin_response/)
})

test('canonical validation identity binds exact saved bytes revision and price release',async()=>{
 const value={revision:2,home:'# H',about:'# A',terms:'# T',privacy:'# P',legalReviewed:true}
 assert.equal(canonicalContentDraft(value),'{"revision":2,"home":"# H","about":"# A","terms":"# T","privacy":"# P","legal_reviewed":true}')
 assert.match(await hashCanonicalContent(value),/^[a-f0-9]{64}$/)
 assert.notEqual(await hashCanonicalContent(value),await hashCanonicalContent({...value,home:'# H '}))
 const canonical=canonicalContentDraft(value),proof=await createContentValidationProof(value,'7',{valid:true})
 assert.equal(contentValidationProofMatches(proof,value,canonical,'7',{approved:true,source:'product-signoff-1'}),true)
 assert.equal(contentValidationProofMatches(proof,{...value,home:'# changed'},canonical,'7',{approved:true,source:'product-signoff-1'}),false)
 assert.equal(contentValidationProofMatches(proof,value,canonical,'8',{approved:true,source:'product-signoff-1'}),false)
 assert.equal(contentValidationProofMatches(proof,value,canonical,'7',{approved:false,source:null}),false)
})

test('publication coordinator retains a key only for execute ambiguity and retries exact binding',async()=>{
 const calls=[],api={issuePublishVerification:async()=>({ticket:'ticket'}),publish:async(...a)=>{calls.push(a);throw{code:'network_error'}},issueRestoreVerification:async()=>({ticket:'ticket'}),restore:async()=>({})},state={}
 const c=createContentPublicationCoordinator({api,state,generateKey:()=> 'one-key'})
 await c.publish('7',2,'secret');assert.equal(state.pendingRecovery,true);assert.equal(state.attempt.key,'one-key')
 await c.publish('7',2,'secret2');assert.equal(calls.length,2);assert.equal(calls[1][2].idempotencyKey,'one-key')
 await c.restore('9',2,'secret3');assert.equal(state.attempt,null);assert.equal(state.error.code,'attempt_binding_changed')
})

test('verification network and known execute failures clear attempt while late ticket is cancelled',async()=>{
 let execute=0;const state={},api={issuePublishVerification:async()=>{throw{code:'network_error'}},publish:async()=>{execute++}}
 const c=createContentPublicationCoordinator({api,state,generateKey:()=> 'key'})
 await c.publish('7',2,'secret');assert.equal(execute,0);assert.equal(state.pendingRecovery,false);assert.equal(state.attempt,null);assert.equal(state.error.code,'action_dependency_unavailable')
 let resolve;api.issuePublishVerification=()=>new Promise(r=>resolve=r);const pending=c.publish('7',2,'secret');c.cancel();resolve({ticket:'late'});await pending;assert.equal(execute,0);assert.equal(state.attempt,null)
})
