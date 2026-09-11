import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const contractURL = new URL('../../interface-contract.json', import.meta.url)

const endpointKeys = [
  ['POST', '/api/v1/platform/chat/completions'],
  ['POST', '/api/v1/platform/chat/compare'],
  ['POST', '/api/v1/platform/chat/generations/{generation_id}/cancel'],
  ['GET', '/api/v1/platform/chat/generations/{generation_id}'],
]

const eventSchemas = {
  meta: {
    required: ['schema', 'generation_id', 'conversation_guid', 'models'],
    optional: [],
    fields: {
      schema: 'literal platform-chat-sse.v2',
      generation_id: 'canonical lowercase UUID',
      conversation_guid: 'positive decimal-string',
      models: 'ordered unique model ID array, single has 1 and compare has 2..3',
    },
    additional_fields: 'forbidden',
  },
  delta: {
    required: ['generation_id', 'model', 'seq', 'delta'],
    optional: [],
    fields: {
      generation_id: 'canonical lowercase UUID',
      model: 'requested model ID',
      seq: 'positive JavaScript-safe integer, contiguous per model from 1',
      delta: 'non-empty UTF-8 string',
    },
    additional_fields: 'forbidden',
  },
  model_done: {
    required: ['generation_id', 'model', 'last_seq'],
    optional: [],
    fields: {
      generation_id: 'canonical lowercase UUID',
      model: 'requested model ID',
      last_seq: 'non-negative JavaScript-safe integer equal to the last contiguous seq',
    },
    additional_fields: 'forbidden',
  },
  model_error: {
    required: ['generation_id', 'model', 'code'],
    optional: ['request_id'],
    fields: {
      generation_id: 'canonical lowercase UUID',
      model: 'requested model ID',
      code: 'stable safe code',
      request_id: 'optional sanitized non-empty string',
    },
    additional_fields: 'forbidden',
  },
  done: {
    one_of: ['PlatformChatSSEV2SingleDone', 'PlatformChatSSEV2CompareDone'],
  },
  error: {
    required: ['generation_id', 'code'],
    optional: ['request_id'],
    fields: {
      generation_id: 'canonical lowercase UUID',
      code: 'stable safe code',
      request_id: 'optional sanitized non-empty string',
    },
    additional_fields: 'forbidden',
  },
}

const stableCodes = [
  'gateway_upstream_error',
  'invalid_request',
  'rate_limited',
  'cancelled',
  'timeout',
  'internal_error',
  'upstream_error',
]

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function readContract() {
  return JSON.parse(await readFile(contractURL, 'utf8'))
}

function findEndpoint(contract, method, path) {
  return contract.interfaces.filter(entry => entry.method === method && entry.path === path)
}

test('BE06 inventory exposes exactly four authenticated generation endpoints', async () => {
  const contract = await readContract()
  for (const [method, path] of endpointKeys) {
    const matches = findEndpoint(contract, method, path)
    assert.equal(matches.length, 1, `missing_or_duplicate_endpoint:${method} ${path}`)
    assert.equal(matches[0].authentication, 'Bearer')
  }

  const inventory = contract.interfaces
    .filter(entry => entry.path.startsWith('/api/v1/platform/chat/generations/') || endpointKeys.some(([method, path]) => entry.method === method && entry.path === path))
    .map(entry => [entry.method, entry.path])
  assert.deepEqual(inventory, endpointKeys)
})

test('v2 identity, request, replay, disconnect, recovery, ownership, cache, and duplicate rules are closed', async () => {
  const { platform_chat_sse_v2: v2 } = await readContract()
  assert.ok(v2, 'missing_platform_chat_sse_v2')
  assert.equal(v2.status, 'closed')
  assert.deepEqual(v2.generation_identity, {
    source: 'client',
    format: 'canonical lowercase UUID',
    ownership: 'authenticated owner bound on first claim',
  })
  assert.deepEqual(v2.request.required_control_fields, {
    stream: true,
    stream_version: 'platform-chat-sse.v2',
    generation_id: 'canonical lowercase UUID',
  })
  assert.equal(v2.request.post_replay_policy, 'never_replay_generation_post')
  assert.equal(v2.disconnect_policy, 'reader_disconnect_does_not_cancel_generation')
  assert.equal(v2.recovery_policy, 'poll_owner_bound_generation_get_without_replaying_post')
  assert.deepEqual(v2.owner_isolation, {
    storage_key: 'authenticated owner plus generation_id',
    foreign_get: '404 generation_not_found without data disclosure',
    foreign_cancel: '200 owner-scoped cancelled tombstone without altering another owner generation',
  })
  assert.deepEqual(v2.generation_status_response_headers, { 'Cache-Control': 'no-store' })
  assert.deepEqual(v2.duplicate_generation, {
    status: 409,
    body: 'owner_bound_generation_status_view',
    behavior: 'conflict_never_starts_or_replays_generation',
  })
  assert.deepEqual(v2.legacy_compatibility, {
    protocol: 'legacy_platform_chat_stream',
    compatibility: 'preserved_separately',
    contract_sources: ['sse_events', 'sse_rules'],
    v2_controls_absent: true,
  })
})

