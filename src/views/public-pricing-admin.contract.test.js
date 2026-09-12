import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8')
test('pricing publication page is Root-only, explicit and accessible',()=>{
 const router=read('../router/index.js'),layout=read('../layouts/MainLayout.vue'),view=read('./PublicPricingAdmin.vue')
 assert.match(router,/\/admin\/public-pricing[\s\S]*rootOnly:\s*true/);assert.match(layout,/\/admin\/public-pricing/)
 for(const token of ['PricingDiff','PublicationChecks','PriceSnapshotHistory','current-password','aria-live','requestId','pendingRecovery','expectedRevision'])assert.ok(view.includes(token),token)
 assert.doesNotMatch(view,/localStorage|sessionStorage|rollbackSchema|restoreDeleted/)
})
test('diff, checks and history preserve pricing publication semantics',()=>{
 const diff=read('../components/public-admin/PricingDiff.vue')+read('../components/public-admin/pricing-diff.js'),checks=read('../components/public-admin/PublicationChecks.vue'),history=read('../components/public-admin/PriceSnapshotHistory.vue')
 assert.match(diff,/inputPriceUsdPerMillionTokens/);assert.match(diff,/outputPriceUsdPerMillionTokens/);assert.match(diff,/priceVisibility|price_visibility/)
 assert.match(checks,/issue\.field/);assert.match(checks,/issue\.code/);assert.match(checks,/role="alert"/)
 assert.match(history,/upstream_safety/);assert.match(history,/systemGenerated/);assert.match(history,/restore/);assert.doesNotMatch(history,/delete|rollback/)
 for(const token of ['load-more','aria-live','total','loading'])assert.ok(history.includes(token),token)
})
test('pricing administration uses shared page, surface, status, table and responsive dialog primitives',()=>{
 const view=read('./PublicPricingAdmin.vue'),diff=read('../components/public-admin/PricingDiff.vue'),checks=read('../components/public-admin/PublicationChecks.vue'),history=read('../components/public-admin/PriceSnapshotHistory.vue')
 for(const token of ['console-page','page-header','surface-card','status-badge','responsive-table','responsive-dialog'])assert.match(view,new RegExp(token),token)
 for(const source of [diff,checks,history])assert.match(source,/surface-card/)
 assert.match(diff,/responsive-table/);assert.match(history,/pagination-bar/)
})
