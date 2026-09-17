import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT_CONTRACT_PATH = fileURLToPath(new URL('../../interface-contract.json', import.meta.url))
const VERSIONED_CONTRACT_PATH = fileURLToPath(new URL('../../docs/agents/contracts/platform-compare-history-grouping-v1.json', import.meta.url))
const BACKEND_CONTRACT_PATH = '/Users/xuzhihao/code/Porsche/.worktrees/compare-history-grouping/docs/agents/contracts/platform-compare-history-grouping-v1.json'
const CONTRACT_REF = 'docs/agents/contracts/platform-compare-history-grouping-v1.json'
const CONTRACT_HASH = '43d394e794dfd829fc2884c0982ff0aa68aa22f82c357f708ae7dca7ec19420f'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sortedKeys(value) {
  return Object.keys(value).sort()
}

test('frontend compare-history artifact is byte-identical to the reviewed backend contract', () => {
  const frontendBytes = readFileSync(VERSIONED_CONTRACT_PATH)
  const backendBytes = readFileSync(BACKEND_CONTRACT_PATH)

  assert.deepEqual(frontendBytes, backendBytes)
  assert.equal(createHash('sha256').update(frontendBytes).digest('hex'), CONTRACT_HASH)
})

test('versioned contract freezes detail-only endpoints and empty grouping behavior', () => {
  const contract = readJson(VERSIONED_CONTRACT_PATH)

  assert.equal(contract.version, 'platform-compare-history-grouping.v1')
  assert.equal(contract.status, 'agreed_for_implementation')
  assert.deepEqual(contract.endpoints, [
    'GET /api/v1/conversations/{guid}',
    'PUT /api/v1/conversations/{guid}',
  ])
  assert.deepEqual(contract.response_extension, {
    field: 'generation_groups',
    detail_responses_only: true,
    list_and_create_unchanged: true,
    value_when_empty: [],
  })
})

test('versioned contract fixes group identity, ordering, cardinality, and discriminated result shapes', () => {
  const group = readJson(VERSIONED_CONTRACT_PATH).generation_group
  const resultFields = ['assistant_message_guid', 'error_code', 'model', 'status', 'tokens']

  assert.equal(group.mode, 'compare')
  assert.equal(group.generation_id, 'canonical_lowercase_uuid')
  assert.equal(group.user_message_guid, 'positive_decimal_string_int64')
  assert.equal(group.results_order, 'model_index_ascending')
  assert.deepEqual(group.result_count, { minimum: 2, maximum: 3 })
  assert.equal(group.models_unique, true)
  assert.deepEqual(sortedKeys(group.completed), resultFields)
  assert.deepEqual(sortedKeys(group.failed), resultFields)
  assert.deepEqual(group.completed, {
    model: 'nonempty_string',
    status: 'completed',
    assistant_message_guid: 'positive_decimal_string_int64',
    tokens: 'nonnegative_integer',
    error_code: null,
  })
  assert.deepEqual(group.failed, {
    model: 'nonempty_string',
    status: 'failed',
    assistant_message_guid: null,
    tokens: 0,
    error_code: 'stable_lower_snake_case',
  })
})

test('versioned contract keeps integrity and compatibility fail-closed with production acceptance pending', () => {
  const contract = readJson(VERSIONED_CONTRACT_PATH)

  assert.deepEqual(contract.integrity, {
    ownership: 'authenticated_user_and_current_conversation',
    invalid_group: 'omit_group_and_preserve_flat_messages',
    database_error: 'fail_detail_request',
    database_ids_exposed: false,
  })
  assert.deepEqual(contract.compatibility, {
    old_backend: 'frontend_preserves_flat_messages',
    old_frontend: 'ignores_generation_groups',
    legacy_multi_model_marker: 'preserved',
    database_migration_required: false,
  })
  assert.deepEqual(contract.acceptance, {
    production: 'pending',
    required: 'create_compare_logout_login_reopen_one_aggregate_reply',
  })
})

test('root contract binds both detail responses to the explicit generation-group schema', () => {
  const contract = readJson(ROOT_CONTRACT_PATH)
  const byName = new Map(contract.interfaces.map(entry => [entry.name, entry]))
  const expectedBody = {
    guid: 'positive decimal-string',
    title: 'string',
    model: 'string',
    created_at: 'RFC3339Nano UTC string',
    updated_at: 'RFC3339Nano UTC string',
    messages: 'Message[]',
    generation_groups: 'GenerationGroup[]; detail-only; [] when none; see contract_ref',
  }

  for (const [name, method] of [['conversation_detail', 'GET'], ['conversation_title', 'PUT']]) {
    const entry = byName.get(name)
    assert.ok(entry)
    assert.equal(entry.method, method)
    assert.equal(entry.path, '/api/v1/conversations/{guid}')
    assert.equal(entry.contract_ref, CONTRACT_REF)
    assert.equal(entry.response.status, 200)
    assert.deepEqual(entry.response.body, expectedBody)
  }

  assert.deepEqual(byName.get('conversation_list').response.body, {
    items: 'Conversation[] without messages',
    total: 'integer',
  })
  assert.equal(byName.get('conversation_list').contract_ref, undefined)
  assert.equal(byName.get('conversation_create').response.body, 'Conversation without messages')
  assert.equal(byName.get('conversation_create').contract_ref, undefined)
})

test('root history records implementation evidence without claiming environment acceptance', () => {
  const contract = readJson(ROOT_CONTRACT_PATH)
  const records = contract.history.filter(entry => entry.kind === 'compare_history_grouping_contract')

  assert.equal(contract.status, 'agreed_for_implementation')
  assert.equal(records.length, 1)
  assert.deepEqual(records[0], {
    kind: 'compare_history_grouping_contract',
    version: 'platform-compare-history-grouping.v1',
    status: 'agreed_for_implementation',
    contract_ref: CONTRACT_REF,
    backend_design_commit: '65458ec',
    frontend_design_commit: '2ab6b95',
    backend_revision: '1f22cb878ed43ff97b61042919b71f2a096b0646',
    frontend_implementation_revision: 'pending_final_revision',
    environment_browser_acceptance: 'pending',
    production_accepted: false,
  })
})
