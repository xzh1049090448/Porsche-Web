<template><router-link to="/" class="app-brand" :aria-label="title"><img src="/logo.png" alt="" class="app-brand__icon" /><span class="app-brand__copy"><strong>{{ title }}</strong><small v-if="subtitle">{{ subtitle }}</small></span></router-link></template>
<script setup>
defineProps({ title: { type: String, required: true }, subtitle: { type: String, default: '' } })
</script>
