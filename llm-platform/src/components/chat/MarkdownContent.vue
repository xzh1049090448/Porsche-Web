<template>
  <div class="markdown-body" v-html="html" />
</template>

<script setup>
import { computed } from 'vue'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps({
  content: { type: String, default: '' },
  streaming: { type: Boolean, default: false },
})

const html = computed(() => renderMarkdown(props.content, { streaming: props.streaming }))
</script>

<style scoped lang="scss">
.markdown-body {
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;

  :deep(p) {
    margin: 0 0 0.75em;

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 1em 0 0.5em;
    font-weight: 600;
    line-height: 1.35;

    &:first-child {
      margin-top: 0;
    }
  }

  :deep(h1) {
    font-size: 1.35em;
  }

  :deep(h2) {
    font-size: 1.2em;
  }

  :deep(h3) {
    font-size: 1.1em;
  }

  :deep(ul),
  :deep(ol) {
    margin: 0.5em 0;
    padding-left: 1.4em;
  }

  :deep(li) {
    margin: 0.25em 0;
  }

  :deep(li > p) {
    margin: 0.25em 0;
  }

  :deep(blockquote) {
    margin: 0.75em 0;
    padding: 0.4em 0.8em;
    border-left: 3px solid var(--accent);
    background: rgba(64, 158, 255, 0.06);
    color: var(--text-secondary);
  }

  :deep(code) {
    padding: 0.15em 0.35em;
    border-radius: 4px;
    font-family: Consolas, Monaco, 'Courier New', monospace;
    font-size: 0.9em;
    background: rgba(0, 0, 0, 0.06);
  }

  :deep(pre) {
    margin: 0.75em 0;
    padding: 12px 14px;
    border-radius: 8px;
    overflow-x: auto;
    background: #1e1e1e;
    color: #d4d4d4;

    code {
      padding: 0;
      background: transparent;
      color: inherit;
      font-size: 13px;
      line-height: 1.5;
    }
  }

  :deep(table) {
    width: 100%;
    margin: 0.75em 0;
    border-collapse: collapse;
    font-size: 13px;
    display: block;
    overflow-x: auto;
  }

  :deep(th),
  :deep(td) {
    padding: 8px 10px;
    border: 1px solid var(--border);
    text-align: left;
  }

  :deep(th) {
    background: #f5f7fa;
    font-weight: 600;
  }

  :deep(tr:nth-child(even) td) {
    background: #fafafa;
  }

  :deep(a) {
    color: var(--accent);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(hr) {
    margin: 1em 0;
    border: none;
    border-top: 1px solid var(--border);
  }

  :deep(img) {
    max-width: 100%;
    border-radius: 6px;
  }

  :deep(strong) {
    font-weight: 600;
  }
}
</style>
