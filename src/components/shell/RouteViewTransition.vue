<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="route-fade" mode="out-in" @after-enter="restoreFocus">
      <component :is="Component" :key="`${identityKey}:${route.fullPath}`" />
    </Transition>
  </RouterView>
</template>

<script setup>
import { nextTick } from 'vue'
import { RouterView } from 'vue-router'

const { identityKey, focusTarget } = defineProps({
  identityKey: { type: [String, Number], default: '' },
  focusTarget: { type: String, required: true },
})

async function restoreFocus() {
  await nextTick()
  document.querySelector(focusTarget)?.focus({ preventScroll: true })
}
</script>
