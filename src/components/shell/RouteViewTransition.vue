<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="route-fade" mode="out-in" @after-enter="restoreFocus">
      <component
        v-if="keyMode === 'fullPath'"
        :is="Component"
        :key="`${identityKey}:${route.fullPath}`"
      />
      <component
        v-else-if="keyMode === 'pathQuery'"
        :is="Component"
        :key="`${identityKey}:${route.fullPath.split('#')[0]}`"
      />
      <component v-else :is="Component" />
    </Transition>
  </RouterView>
</template>

<script setup>
import { nextTick, onBeforeUnmount, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

const { identityKey, focusTarget, keyMode } = defineProps({
  identityKey: { type: [String, Number], default: '' },
  focusTarget: { type: String, required: true },
  keyMode: {
    type: String,
    default: 'fullPath',
    validator: value => ['fullPath', 'pathQuery', 'component'].includes(value),
  },
})

const route = useRoute()
let hashFocusTimer = null
let removeScrollEndListener = null
let hashFocusOwner = 0

function cancelHashFocus() {
  if (hashFocusTimer !== null) {
    clearTimeout(hashFocusTimer)
    hashFocusTimer = null
  }
  removeScrollEndListener?.()
  removeScrollEndListener = null
}

function resolveHashHeading(hash) {
  if (!hash || typeof document === 'undefined') return null
  let id
  try {
    id = decodeURIComponent(hash.slice(1))
  } catch {
    return null
  }
  const anchor = document.getElementById(id)
  if (!anchor) return null
  if (anchor.matches('h1, h2, h3, h4, h5, h6, [role="heading"]')) return anchor
  return anchor.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')
}

async function focusHashHeading(hash, owner) {
  await nextTick()
  if (owner !== hashFocusOwner || route.hash !== hash || typeof document === 'undefined') return
  const target = resolveHashHeading(hash) || document.querySelector(focusTarget)
  if (!target || target.contains(document.activeElement)) return
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}

async function queueHashFocus(hash) {
  const owner = ++hashFocusOwner
  cancelHashFocus()
  await nextTick()
  if (owner !== hashFocusOwner || route.hash !== hash) return
  const reduced = typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  if (reduced) {
    const timer = setTimeout(() => {
      if (owner !== hashFocusOwner) return
      hashFocusTimer = null
      void focusHashHeading(hash, owner)
    }, 0)
    hashFocusTimer = timer
    return
  }
  const finish = () => {
    if (owner !== hashFocusOwner) return
    cancelHashFocus()
    void focusHashHeading(hash, owner)
  }
  window.addEventListener('scrollend', finish, { once: true })
  removeScrollEndListener = () => window.removeEventListener('scrollend', finish)
  hashFocusTimer = setTimeout(finish, 700)
}

watch(
  () => route.fullPath,
  (fullPath, previousFullPath) => {
    if (keyMode !== 'pathQuery' || fullPath === previousFullPath) return
    if (!route.hash) {
      hashFocusOwner += 1
      cancelHashFocus()
      return
    }
    void queueHashFocus(route.hash)
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  hashFocusOwner += 1
  cancelHashFocus()
})

async function restoreFocus() {
  await nextTick()
  if (keyMode === 'pathQuery' && route.hash) return
  const target = document.querySelector(focusTarget)
  if (!target || target.contains(document.activeElement)) return
  target.focus({ preventScroll: true })
}
</script>
