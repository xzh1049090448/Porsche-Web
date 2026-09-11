<template><span class="status-badge" :class="`status-badge--${status}`"><span class="status-badge__dot" aria-hidden="true" /><slot>{{ label || status }}</slot></span></template>
<script setup>
defineProps({ status: { type: String, required: true }, label: { type: String, default: '' } })
</script>
