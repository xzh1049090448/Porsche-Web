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
const GENERATION_ID = '01234567-89ab-4cde-8f01-23456789abcd'

function compareConversationDetail(overrides = {}) {
  return {
    id: 91,
    guid: '100',
    title: 'Compare models',
    model: 'compare',
    created_at: '2026-09-17T01:02:03.123456789Z',
    updated_at: 1789606924000,
    messages: [
      { id: 1, guid: '101', role: 'user', content: 'Compare this', model: null, tokens: 0, created_at: 1789606924100 },
      { id: 2, guid: '102', role: 'assistant', content: 'Answer A', model: 'model-a', tokens: 2, created_at: 1789606924200 },
      { id: 3, guid: '103', role: 'assistant', content: 'Answer B', model: 'model-b', tokens: 3, created_at: 1789606924300 },
    ],
    generation_groups: [{
      id: 92,
      receipt_id: 93,
      generation_id: GENERATION_ID,
      mode: 'compare',
      user_message_guid: '101',
      results: [
        { id: 94, receipt_id: 93, model: 'model-a', status: 'completed', assistant_message_guid: '102', tokens: 2, error_code: null },
        { id: 95, receipt_id: 93, model: 'model-b', status: 'completed', assistant_message_guid: '103', tokens: 3, error_code: null },
      ],
    }],
    ...overrides,
  }
}

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

test('profile timestamps accept RFC3339Nano and milliseconds, and reject invalid times', () => {
  assert.equal(mapUserProfile({ created_at: '2026-09-02T01:02:03.123456789Z' }).createdAt, Date.parse('2026-09-02T01:02:03.123Z'))
  assert.equal(mapUserProfile({ created_at: 1750000000000 }).createdAt, 1750000000000)
  assert.equal(mapUserProfile({ created_at: 'invalid' }).createdAt, null)
})

test('conversation mapper exposes grouped display messages and raw recovery messages', () => {
  const conversation = mapConversation(compareConversationDetail())

  assert.deepEqual({
    guid: conversation.guid,
    title: conversation.title,
    model: conversation.model,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  }, {
    guid: '100',
    title: 'Compare models',
    model: 'compare',
    createdAt: Date.parse('2026-09-17T01:02:03.123Z'),
    updatedAt: 1789606924000,
  })
  assert.deepEqual(conversation.messages, [
    conversation.rawMessages[0],
    {
      guid: '102',
      role: 'assistant',
      content: null,
      model: null,
      tokens: 5,
      createdAt: 1789606924200,
      multiModel: true,
      generationId: GENERATION_ID,
      models: ['model-a', 'model-b'],
      replies: { 'model-a': 'Answer A', 'model-b': 'Answer B' },
      contextReplies: { 'model-a': 'Answer A', 'model-b': 'Answer B' },
      modelStates: {
        'model-a': { status: 'completed', code: null },
        'model-b': { status: 'completed', code: null },
      },
      sourceAssistantGuids: ['102', '103'],
    },
  ])
  assert.deepEqual(conversation.rawMessages.map(message => message.guid), ['101', '102', '103'])
  assert.deepEqual(conversation.rawMessages.map(message => message.content), ['Compare this', 'Answer A', 'Answer B'])
  assert.strictEqual(conversation.messages[0], conversation.rawMessages[0])
  assert.equal(JSON.stringify(conversation).includes('receipt_id'), false)
  assert.equal(JSON.stringify(conversation).includes('"id"'), false)
})

test('conversation mapper preserves backend result order for a partial compare failure', () => {
  const detail = compareConversationDetail()
  detail.generation_groups[0].results = [
    { model: 'model-b', status: 'completed', assistant_message_guid: '103', tokens: 3, error_code: null },
    { model: 'model-c', status: 'failed', assistant_message_guid: null, tokens: 0, error_code: 'upstream_timeout' },
    { model: 'model-a', status: 'completed', assistant_message_guid: '102', tokens: 2, error_code: null },
  ]

  const conversation = mapConversation(detail)

  assert.deepEqual(conversation.messages.map(message => message.guid), ['101', '103'])
  assert.deepEqual(conversation.messages[1].models, ['model-b', 'model-c', 'model-a'])
  assert.deepEqual(conversation.messages[1].replies, {
    'model-b': 'Answer B',
    'model-c': '',
    'model-a': 'Answer A',
  })
  assert.deepEqual(conversation.messages[1].contextReplies, {
    'model-b': 'Answer B',
    'model-a': 'Answer A',
  })
  assert.deepEqual(conversation.messages[1].modelStates, {
    'model-b': { status: 'completed', code: null },
    'model-c': { status: 'failed', code: 'upstream_timeout' },
    'model-a': { status: 'completed', code: null },
  })
  assert.strictEqual(conversation.rawMessages[1].content, 'Answer A')
  assert.strictEqual(conversation.rawMessages[2].content, 'Answer B')
})

test('conversation mapper keeps its established shape when grouping metadata is absent or rejected', async t => {
  const cases = [
    ['absent', detail => { delete detail.generation_groups }],
    ['empty', detail => { detail.generation_groups = [] }],
    ['null', detail => { detail.generation_groups = null }],
    ['malformed', detail => { detail.generation_groups = { results: [] } }],
    ['invalid group', detail => { detail.generation_groups[0].results[0].tokens = 999 }],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const detail = compareConversationDetail()
      mutate(detail)
      const conversation = mapConversation(detail)

      assert.equal('rawMessages' in conversation, false)
      assert.deepEqual(conversation.messages.map(message => message.guid), ['101', '102', '103'])
      assert.equal(conversation.messages.some(message => message.multiModel), false)
    })
  }
})

test('conversation mapper preserves legacy multi-model marker decoding', () => {
  const legacy = mapConversation(compareConversationDetail({
    messages: [{
      guid: '201',
      role: 'assistant',
      content: '__MULTI_MODEL__{"legacy-a":"A","legacy-b":"B"}',
      model: null,
      tokens: 4,
      created_at: 1789606924400,
    }],
    generation_groups: undefined,
  }))

  assert.equal('rawMessages' in legacy, false)
  assert.deepEqual(legacy.messages[0], {
    guid: '201',
    role: 'assistant',
    content: '__MULTI_MODEL__{"legacy-a":"A","legacy-b":"B"}',
    model: null,
    tokens: 4,
    createdAt: 1789606924400,
    multiModel: true,
    models: ['legacy-a', 'legacy-b'],
    replies: { 'legacy-a': 'A', 'legacy-b': 'B' },
  })
})

test('conversation mapper fails closed when generation_groups access throws', () => {
  const detail = compareConversationDetail()
  Object.defineProperty(detail, 'generation_groups', {
    get() { throw new Error('generation-group-secret') },
  })

  let conversation
  assert.doesNotThrow(() => { conversation = mapConversation(detail) })
  assert.equal('rawMessages' in conversation, false)
  assert.deepEqual(conversation.messages.map(message => message.guid), ['101', '102', '103'])
})
