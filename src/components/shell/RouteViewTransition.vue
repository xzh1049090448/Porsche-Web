<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="route-fade" mode="out-in" @after-enter="restoreFocus">
      <component
        v-if="keyMode === 'fullPath'"
        :is="Component"
        :key="`${identityKey}:${route.fullPath}`"
      />
      <component v-else :is="Component" />
    </Transition>
  </RouterView>
</template>

<script setup>
import { nextTick } from 'vue'
import { RouterView } from 'vue-router'

const { identityKey, focusTarget, keyMode } = defineProps({
  identityKey: { type: [String, Number], default: '' },
  focusTarget: { type: String, required: true },
  keyMode: {
    type: String,
    default: 'fullPath',
    validator: value => ['fullPath', 'component'].includes(value),
  },
})

async function restoreFocus() {
  await nextTick()
  document.querySelector(focusTarget)?.focus({ preventScroll: true })
}
</script>
