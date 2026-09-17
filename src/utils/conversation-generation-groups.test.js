import test from 'node:test'
import assert from 'node:assert/strict'
import { projectConversationGenerationGroups } from './conversation-generation-groups.js'

const GENERATION_A = '01234567-89ab-4cde-8f01-23456789abcd'
const GENERATION_B = '11234567-89ab-4cde-8f01-23456789abcd'

const rawCompareMessages = () => [
  { guid: '101', role: 'user', content: 'compare', model: null, tokens: 0, createdAt: 10 },
  { guid: '102', role: 'assistant', content: 'A', model: 'model-a', tokens: 2, createdAt: 20 },
  { guid: '103', role: 'assistant', content: 'B', model: 'model-b', tokens: 3, createdAt: 21 },
  { guid: '104', role: 'assistant', content: 'C', model: 'model-c', tokens: 5, createdAt: 22 },
]

const completed = (model, assistantMessageGuid, tokens) => ({
  model,
  status: 'completed',
  assistant_message_guid: assistantMessageGuid,
  tokens,
  error_code: null,
})

const failed = (model, errorCode = 'timeout') => ({
  model,
  status: 'failed',
  assistant_message_guid: null,
  tokens: 0,
  error_code: errorCode,
})

const group = (overrides = {}) => ({
  generation_id: GENERATION_A,
  mode: 'compare',
  user_message_guid: '101',
  results: [completed('model-a', '102', 2), completed('model-b', '103', 3)],
  ...overrides,
})

function assertRejected(rawMessages, generationGroup) {
  const original = structuredClone(rawMessages)
  const projection = projectConversationGenerationGroups(rawMessages, [generationGroup])
  assert.deepEqual(projection, { messages: rawMessages })
  assert.strictEqual(projection.messages, rawMessages)
  assert.deepEqual(rawMessages, original)
}

test('projects an all-success compare generation into one aggregate message', () => {
  const rawMessages = rawCompareMessages()
  const projection = projectConversationGenerationGroups(rawMessages, [group()])

  assert.strictEqual(projection.rawMessages, rawMessages)
  assert.deepEqual(projection.messages, [
    rawMessages[0],
    {
      guid: '102',
      role: 'assistant',
      content: null,
      model: null,
      tokens: 5,
      createdAt: 20,
      multiModel: true,
      generationId: GENERATION_A,
      models: ['model-a', 'model-b'],
      replies: { 'model-a': 'A', 'model-b': 'B' },
      contextReplies: { 'model-a': 'A', 'model-b': 'B' },
      modelStates: {
        'model-a': { status: 'completed', code: null },
        'model-b': { status: 'completed', code: null },
      },
      sourceAssistantGuids: ['102', '103'],
    },
    rawMessages[3],
  ])
})

test('preserves requested result order and represents a partial failure without inventing a message', () => {
  const rawMessages = rawCompareMessages()
  const projection = projectConversationGenerationGroups(rawMessages, [group({
    results: [
      completed('model-c', '104', 5),
      failed('model-b', 'upstream_timeout'),
      completed('model-a', '102', 2),
    ],
  })])

  assert.deepEqual(projection.messages, [
    rawMessages[0],
    {
      guid: '104',
      role: 'assistant',
      content: null,
      model: null,
      tokens: 7,
      createdAt: 22,
      multiModel: true,
      generationId: GENERATION_A,
      models: ['model-c', 'model-b', 'model-a'],
      replies: { 'model-c': 'C', 'model-b': '', 'model-a': 'A' },
      contextReplies: { 'model-c': 'C', 'model-a': 'A' },
      modelStates: {
        'model-c': { status: 'completed', code: null },
        'model-b': { status: 'failed', code: 'upstream_timeout' },
        'model-a': { status: 'completed', code: null },
      },
      sourceAssistantGuids: ['104', '102'],
    },
    rawMessages[2],
  ])
  assert.strictEqual(projection.rawMessages, rawMessages)
})

test('returns the original array and no rawMessages field when no group is accepted', () => {
  const rawMessages = rawCompareMessages()
  const projection = projectConversationGenerationGroups(rawMessages, undefined)

  assert.deepEqual(projection, { messages: rawMessages })
  assert.strictEqual(projection.messages, rawMessages)
  assert.equal('rawMessages' in projection, false)
})

