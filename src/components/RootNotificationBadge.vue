<template><el-badge :value="unreadCount" :hidden="unreadCount===0" :max="99" class="root-notification-badge"><slot /></el-badge></template>
<script setup>
defineProps({unreadCount:{type:Number,required:true}})
</script>
