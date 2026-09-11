<template>
  <aside class="console-sidebar" :aria-label="ariaLabel"><el-menu :default-active="activeRoute" router>
    <template v-for="(groupItems, group) in groupedItems" :key="group">
      <li class="console-sidebar__group" aria-hidden="true">{{ groupLabels[group] || group }}</li>
      <template v-for="item in groupItems" :key="item.to"><slot name="item" :item="item"><el-menu-item :index="item.to" :aria-current="activeRoute === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></el-menu-item></slot></template>
    </template>
  </el-menu></aside>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ items: { type: Array, required: true }, activeRoute: { type: String, required: true }, ariaLabel: { type: String, default: 'Console navigation' } })
const groupLabels = { workspace: 'Workspace', administration: 'Administration', root: 'Root' }
const groupedItems = computed(() => props.items.reduce((groups, item) => { (groups[item.group] ||= []).push(item); return groups }, {}))
</script>
