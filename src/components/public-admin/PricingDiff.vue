<template>
  <section class="panel" aria-labelledby="pricing-diff-title">
    <h2 id="pricing-diff-title">{{ t('publicPricingAdmin.diffTitle') }}</h2>
    <p>{{ t('publicPricingAdmin.generationMeta',{draft:draft?.revision??'—',live:live?.release?.version??'—'}) }}</p>
    <article v-for="model in models" :key="model.modelKey" class="model-diff" :class="{changed:model.changed}">
      <h3><code>{{ model.modelKey }}</code></h3>
      <p class="presence">{{ model.presence }}</p>
      <div class="table-wrap"><table><thead><tr><th>{{t('publicPricingAdmin.field')}}</th><th>{{t('publicPricingAdmin.live')}}</th><th>{{t('publicPricingAdmin.draft')}}</th></tr></thead><tbody>
        <tr v-for="field in model.fields" :key="field.key" :class="{changed:field.changed}"><th>{{field.label}}</th><td>{{field.live}}</td><td>{{field.draft}}</td></tr>
      </tbody></table></div>
    </article>
    <p v-if="!models.length">{{t('publicPricingAdmin.empty')}}</p>
  </section>
</template>
<script setup>
import{computed}from'vue';import{useI18n}from'@/composables/useI18n'
const props=defineProps({draft:Object,live:Object}),{t}=useI18n(),MISSING=Symbol('missing')
const definitions=[
 ['displayName','display_name','displayName'],['provider','provider','provider'],['capabilities','capabilities','capabilities'],['contextWindow','context_window','contextWindow'],['status','status',null],['publicDisplayGroup','public_display_group','publicDisplayGroup'],['endpointTypes','endpoint_types','endpointTypes'],['publicRestrictions','public_restrictions','publicRestrictions'],['inputPriceUsdPerMillionTokens','input_price_usd_per_million_tokens','inputPriceUsdPerMillionTokens'],['outputPriceUsdPerMillionTokens','output_price_usd_per_million_tokens','outputPriceUsdPerMillionTokens'],['priceSource','price_source','priceSource'],['priceReviewer','price_reviewer','priceReviewer'],['priceEffectiveAt','price_effective_at','effectiveAt'],['lastUpstreamCheckAt','last_upstream_check_at',null],['priceVisibility',null,'priceVisibility'],['releaseVersion',null,'releaseVersion'],['snapshotUpdatedAt',null,'updatedAt']]
const canonical=value=>Array.isArray(value)?[...value].sort().join(', '):value===null?'null':String(value)
const display=value=>value===MISSING?t('publicPricingAdmin.missing'):Array.isArray(value)?([...value].sort().join(', ')||t('publicPricingAdmin.none')):value===null?t('publicModelsAdmin.notSet'):String(value)
const models=computed(()=>{const drafts=new Map((props.draft?.models??[]).map(x=>[x.model_key,x])),lives=new Map((props.live?.items??[]).map(x=>[x.modelKey,x]));return[...new Set([...drafts.keys(),...lives.keys()])].sort().map(modelKey=>{const draft=drafts.get(modelKey),live=lives.get(modelKey),fields=definitions.map(([key,dk,lk])=>{const dv=draft&&dk?draft[dk]:MISSING,lv=live&&lk?live[lk]:MISSING;return{key,label:t(`publicPricingAdmin.fields.${key}`),draft:display(dv),live:display(lv),changed:canonical(dv)!==canonical(lv)}});const presence=!live?t('publicPricingAdmin.added'):!draft?t('publicPricingAdmin.removed'):draft.status==='inactive'?t('publicPricingAdmin.inactivated'):t('publicPricingAdmin.present');return{modelKey,presence,fields,changed:fields.some(x=>x.changed)}})})
</script>
<style scoped>.panel{background:var(--el-bg-color);border:1px solid var(--el-border-color);border-radius:16px;padding:20px}.model-diff{border-top:1px solid var(--el-border-color);padding-top:14px;margin-top:14px}.model-diff.changed>h3{color:var(--el-color-warning)}.presence{color:var(--text-secondary)}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:650px}th,td{text-align:left;padding:9px;border-bottom:1px solid var(--el-border-color)}tr.changed{background:var(--el-color-warning-light-9)}code{font-family:ui-monospace,monospace}</style>
