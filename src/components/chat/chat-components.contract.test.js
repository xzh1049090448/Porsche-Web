import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = name => readFile(new URL(name, import.meta.url), 'utf8')

test('Chat mounts an accessible lifecycle region, resumes pending work, and delegates stop to the store', async () => {
  const source = await read('../../views/Chat.vue')
  const statusSource = await read('./GenerationStatus.vue')
  assert.match(source, /<GenerationStatus\s*\/>/)
  assert.match(statusSource, /aria-live="polite"/)
  assert.match(statusSource, /generationLifecycleStatus/)
  assert.match(statusSource, /chatStore\.cancelStream\(\)/)
  assert.match(source, /chatStore\.resumePendingGeneration\(\)/)
  assert.ok(source.indexOf('loadModels()') < source.indexOf('fetchConversations()'), 'catalog must load before authoritative history')
  assert.ok(source.indexOf('fetchConversations()') < source.indexOf('resumePendingGeneration()'), 'history must load before pending recovery is merged')
  assert.ok(source.indexOf('resumePendingGeneration()') < source.indexOf('ensureActive()'), 'recovery must settle before ensuring a replacement conversation')
  assert.match(source, /bootstrapping/)
  assert.match(source, /:disabled="bootstrapping"/)
  assert.doesNotMatch(statusSource, /AbortController/)
})

test('ChatInput blocks invalid compare selections and duplicate submission while generation is active', async () => {
  const source = await read('./ChatInput.vue')
  assert.match(source, /validateGenerationSelection/)
  assert.match(source, /!chatStore\.streaming/)
  assert.match(source, /selection\.value\.valid/)
  assert.match(source, /props\.disabled/)
})

test('ModelPanel exposes compare validation and enforces the exact two-to-three boundary', async () => {
  const source = await read('./ModelPanel.vue')
  assert.match(source, /aria-invalid/)
  assert.match(source, /compareValidation/)
  assert.match(source, /validateGenerationSelection/)
  assert.match(source, /model\.compareCardinality/)
  assert.match(source, /useChatStore/)
  assert.match(source, /chatStore\.streaming/)
})

test('ChatMessageList renders stable per-model failure and view-only labels outside content', async () => {
  const source = await read('./ChatMessageList.vue')
  assert.match(source, /modelReplyPresentation/)
  assert.match(source, /chat\.viewOnlyPartial/)
  assert.match(source, /reply-error/)
  assert.doesNotMatch(source, /errorPrefix/)
  assert.match(source, /canCopyGenerationMessage/)
  assert.match(source, /retryGenerationAttempt/)
  assert.match(source, /reply-view-only-warning/)
  assert.match(source, /prefers-reduced-motion:\s*reduce/)
})
