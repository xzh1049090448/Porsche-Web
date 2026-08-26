import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyConversationGuid,
  removeConversationByGuid,
  upsertConversationByGuid,
} from './conversation-state.js'

const GUID = '903496573054181376'

test('conversation state preserves a Snowflake GUID through create, SSE, refresh, and delete', () => {
  const created = upsertConversationByGuid([], { guid: GUID, title: 'new', messages: [] })
  assert.equal(created[0].guid, GUID)
  assert.equal(typeof created[0].guid, 'string')

  const afterSSE = applyConversationGuid(created[0], GUID)
  assert.equal(afterSSE.guid, GUID)
  assert.equal(typeof afterSSE.guid, 'string')

  const refreshed = upsertConversationByGuid(created, { guid: GUID, title: 'saved', messages: [] })
  assert.equal(refreshed.length, 1)
  assert.equal(refreshed[0].guid, GUID)

  assert.deepEqual(removeConversationByGuid(refreshed, GUID), [])
})

test('conversation state rejects numeric or blank identifiers', () => {
  assert.deepEqual(upsertConversationByGuid([], { guid: 903496573054181376 }), [])
  assert.deepEqual(removeConversationByGuid([{ guid: 'ok' }], '  '), [{ guid: 'ok' }])
  assert.equal(applyConversationGuid({ guid: 'ok' }, 903496573054181376).guid, 'ok')
})
