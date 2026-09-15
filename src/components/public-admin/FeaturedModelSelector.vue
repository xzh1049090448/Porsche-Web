<template>
  <section class="structured-editor" data-editor="featured-models" aria-labelledby="featured-editor-title">
    <header><div><h2 id="featured-editor-title">{{ labels.title }}</h2><p>{{ selected.length }} / {{ MAX_FEATURED }}</p></div></header>
    <label>{{ labels.search }}<input :value="search" type="search" :disabled="busy" @input="$emit('search', $event.target.value)"></label>
    <p class="status" aria-live="polite">{{ searching ? labels.searching : '' }}</p>
    <ul class="model-search-results">
      <li v-for="model in eligibleResults" :key="model.guid">
        <span>{{ model.displayName }} · {{ model.modelKey }}</span>
        <button type="button" :disabled="busy || selected.length >= MAX_FEATURED || selected.includes(model.modelKey)" @click="$emit('save', [...selected, model.modelKey])">{{ labels.add }}</button>
      </li>
    </ul>
    <ol class="editor-items">
      <li v-for="(modelKey, index) in selected" :key="modelKey" class="editor-item">
        <div class="editor-order-actions">
          <button type="button" :aria-label="labels.moveUp" :disabled="busy || index === 0" @click="$emit('move', { modelKey, direction: -1 })">↑</button>
          <button type="button" :aria-label="labels.moveDown" :disabled="busy || index === selected.length - 1" @click="$emit('move', { modelKey, direction: 1 })">↓</button>
        </div>
        <code>{{ modelKey }}</code>
        <button type="button" :disabled="busy" @click="$emit('save', selected.filter(key => key !== modelKey))">{{ labels.remove }}</button>
      </li>
    </ol>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const MAX_FEATURED = 12
const MODEL_KEY = /^[a-z][a-z0-9-]{0,127}$/
const props = defineProps({
  selected: { type: Array, default: () => [] },
  results: { type: Array, default: () => [] },
  search: { type: String, default: '' },
  searching: Boolean,
  busy: Boolean,
  labels: { type: Object, required: true },
})
defineEmits(['search', 'save', 'move'])
const validModelKey = value => typeof value === 'string' && MODEL_KEY.test(value) && !value.endsWith('-') && !value.includes('--')
const eligibleResults = computed(() => props.results.filter(model => model && model.status === 'active' && model.upstreamState === 'present' && model.completeness === 'complete' && validModelKey(model.modelKey) && new Set(props.selected).size === props.selected.length))
</script>