test('cancel and GET recovery freeze terminal, pending, ordered compare, and safe error shapes', async () => {
  const { platform_chat_sse_v2: v2 } = await readContract()
  assert.ok(v2, 'missing_platform_chat_sse_v2')
  assert.deepEqual(v2.cancel, {
    terminal: { status: 200, generation_statuses: ['cancelled', 'completed', 'failed'], retry_after: 'absent' },
    pending: { status: 202, generation_statuses: ['cancelling', 'committing'], retry_after: '1' },
  })
  assert.deepEqual(v2.stable_safe_codes, stableCodes)
  assert.deepEqual(v2.generation_get.nonterminal, {
    required: ['generation_id', 'status', 'mode', 'conversation_guid'],
    optional: [],
    status: ['running', 'cancelling', 'committing'],
    mode: ['single', 'compare'],
    conversation_guid: null,
    additional_fields: 'forbidden',
  })
  assert.deepEqual(v2.generation_get.terminal_noncompleted, {
    required: ['generation_id', 'status', 'mode', 'conversation_guid'],
    optional: ['code'],
    status: ['cancelled', 'failed'],
    mode: ['single', 'compare', null],
    conversation_guid: null,
    code: 'required stable safe code only for failed; forbidden for cancelled',
    additional_fields: 'forbidden',
  })
  assert.deepEqual(v2.generation_get.completed_single, {
    required: ['generation_id', 'status', 'mode', 'conversation_guid', 'result', 'total_tokens_used'],
    literals: { status: 'completed', mode: 'single' },
    result_schema: 'PlatformGenerationCompletedResult',
    additional_fields: 'forbidden',
  })
  assert.deepEqual(v2.generation_get.completed_compare, {
    required: ['generation_id', 'status', 'mode', 'conversation_guid', 'results', 'total_tokens_used'],
    literals: { status: 'completed', mode: 'compare' },
    results_schema: 'ordered PlatformGenerationResult array in original requested model order',
    additional_fields: 'forbidden',
  })
})

test('every named v2 SSE event has an exact closed schema', async () => {
  const { platform_chat_sse_v2: v2 } = await readContract()
  assert.ok(v2, 'missing_platform_chat_sse_v2')
  assert.deepEqual(v2.events.order, ['meta', 'delta|model_done|model_error', 'done|error'])
  assert.deepEqual(v2.events.schemas, eventSchemas)
  for (const [name, schema] of Object.entries(v2.events.schemas)) {
    if (name !== 'done') assert.equal(schema.additional_fields, 'forbidden')
  }
  assert.deepEqual(v2.events.named_schemas.PlatformChatSSEV2SingleDone, {
    required: ['generation_id', 'status', 'conversation_guid', 'tokens', 'total_tokens_used'],
    literals: { status: 'completed' },
    additional_fields: 'forbidden',
  })
  assert.deepEqual(v2.events.named_schemas.PlatformChatSSEV2CompareDone, {
    required: ['generation_id', 'status', 'conversation_guid', 'total_tokens_used', 'models'],
    literals: { status: 'completed' },
    models: 'exact requested model keys; each value is completed+tokens or failed+stable safe code',
    additional_fields: 'forbidden',
  })
})

test('BE06 contract additions do not weaken unrelated frozen contracts or legacy SSE', async () => {
  const contract = await readContract()
  const unrelated = contract.interfaces.filter(entry => !entry.path.startsWith('/api/v1/platform/chat'))
  assert.equal(hash(unrelated), '0de5a8611abc2a0c847cad6445044f784ac5cff2dbcc4d769f5d56dd85236dc9')
  assert.equal(hash(contract.public_content_pricing), 'd2cb6cb2f2cf47bee4fc1f6585b5f68145d9bc4c6f0cb39bbe172cd8091f5c36')
  assert.equal(hash(contract.sse_events), '915154b364c1dcfdb9ede6ce0d5bba2f24a3a6648440f64cfb2ffe2e0db55fd3')
  assert.equal(hash(contract.sse_rules), '948ce9031eb7e08afb7a653a24048c7137845f970d31c8fa95db21ced9bb9427')
  assert.equal(hash(contract.definitions), '663e189f8156571d23bd0b82e074b281c6084c4522026de8e38ff9b0ea7041b8')
  assert.equal(hash(contract.errors), 'df9e487a751194f217235b3c3c992a392f1ce4e43f60c69c9a3102a7122163c8')
})
