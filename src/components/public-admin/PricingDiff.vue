<template>
  <section class="panel" aria-labelledby="pricing-diff-title">
    <h2 id="pricing-diff-title">{{ t('publicPricingAdmin.diffTitle') }}</h2>
    <p>{{ t('publicPricingAdmin.generationMeta',{draft:draft?.revision??'—',live:live?.release?.version??'—'}) }}</p>
    <article v-for="model in models" :key="model.modelKey" class="model-diff" :class="{changed:model.changed}">
      <h3><code>{{ model.modelKey }}</code></h3>
      <p class="presence">{{ model.presence }}</p>
      <dl class="operational">
        <template v-for="item in model.operations" :key="item.key"><dt>{{item.label}}</dt><dd>{{item.value}}</dd></template>
      </dl>
      <div class="table-wrap"><table><thead><tr><th>{{t('publicPricingAdmin.field')}}</th><th>{{t('publicPricingAdmin.live')}}</th><th>{{t('publicPricingAdmin.draft')}}</th></tr></thead><tbody>
        <tr v-for="field in model.fields" :key="field.key" :class="{changed:field.changed}"><th>{{field.label}}</th><td>{{field.live}}</td><td>{{field.draft}}</td></tr>
      </tbody></table></div>
    </article>
    <p v-if="!models.length">{{t('publicPricingAdmin.empty')}}</p>
  </section>
</template>
<script setup>
import{computed}from'vue';import{useI18n}from'@/composables/useI18n';import{buildPricingDiff,pricingBusinessFields}from'./pricing-diff.js'
const props=defineProps({draft:Object,live:Object}),{t}=useI18n(),MISSING=Symbol('missing')
const display=value=>value===MISSING?t('publicPricingAdmin.missing'):Array.isArray(value)?(value.join(', ')||t('publicPricingAdmin.none')):value===null?t('publicModelsAdmin.notSet'):String(value)
const raw=(row,side,field)=>{const model=side==='draft'?row.draftModel:row.liveModel;if(!model)return MISSING;const value=model[field[side]];if(field.instant&&value!=null)return new Date(value).toISOString();return field.array?[...value].sort():value}
const models=computed(()=>buildPricingDiff(props.draft,props.live).map(row=>({...row,presence:t(`publicPricingAdmin.${row.lifecycle}`),fields:pricingBusinessFields.map(field=>({key:field.key,label:t(`publicPricingAdmin.fields.${field.key}`),draft:display(raw(row,'draft',field)),live:display(raw(row,'live',field)),changed:row.draft.included&&row.live.included&&JSON.stringify(row.draft[field.key])!==JSON.stringify(row.live[field.key])})),operations:[['status',row.draftModel?.status],['lastUpstreamCheckAt',row.draftModel?.last_upstream_check_at],['priceVisibility',row.liveModel?.priceVisibility],['releaseVersion',row.liveModel?.releaseVersion],['snapshotUpdatedAt',row.liveModel?.updatedAt]].filter(([,value])=>value!=null).map(([key,value])=>({key,label:t(`publicPricingAdmin.fields.${key}`),value:String(value)}))})))
</script>
<style scoped>.panel{background:var(--el-bg-color);border:1px solid var(--el-border-color);border-radius:16px;padding:20px}.model-diff{border-top:1px solid var(--el-border-color);padding-top:14px;margin-top:14px}.model-diff.changed>h3{color:var(--el-color-warning)}.presence{color:var(--text-secondary)}.operational{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--text-secondary);font-size:.85rem}.operational dt{font-weight:600}.operational dd{margin:0}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:650px}th,td{text-align:left;padding:9px;border-bottom:1px solid var(--el-border-color)}tr.changed{background:var(--el-color-warning-light-9)}code{font-family:ui-monospace,monospace}</style>