test('rejects invalid generation identity, mode, GUID, model, status, and result field combinations', async t => {
  const invalidCases = [
    ['uppercase UUID', group({ generation_id: GENERATION_A.toUpperCase() })],
    ['malformed UUID', group({ generation_id: '0123456789ab4cde8f0123456789abcd' })],
    ['non-string UUID', group({ generation_id: { toString: () => GENERATION_A } })],
    ['wrong mode', group({ mode: 'single' })],
    ['zero user GUID', group({ user_message_guid: '0' })],
    ['leading-zero user GUID', group({ user_message_guid: '0101' })],
    ['overflow user GUID', group({ user_message_guid: '9223372036854775808' })],
    ['one model', group({ results: [completed('model-a', '102', 2)] })],
    ['four models', group({ results: [completed('model-a', '102', 2), completed('model-b', '103', 3), completed('model-c', '104', 5), failed('model-d')] })],
    ['duplicate model', group({ results: [completed('model-a', '102', 2), completed('model-a', '103', 3)] })],
    ['blank model', group({ results: [completed('model-a', '102', 2), failed('   ')] })],
    ['unknown status', group({ results: [completed('model-a', '102', 2), { ...failed('model-b'), status: 'cancelled' }] })],
    ['no completed result', group({ results: [failed('model-a'), failed('model-b')] })],
    ['completed without assistant GUID', group({ results: [{ ...completed('model-a', '102', 2), assistant_message_guid: null }, completed('model-b', '103', 3)] })],
    ['completed with leading-zero assistant GUID', group({ results: [completed('model-a', '0102', 2), completed('model-b', '103', 3)] })],
    ['completed with overflow assistant GUID', group({ results: [completed('model-a', '9223372036854775808', 2), completed('model-b', '103', 3)] })],
    ['completed with error code', group({ results: [{ ...completed('model-a', '102', 2), error_code: 'timeout' }, completed('model-b', '103', 3)] })],
    ['completed with negative tokens', group({ results: [completed('model-a', '102', -1), completed('model-b', '103', 3)] })],
    ['completed with fractional tokens', group({ results: [completed('model-a', '102', 2.5), completed('model-b', '103', 3)] })],
    ['failed with assistant GUID', group({ results: [completed('model-a', '102', 2), { ...failed('model-b'), assistant_message_guid: '103' }] })],
    ['failed with tokens', group({ results: [completed('model-a', '102', 2), { ...failed('model-b'), tokens: 1 }] })],
    ['failed without error code', group({ results: [completed('model-a', '102', 2), failed('model-b', null)] })],
    ['failed with unstable error code', group({ results: [completed('model-a', '102', 2), failed('model-b', 'UPSTREAM-TIMEOUT')] })],
    ['failed with overlong error code', group({ results: [completed('model-a', '102', 2), failed('model-b', `a${'b'.repeat(64)}`)] })],
  ]

  for (const [name, invalidGroup] of invalidCases) {
    await t.test(name, () => assertRejected(rawCompareMessages(), invalidGroup))
  }
})

test('requires unique exact user and assistant message matches with matching model and tokens', async t => {
  const invalidCases = [
    ['user role mismatch', rawCompareMessages().map(message => message.guid === '101' ? { ...message, role: 'assistant' } : message), group()],
    ['assistant role mismatch', rawCompareMessages().map(message => message.guid === '102' ? { ...message, role: 'user' } : message), group()],
    ['assistant model mismatch', rawCompareMessages().map(message => message.guid === '102' ? { ...message, model: 'other' } : message), group()],
    ['assistant tokens mismatch', rawCompareMessages().map(message => message.guid === '102' ? { ...message, tokens: 99 } : message), group()],
    ['duplicate user message GUID', [...rawCompareMessages(), { guid: '101', role: 'user', content: 'duplicate' }], group()],
    ['duplicate assistant message GUID', [...rawCompareMessages(), { guid: '102', role: 'assistant', content: 'duplicate', model: 'model-a', tokens: 2 }], group()],
    ['one assistant claimed twice in a group', rawCompareMessages(), group({ results: [completed('model-a', '102', 2), completed('model-b', '102', 2)] })],
  ]

  for (const [name, rawMessages, invalidGroup] of invalidCases) {
    await t.test(name, () => assertRejected(rawMessages, invalidGroup))
  }
})

