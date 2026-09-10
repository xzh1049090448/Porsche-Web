import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePublicContentDraft, renderSafePublicMarkdown } from './public-content-validation.js'

const legal='# Terms\n\nVersion: 2026-09\n\nEffective: 2026-09-11\n\nContact: support@example.com\n\n## Scope\nText'
test('accepts reviewed legal documents and exact local model references',()=>{
 const r=validatePublicContentDraft({home:'[Model](/pricing/model-a)',about:'# About',terms:legal,privacy:legal,legalReviewed:true},{modelKeys:['model-a']})
 assert.deepEqual(r.issues,[])
})
test('rejects unsafe urls html events embeds remote images and broken model keys',()=>{
 for(const markdown of ['[x](javascript:alert(1))','<img src=x onerror=alert(1)>','<iframe src="/x">x</iframe>','![x](https://evil.test/x.png)','[x](/pricing/missing)']){
  assert.ok(validatePublicContentDraft({home:markdown,about:'# A',terms:legal,privacy:legal,legalReviewed:true},{modelKeys:['model-a']}).issues.length)
 }
})
test('strict renderer removes executable markup and never fetches remote images',()=>{
 let fetched=false;globalThis.fetch=()=>{fetched=true;throw Error('no')}
 const html=renderSafePublicMarkdown('[ok](/pricing/model-a) <script>alert(1)</script> ![x](https://evil.test/x.png)')
 assert.doesNotMatch(html,/script|evil\.test/i);assert.equal(fetched,false)
})
test('legal review and required metadata are explicit blockers',()=>{
 const r=validatePublicContentDraft({home:'# H',about:'# A',terms:'# T',privacy:'# P',legalReviewed:false},{modelKeys:[]})
 assert.ok(r.issues.some(x=>x.code==='legal_review_required'))
 assert.ok(r.issues.some(x=>x.code==='legal_metadata_required'))
})
