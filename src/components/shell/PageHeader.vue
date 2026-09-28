<template><header class="page-header"><div class="page-header__copy"><p v-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</p><h1>{{ title }}</h1><p v-if="description" class="page-header__description">{{ description }}</p></div><div v-if="$slots.actions" class="page-header__actions"><slot name="actions" /></div></header></template>
<script setup>
defineProps({ eyebrow: { type: String, default: '' }, title: { type: String, required: true }, description: { type: String, default: '' } })
</script>