test('accepts the first valid group and ignores later groups that reuse its user or assistant', () => {
  const rawMessages = [
    ...rawCompareMessages(),
    { guid: '201', role: 'user', content: 'second', model: null, tokens: 0, createdAt: 30 },
    { guid: '202', role: 'assistant', content: 'D', model: 'model-d', tokens: 7, createdAt: 31 },
  ]
  const first = group()
  const reusedUser = group({
    generation_id: GENERATION_B,
    results: [completed('model-c', '104', 5), completed('model-d', '202', 7)],
  })
  const projection = projectConversationGenerationGroups(rawMessages, [first, reusedUser])

  assert.equal(projection.messages.filter(message => message.multiModel).length, 1)
  assert.equal(projection.messages.find(message => message.multiModel).generationId, GENERATION_A)
  assert.strictEqual(projection.messages.at(-1), rawMessages.at(-1))

  const reusedAssistant = group({
    generation_id: GENERATION_B,
    user_message_guid: '201',
    results: [completed('model-a', '102', 2), completed('model-d', '202', 7)],
  })
  const secondProjection = projectConversationGenerationGroups(rawMessages, [first, reusedAssistant])
  assert.equal(secondProjection.messages.filter(message => message.multiModel).length, 1)
  assert.strictEqual(secondProjection.messages.at(-1), rawMessages.at(-1))
})

test('projects multiple groups at their first source position while preserving every unrelated message', () => {
  const rawMessages = [
    { guid: '101', role: 'user', content: 'first', createdAt: 1 },
    { guid: '102', role: 'assistant', content: 'A', model: 'model-a', tokens: 2, createdAt: 2 },
    { guid: '201', role: 'user', content: 'second', createdAt: 3 },
    { guid: '202', role: 'assistant', content: 'C', model: 'model-c', tokens: 4, createdAt: 4 },
    { guid: '999', role: 'assistant', content: 'unrelated', model: 'solo', tokens: 1, createdAt: 5 },
    { guid: '103', role: 'assistant', content: 'B', model: 'model-b', tokens: 3, createdAt: 6 },
    { guid: '203', role: 'assistant', content: 'D', model: 'model-d', tokens: 5, createdAt: 7 },
  ]
  const groups = [
    group({ results: [completed('model-b', '103', 3), completed('model-a', '102', 2)] }),
    group({
      generation_id: GENERATION_B,
      user_message_guid: '201',
      results: [completed('model-d', '203', 5), completed('model-c', '202', 4)],
    }),
  ]
  const projection = projectConversationGenerationGroups(rawMessages, groups)

  assert.strictEqual(projection.rawMessages, rawMessages)
  assert.deepEqual(projection.messages.map(message => message.guid), ['101', '103', '201', '203', '999'])
  assert.deepEqual(projection.messages.filter(message => message.multiModel).map(message => ({
    generationId: message.generationId,
    models: message.models,
    createdAt: message.createdAt,
    sourceAssistantGuids: message.sourceAssistantGuids,
  })), [
    { generationId: GENERATION_A, models: ['model-b', 'model-a'], createdAt: 6, sourceAssistantGuids: ['103', '102'] },
    { generationId: GENERATION_B, models: ['model-d', 'model-c'], createdAt: 7, sourceAssistantGuids: ['203', '202'] },
  ])
  assert.strictEqual(projection.messages.at(-1), rawMessages[4])
})

test('ignores damaged groups without dropping or cloning any original message', () => {
  const rawMessages = rawCompareMessages()
  const originalRefs = [...rawMessages]
  const projection = projectConversationGenerationGroups(rawMessages, [
    group({ results: [completed('model-a', '102', 999), completed('model-b', '103', 3)] }),
  ])

  assert.strictEqual(projection.messages, rawMessages)
  assert.deepEqual(projection.messages, originalRefs)
  projection.messages.forEach((message, index) => assert.strictEqual(message, originalRefs[index]))
})

