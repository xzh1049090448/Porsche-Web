<script setup>
defineProps({ label: { type: String, required: true } })
</script>

<template>
  <aside class="hero-preview" :aria-label="label">
    <div class="hero-preview__visual" aria-hidden="true">
      <div class="hero-preview__chrome"><i /><i /><i /></div>
      <div class="capability-preview">
        <span class="capability-preview__rail" />
        <div class="capability-preview__canvas">
          <span class="capability-preview__line capability-preview__line--short" />
          <span class="capability-preview__line" />
          <div class="capability-preview__cards"><i /><i /><i /></div>
          <span class="capability-preview__line capability-preview__line--medium" />
        </div>
      </div>
      <span class="hero-preview__provider hero-preview__provider--openai">OpenAI</span>
      <span class="hero-preview__provider hero-preview__provider--anthropic">Anthropic</span>
      <span class="hero-preview__provider hero-preview__provider--gemini">Gemini</span>
      <span class="hero-preview__provider hero-preview__provider--deepseek">DeepSeek</span>
    </div>
  </aside>
</template>
