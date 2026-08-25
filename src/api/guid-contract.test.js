import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { optionalGuid, requiredGuid } from './guid.js'

const api = (file) => readFile(new URL(`./${file}`, import.meta.url), 'utf8')

test('GUID boundary only accepts nonblank strings and preserves Snowflake precision', () => {
  const guid = '903496573054181376'
  assert.equal(optionalGuid(guid), guid)
  assert.equal(optionalGuid(903496573054181376), null)
  assert.equal(optionalGuid(null), null)
  assert.equal(optionalGuid('   '), null)
  assert.equal(requiredGuid(guid), guid)
  assert.throws(() => requiredGuid(903496573054181376), /non-empty GUID string/)
  assert.throws(() => requiredGuid(null), /non-empty GUID string/)
  assert.throws(() => requiredGuid('  '), /non-empty GUID string/)
})

test('platform adapters only send conversation_guid and never retired RAG fields', async () => {
  const source = await api('platform.js')

  assert.match(source, /conversation_guid:\s*optionalGuid\(body\.conversationGuid\)/g)
  assert.doesNotMatch(source, /conversation_id|dataset_enabled|dataset_ids/)
  assert.match(source, /conversationGuid:\s*null/g)
  assert.doesNotMatch(source, /conversationId/)
})

test('GUID resources are URL encoded and analytics use user_guid', async () => {
  const [conversations, billing, tokens, auth, analytics] = await Promise.all([
    api('conversations.js'),
    api('billing.js'),
    api('gatewayTokens.js'),
    api('auth.js'),
    api('modelAnalytics.js'),
  ])

  assert.match(conversations, /encodeURIComponent\(conversationGuid\)/)
  assert.doesNotMatch(conversations, /dataset_enabled|dataset_ids/)
  assert.match(billing, /orders\/\$\{encodeURIComponent\(guid\)\}/)
  assert.match(tokens, /requiredGuid\(guid, 'token GUID'\)/)
  assert.match(auth, /userGuid:\s*optionalGuid\(tokenRes\.user_guid\)/)
  assert.match(analytics, /params\.user_guid/)
  assert.doesNotMatch(analytics, /params\.user_id/)
})

test('mock resources contain GUID fields but no retired dataset state', async () => {
  const source = await api('mock.js')

  assert.match(source, /user_guid/)
  assert.match(source, /guid:/)
  assert.doesNotMatch(source, /datasetCalls|datasetEnabled|datasetIds/)
})
