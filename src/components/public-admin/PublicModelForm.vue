<template>
  <el-dialog :model-value="modelValue" :title="mode === 'edit' ? t('publicModelsAdmin.edit') : t('publicModelsAdmin.create')" width="min(760px, 96vw)" :close-on-click-modal="false" @closed="emit('closed')">
    <el-form ref="formRef" :model="form" label-position="top" @submit.prevent="submit">
      <div class="grid">
        <el-form-item :label="t('publicModelsAdmin.upstreamModelId')" required>
          <el-select v-if="mode === 'create'" v-model="form.upstreamModelId" filterable :disabled="busy" @change="seedModelKey"><el-option v-for="id in observedIds" :key="id" :label="id" :value="id" /></el-select>
          <el-input v-else v-model="form.upstreamModelId" disabled />
        </el-form-item>
        <el-form-item :label="t('publicModelsAdmin.modelKey')" required><el-input v-model="form.modelKey" :disabled="mode === 'edit' || busy" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.displayName')" required><el-input v-model="form.displayName" :disabled="busy" maxlength="128" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.provider')" required><el-input v-model="form.provider" :disabled="busy" maxlength="128" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.contextWindow')" required><el-input v-model="form.contextWindow" inputmode="numeric" :disabled="busy" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.publicDisplayGroup')"><el-input v-model="form.publicDisplayGroup" :disabled="busy" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.capabilities')"><el-select v-model="form.capabilities" multiple allow-create filterable :disabled="busy" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.endpointTypes')"><el-select v-model="form.endpointTypes" multiple allow-create filterable :disabled="busy" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.publicRestrictions')"><el-select v-model="form.publicRestrictions" multiple allow-create filterable :disabled="busy" /></el-form-item>
      </div>
      <h3>{{ t('publicModelsAdmin.price') }}</h3>
      <p class="help">{{ t('publicModelsAdmin.priceHelp') }}</p>
      <div class="grid">
        <el-form-item :label="t('publicModelsAdmin.inputPrice')"><el-input v-model="form.inputPrice" inputmode="decimal" :disabled="busy" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.outputPrice')"><el-input v-model="form.outputPrice" inputmode="decimal" :disabled="busy" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.priceSource')"><el-input v-model="form.priceSource" :disabled="busy" maxlength="255" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.priceReviewer')"><el-input v-model="form.priceReviewer" :disabled="busy" maxlength="128" /></el-form-item>
        <el-form-item :label="t('publicModelsAdmin.priceEffectiveAt')"><el-input v-model="form.priceEffectiveAt" inputmode="numeric" :disabled="busy" /></el-form-item>
      </div>
      <el-alert v-if="error" role="alert" type="error" :closable="false" :title="error" />
    </el-form>
    <template #footer><el-button @click="emit('update:modelValue', false)">{{ t('publicModelsAdmin.cancel') }}</el-button><el-button type="primary" :loading="busy" @click="submit">{{ t('publicModelsAdmin.save') }}</el-button></template>
  </el-dialog>
</template>
<script setup>
import { reactive, watch } from 'vue'
import { useI18n } from '@/composables/useI18n'
const props = defineProps({ modelValue:Boolean, mode:{type:String,default:'create'}, model:{type:Object,default:null}, observedIds:{type:Array,default:()=>[]}, initialUpstreamId:{type:String,default:''}, busy:Boolean, error:{type:String,default:''} })
const emit = defineEmits(['update:modelValue','submit','closed'])
const { t } = useI18n()
const empty = () => ({ upstreamModelId:'',modelKey:'',displayName:'',provider:'',capabilities:[],contextWindow:'',inputPrice:'',outputPrice:'',publicDisplayGroup:'',endpointTypes:[],publicRestrictions:[],priceSource:'',priceReviewer:'',priceEffectiveAt:'' })
const form = reactive(empty())
watch(() => [props.modelValue, props.model], () => {
  Object.assign(form, empty())
  if (props.mode === 'create' && props.initialUpstreamId) { form.upstreamModelId = props.initialUpstreamId; seedModelKey(props.initialUpstreamId) }
  if (props.model) Object.assign(form, { upstreamModelId:props.model.upstreamModelId,modelKey:props.model.modelKey,displayName:props.model.displayName,provider:props.model.provider,capabilities:[...props.model.capabilities],contextWindow:String(props.model.contextWindow),inputPrice:props.model.inputPriceUsdPerMillionTokens ?? '',outputPrice:props.model.outputPriceUsdPerMillionTokens ?? '',publicDisplayGroup:props.model.publicDisplayGroup,endpointTypes:[...props.model.endpointTypes],publicRestrictions:[...props.model.publicRestrictions],priceSource:props.model.priceSource,priceReviewer:props.model.priceReviewer,priceEffectiveAt:props.model.priceEffectiveAt == null ? '' : String(props.model.priceEffectiveAt) })
}, { immediate:true })
function seedModelKey(id) { if (!form.modelKey) form.modelKey = id.split('/').at(-1).toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'') }
function submit() { emit('submit', props.mode === 'edit' ? { expectedRevision:props.model.revision,displayName:form.displayName,provider:form.provider,capabilities:[...form.capabilities],contextWindow:form.contextWindow,inputPrice:form.inputPrice,outputPrice:form.outputPrice,publicDisplayGroup:form.publicDisplayGroup,endpointTypes:[...form.endpointTypes],publicRestrictions:[...form.publicRestrictions],priceSource:form.priceSource,priceReviewer:form.priceReviewer,priceEffectiveAt:form.priceEffectiveAt } : { ...form,capabilities:[...form.capabilities],endpointTypes:[...form.endpointTypes],publicRestrictions:[...form.publicRestrictions] }) }
</script>
<style scoped>.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.help{color:var(--text-secondary);margin-top:-8px}@media(max-width:680px){.grid{grid-template-columns:1fr}}</style>
