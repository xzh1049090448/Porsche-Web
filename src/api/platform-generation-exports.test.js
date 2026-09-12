import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('chat API exposes authoritative generation recovery and cancellation', async () => {
  const source = await readFile(new URL('./chat.js', import.meta.url), 'utf8')
  for (const name of ['createPlatformGenerationId', 'getPlatformGeneration', 'cancelPlatformGeneration', 'pollPlatformGeneration']) {
    assert.match(source, new RegExp(`\\b${name}\\b`), `missing ${name}`)
  }
})

test('legacy public stream entry points are wired to strict v2 transport', async () => {
  const source = await readFile(new URL('./platform.js', import.meta.url), 'utf8')
  const transport = await readFile(new URL('./platform-generation.js', import.meta.url), 'utf8')
  assert.match(source, /streamPlatformGeneration/)
  assert.match(source, /streamPlatformCompareGeneration/)
  assert.doesNotMatch(source, /readPlatformChatStream|readPlatformCompareStream/)
  assert.match(transport, /stream_version/)
  assert.match(transport, /generation_id/)
})
