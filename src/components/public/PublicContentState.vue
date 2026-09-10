<script setup>
defineProps({ status: { type: String, required: true }, message: { type: String, default: '' } })
defineEmits(['retry'])
</script>
<template>
  <div v-if="status === 'loading'" class="public-state" role="status" aria-live="polite"><span class="public-state__spinner" aria-hidden="true" />正在加载已发布内容…</div>
  <div v-else-if="status === 'preparing' || status === 'idle'" class="public-state" role="status"><h2>内容准备中</h2><p>该页面尚无可展示的已发布内容。</p></div>
  <div v-else-if="status === 'empty' || status === 'ready-empty'" class="public-state" role="status"><h2>暂无内容</h2><p>当前发布版本没有可展示内容。</p></div>
  <div v-else-if="status === 'error' || status === 'not_found' || status === 'gone'" class="public-state" role="alert"><h2>暂时无法显示内容</h2><p>{{ message || '请稍后重试。' }}</p><button class="public-button" type="button" @click="$emit('retry')">重试</button></div>
</template>
