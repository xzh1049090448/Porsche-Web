<script setup>
defineProps({ label: { type: String, required: true } })
</script>

<template>
  <aside class="hero-preview" :aria-label="label">
    <div class="hero-preview__visual" aria-hidden="true">
      <div class="hero-preview__chrome"><i /><i /><i /></div>
      <div class="developer-terminal">
        <div class="developer-terminal__title"><span>API / OpenAI compatible</span><span>{{ label }}</span></div>
        <pre><code><span class="code-comment">// Request format</span>
<span class="code-keyword">const</span> client = <span class="code-keyword">new</span> OpenAI({
  apiKey: <span class="code-string">process.env.API_KEY</span>,
  baseURL: <span class="code-string">YOUR_API_BASE</span>
});

<span class="code-keyword">await</span> client.chat.completions.create({
  model: <span class="code-string">YOUR_MODEL_ID</span>,
  messages: [{
    role: <span class="code-string">"user"</span>,
    content: <span class="code-string">"Hello, world."</span>
  }]
});</code></pre>
        <div class="developer-terminal__footer"><span>01 / API KEY</span><span>02 / MODEL</span><span>03 / BUILD</span></div>
      </div>
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
