<script setup>
defineProps({ label: { type: String, required: true } })
</script>

<template>
  <aside class="hero-preview" :aria-label="label">
    <div class="hero-preview__chrome" aria-hidden="true">
      <i /><i /><i />
    </div>
    <div class="capability-preview" aria-hidden="true">
      <span class="capability-preview__rail" />
      <div class="capability-preview__canvas">
        <span class="capability-preview__line capability-preview__line--short" />
        <span class="capability-preview__line" />
        <div class="capability-preview__cards"><i /><i /><i /></div>
        <span class="capability-preview__line capability-preview__line--medium" />
      </div>
    </div>
  </aside>
</template>
