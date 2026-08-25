import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mapConversation,
  mapMessage,
  mapOrder,
  mapUserProfile,
  mapUsageStats,
} from './platform-mappers.js'

const SNOWFLAKE_GUID = '903496573054181376'

test('platform mappers expose business GUIDs as strings without internal IDs or dataset fields', () => {
  const user = mapUserProfile({
    id: 1,
    guid: SNOWFLAKE_GUID,
    phone: '13800138000',
    nickname: 'Ada',
    is_verified: true,
    plan_type: 2,
    total_tokens_used: 120,
    dataset_calls: 99,
    daily_calls_used: 3,
    daily_call_limit: 10,
    created_at: 1724061600123,
  })
  const conversation = mapConversation({
    id: 2,
    guid: SNOWFLAKE_GUID,
    title: 'A chat',
    model: 'model-a',
    dataset_enabled: true,
    dataset_ids: [1],
    created_at: 1724061600123,
    updated_at: 1724061600456,
  })
  const message = mapMessage({
    id: 3,
    guid: SNOWFLAKE_GUID,
    role: 1,
    content: 'hello',
    model: 'model-a',
    dataset_used: true,
    dataset_attribution: 'legacy data',
    tokens: 10,
    created_at: 1724061600789,
  })
  const order = mapOrder({
    id: 4,
    guid: SNOWFLAKE_GUID,
    order_no: 'ORD-1',
    plan_type: 2,
    amount: 99,
    status: 1,
    invoice_requested: false,
    created_at: 1724061600123,
    paid_at: 1724061600999,
  })

  for (const resource of [user, conversation, message, order]) {
    assert.equal(resource.guid, SNOWFLAKE_GUID)
    assert.equal(typeof resource.guid, 'string')
    assert.equal('id' in resource, false)
    assert.equal('datasetEnabled' in resource, false)
    assert.equal('datasetIds' in resource, false)
    assert.equal('datasetUsed' in resource, false)
    assert.equal('datasetBadge' in resource, false)
    assert.equal('datasetAttribution' in resource, false)
  }

  assert.equal(user.createdAt, 1724061600123)
  assert.equal(conversation.createdAt, 1724061600123)
  assert.equal(conversation.updatedAt, 1724061600456)
  assert.equal(message.createdAt, 1724061600789)
  assert.equal(order.createdAt, 1724061600123)
  assert.equal(order.paidAt, 1724061600999)
})

test('usage mapper omits retired dataset metrics', () => {
  const usage = mapUsageStats({
    total_tokens_used: 42,
    dataset_calls: 10,
    daily_calls_used: 2,
    remaining_daily_calls: 8,
    plan_type: 2,
  })

  assert.deepEqual(usage, {
    totalTokens: 42,
    dailyCallsUsed: 2,
    dailyLimit: undefined,
    remainingQuota: 8,
    plan: 2,
  })
})

test('platform mappers reject numeric, null, and blank GUIDs', () => {
  const invalidGuids = [903496573054181376, null, '', '   ']

  for (const guid of invalidGuids) {
    assert.equal(mapUserProfile({ guid }).guid, null)
    assert.equal(mapConversation({ guid, messages: [] }).guid, null)
    assert.equal(mapMessage({ guid, content: '' }).guid, null)
    assert.equal(mapOrder({ guid }).guid, null)
  }
})
