<template><section class="editor"><label :for="id">{{ label }}</label><textarea :id="id" :value="modelValue" :aria-describedby="`${id}-help`" @input="$emit('update:modelValue',$event.target.value)"/><p :id="`${id}-help`">{{ help }}</p><div class="preview" aria-live="polite" v-html="preview" /></section></template>
<script setup>
import { computed } from 'vue'
import { renderSafePublicMarkdown } from '@/utils/public-content-validation.js'
const props=defineProps({modelValue:{type:String,required:true},label:{type:String,required:true},help:{type:String,default:''},id:{type:String,required:true}})
defineEmits(['update:modelValue'])
const preview=computed(()=>renderSafePublicMarkdown(props.modelValue))
</script>
<style scoped>.editor{display:grid;gap:8px}.editor textarea{min-height:16rem;resize:vertical;font:14px/1.6 ui-monospace,monospace;border:1px solid var(--el-border-color);border-radius:8px;padding:12px;background:var(--el-bg-color);color:var(--el-text-color-primary)}.editor textarea:focus-visible{outline:3px solid var(--el-color-primary-light-5)}.preview{border:1px solid var(--el-border-color);padding:16px;border-radius:8px;overflow-wrap:anywhere}.editor p{color:var(--text-secondary);margin:0}</style>
