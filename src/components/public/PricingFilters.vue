<script setup>
import { reactive, watch } from 'vue'
import { usePublicI18n } from '@/i18n/public-runtime.js'
const props = defineProps({ query: { type: Object, required: true }, providers: { type: Array, default: () => [] }, capabilities: { type: Array, default: () => [] }, endpoints: { type: Array, default: () => [] }, groups: { type: Array, default: () => [] }, priceSortDisabled: Boolean })
const emit = defineEmits(['change', 'search'])
const { t } = usePublicI18n()
const form = reactive({ ...props.query })
watch(() => props.query, value => Object.assign(form, value), { deep: true })
function change(key, value) { form[key] = value; emit(key === 'search' ? 'search' : 'change', { ...form, page: 1 }) }
</script>
<template><form class="pricing-filters" :aria-label="t('pricingCatalog.filter')" @submit.prevent>
  <label>{{ t('pricingCatalog.search') }}<input name="search" type="search" :value="form.search" :placeholder="t('pricingCatalog.searchHint')" @input="change('search',$event.target.value)" /></label>
  <label>{{ t('pricingCatalog.provider') }}<select name="provider" :value="form.provider" @change="change('provider',$event.target.value)"><option value="">{{ t('pricingCatalog.allProviders') }}</option><option v-for="item in providers" :key="item" :value="item">{{ item }}</option></select></label>
  <label>{{ t('pricingCatalog.capability') }}<select name="capability" :value="form.capability" @change="change('capability',$event.target.value)"><option value="">{{ t('pricingCatalog.allCapabilities') }}</option><option v-for="item in capabilities" :key="item" :value="item">{{ item }}</option></select></label>
  <label>{{ t('pricingCatalog.endpoint') }}<select name="endpoint" :value="form.endpoint" @change="change('endpoint',$event.target.value)"><option value="">{{ t('pricingCatalog.allEndpoints') }}</option><option v-for="item in endpoints" :key="item" :value="item">{{ item }}</option></select></label>
  <label>{{ t('pricingCatalog.displayGroup') }}<select name="group" :value="form.group" @change="change('group',$event.target.value)"><option value="">{{ t('pricingCatalog.allGroups') }}</option><option v-for="item in groups" :key="item" :value="item">{{ item }}</option></select></label>
  <label>{{ t('pricingCatalog.sort') }}<select name="sort" :value="form.sort" @change="change('sort',$event.target.value)"><option value="default">{{ t('pricingCatalog.defaultSort') }}</option><option value="name">{{ t('pricingCatalog.modelName') }}</option><option value="input" :disabled="priceSortDisabled">{{ t('pricingCatalog.inputPrice') }}</option><option value="output" :disabled="priceSortDisabled">{{ t('pricingCatalog.outputPrice') }}</option></select></label>
  <label>{{ t('pricingCatalog.order') }}<select name="direction" :value="form.direction" @change="change('direction',$event.target.value)"><option value="asc">{{ t('pricingCatalog.ascending') }}</option><option value="desc">{{ t('pricingCatalog.descending') }}</option></select></label>
</form></template>
<style scoped>.pricing-filters{display:grid;gap:18px}.pricing-filters label{display:grid;gap:7px;color:var(--public-muted);font-size:14px;font-weight:700}.pricing-filters input,.pricing-filters select{width:100%;min-height:44px;padding:0 12px;border:1px solid var(--public-border);border-radius:8px;background:var(--public-card);color:var(--public-text)}.pricing-filters :focus-visible{outline:3px solid color-mix(in srgb,var(--public-primary) 35%,transparent);outline-offset:2px}</style>