test('fails closed to the original array when indexing a raw message throws', () => {
  const throwingMessage = new Proxy({}, {
    get(_target, property) {
      if (property === 'guid') throw new Error('raw-guid-secret')
      return undefined
    },
  })
  const rawMessages = [throwingMessage, ...rawCompareMessages()]

  let projection
  assert.doesNotThrow(() => { projection = projectConversationGenerationGroups(rawMessages, [group()]) })
  assert.deepEqual(projection, { messages: rawMessages })
  assert.strictEqual(projection.messages, rawMessages)
})

test('fails closed when indexing an unrelated raw message role throws', () => {
  const throwingMessage = {
    guid: '999',
    get role() { throw new Error('raw-role-secret') },
  }
  const rawMessages = [throwingMessage, ...rawCompareMessages()]

  let projection
  assert.doesNotThrow(() => { projection = projectConversationGenerationGroups(rawMessages, [group()]) })
  assert.deepEqual(projection, { messages: rawMessages })
  assert.strictEqual(projection.messages, rawMessages)
})

test('rejects only the malformed group when group, result, or assistant getters throw', () => {
  const contentFailure = { guid: '302', role: 'assistant', model: 'model-x', tokens: 7, createdAt: 32 }
  Object.defineProperty(contentFailure, 'content', {
    enumerable: true,
    get() { throw new Error('assistant-content-secret') },
  })
  const rawMessages = [
    ...rawCompareMessages(),
    { guid: '201', role: 'user', content: 'bad result', createdAt: 25 },
    { guid: '202', role: 'assistant', content: 'X', model: 'model-x', tokens: 7, createdAt: 26 },
    { guid: '203', role: 'assistant', content: 'Y', model: 'model-y', tokens: 8, createdAt: 27 },
    { guid: '301', role: 'user', content: 'bad assistant', createdAt: 31 },
    contentFailure,
    { guid: '303', role: 'assistant', content: 'Y2', model: 'model-y', tokens: 8, createdAt: 33 },
  ]
  const throwingGroup = new Proxy({}, {
    get(_target, property) {
      if (property === 'generation_id') throw new Error('group-id-secret')
      return undefined
    },
  })
  const throwingResult = new Proxy(completed('model-x', '202', 7), {
    get(target, property, receiver) {
      if (property === 'model') throw new Error('result-model-secret')
      return Reflect.get(target, property, receiver)
    },
  })
  const badResultGroup = group({
    generation_id: '21234567-89ab-4cde-8f01-23456789abcd',
    user_message_guid: '201',
    results: [throwingResult, completed('model-y', '203', 8)],
  })
  const badContentGroup = group({
    generation_id: '31234567-89ab-4cde-8f01-23456789abcd',
    user_message_guid: '301',
    results: [completed('model-x', '302', 7), completed('model-y', '303', 8)],
  })

  let projection
  assert.doesNotThrow(() => {
    projection = projectConversationGenerationGroups(rawMessages, [throwingGroup, badResultGroup, badContentGroup, group()])
  })
  assert.strictEqual(projection.rawMessages, rawMessages)
  assert.equal(projection.messages.filter(message => message.multiModel).length, 1)
  assert.equal(projection.messages.find(message => message.multiModel).generationId, GENERATION_A)
  assert.ok(projection.messages.includes(contentFailure))
})

test('fails closed without dropping messages when replacement reads a volatile GUID', () => {
  let guidReads = 0
  const volatileMessage = {
    role: 'assistant',
    content: 'unrelated',
    model: 'solo',
    tokens: 1,
    createdAt: 40,
    get guid() {
      guidReads += 1
      if (guidReads === 1) return '999'
      throw new Error('replace-guid-secret')
    },
  }
  const rawMessages = [...rawCompareMessages(), volatileMessage]

  let projection
  assert.doesNotThrow(() => { projection = projectConversationGenerationGroups(rawMessages, [group()]) })
  assert.deepEqual(projection, { messages: rawMessages })
  assert.strictEqual(projection.messages, rawMessages)
})
