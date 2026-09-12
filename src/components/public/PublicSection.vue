<script setup>
defineProps({ id: { type: String, default: undefined }, title: { type: String, required: true }, tone: { type: String, default: 'default' } })
</script>

<template>
  <section :id="id" class="public-content-section" :class="`public-content-section--${tone}`" :aria-labelledby="id ? `${id}-title` : undefined">
    <header class="public-content-section__heading"><h2 :id="id ? `${id}-title` : undefined">{{ title }}</h2><slot name="heading" /></header>
    <slot />
  </section>
</template>
