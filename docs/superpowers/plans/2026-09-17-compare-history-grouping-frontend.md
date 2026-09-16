# Compare History Grouping Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct persisted compare-v2 results as one aggregate multi-model reply whenever conversation history is loaded after re-login.

**Architecture:** Validate backend `generation_groups` against the flat message list by exact GUID/model/token identity, then derive a grouped display projection while retaining raw messages for recovery. Keep legacy marker decoding, single-model history, API context behavior, and mock persistence compatible.

**Tech Stack:** Vue 3, Pinia 2, Vite 6, Node test runner, JavaScript, JSON contracts.

---

### Task 1: Deterministic grouping utility

**Files:**
- Create: `src/utils/conversation-generation-groups.js`
- Create: `src/utils/conversation-generation-groups.test.js`

- [ ] **Step 1: Write failing grouping tests**

Cover all-success and partial-failure groups, request-order preservation, invalid UUID/GUID/status combinations, mismatched model/tokens, duplicate assistant ownership, overlapping groups, and exact raw-message preservation when a group is rejected.

```js
test('projects one compare generation into one aggregate message', () => {
  const rawMessages = [
    { guid: '101', role: 'user', content: 'compare' },
    { guid: '102', role: 'assistant', content: 'A', model: 'model-a', tokens: 2, createdAt: 20 },
    { guid: '103', role: 'assistant', content: 'C', model: 'model-c', tokens: 3, createdAt: 21 },
  ]
  const generationGroups = [{
    generation_id: '01234567-89ab-4cde-8f01-23456789abcd',
    mode: 'compare',
    user_message_guid: '101',
    results: [
      { model: 'model-a', status: 'completed', assistant_message_guid: '102', tokens: 2, error_code: null },
      { model: 'model-b', status: 'failed', assistant_message_guid: null, tokens: 0, error_code: 'timeout' },
      { model: 'model-c', status: 'completed', assistant_message_guid: '103', tokens: 3, error_code: null },
    ],
  }]
  const projection = projectConversationGenerationGroups(rawMessages, generationGroups)
  assert.equal(projection.messages.length, 2)
  assert.strictEqual(projection.rawMessages, rawMessages)
  assert.deepEqual(projection.messages[1], {
    guid: '102', role: 'assistant', content: null, model: null, tokens: 5, createdAt: 20,
    multiModel: true,
    generationId: '01234567-89ab-4cde-8f01-23456789abcd',
    models: ['model-a', 'model-b', 'model-c'],
    replies: { 'model-a': 'A', 'model-b': '', 'model-c': 'C' },
    contextReplies: { 'model-a': 'A', 'model-c': 'C' },
    modelStates: {
      'model-a': { status: 'completed', code: null },
      'model-b': { status: 'failed', code: 'timeout' },
      'model-c': { status: 'completed', code: null },
    },
    sourceAssistantGuids: ['102', '103'],
  })
})
```

- [ ] **Step 2: Run the utility test and confirm RED**

Run: `node --test src/utils/conversation-generation-groups.test.js`

Expected: FAIL because the utility module does not exist.

- [ ] **Step 3: Implement exact group validation and projection**

Export one function:

```js
export function projectConversationGenerationGroups(rawMessages, generationGroups) {
  const messages = Array.isArray(rawMessages) ? rawMessages : []
  const groups = Array.isArray(generationGroups) ? generationGroups : []
  const byGuid = indexMessagesByCanonicalGuid(messages)
  const usedUsers = new Set()
  const usedAssistants = new Set()
  const accepted = []
  for (const group of groups) {
    const candidate = validateGenerationGroup(group, byGuid, usedUsers, usedAssistants)
    if (!candidate) continue
    accepted.push(candidate)
    usedUsers.add(candidate.userMessageGuid)
    candidate.sourceAssistantGuids.forEach(guid => usedAssistants.add(guid))
  }
  if (accepted.length === 0) return { messages }
  return { messages: replaceAssistantMessages(messages, accepted), rawMessages: messages }
}
```

The private validators must require canonical lowercase UUIDs, positive decimal GUID strings no larger than signed int64, 2–3 unique models, at least one completed result, stable error codes matching `/^[a-z][a-z0-9_]{0,63}$/`, exact user/assistant roles, exact model/tokens equality, completed/failed nullability, and no GUID reuse. `replaceAssistantMessages` removes only accepted assistant GUIDs and inserts the aggregate at the first removed assistant index.

- [ ] **Step 4: Run utility tests and confirm GREEN**

Run: `node --test src/utils/conversation-generation-groups.test.js`

Expected: PASS for valid, invalid, overlapping, and no-content-loss cases.

- [ ] **Step 5: Commit the grouping utility**

```bash
git add src/utils/conversation-generation-groups.js src/utils/conversation-generation-groups.test.js
git commit -m "feat: reconstruct compare history groups"
```

### Task 2: Conversation API mapping

**Files:**
- Modify: `src/utils/platform-mappers.js`
- Modify: `src/utils/platform-mappers.test.js`

- [ ] **Step 1: Add failing mapper tests**

Add a full raw detail fixture with snake-case `generation_groups`. Assert `messages` contains one aggregate, `rawMessages` retains both assistant messages, backend internal IDs are absent, no-group responses keep the current shape, and legacy `__MULTI_MODEL__` decoding is unchanged.

```js
test('conversation mapper exposes grouped display messages and raw recovery messages', () => {
  const conversation = mapConversation(compareConversationDetailFixture())
  assert.deepEqual(conversation.messages.map(message => message.role), ['user', 'assistant'])
  assert.equal(conversation.messages[1].multiModel, true)
  assert.deepEqual(conversation.rawMessages.map(message => message.guid), ['101', '102', '103'])
  assert.equal(JSON.stringify(conversation).includes('receipt_id'), false)
})
```

- [ ] **Step 2: Run mapper tests and confirm RED**

Run: `node --test src/utils/platform-mappers.test.js src/utils/conversation-generation-groups.test.js`

Expected: FAIL because `mapConversation` ignores `generation_groups`.

- [ ] **Step 3: Integrate the projection utility**

Update `mapConversation` to map raw messages once and pass them to the utility:

```js
export function mapConversation(raw) {
  const rawMessages = (raw.messages || []).map(mapMessage)
  const projection = projectConversationGenerationGroups(rawMessages, raw.generation_groups)
  return {
    guid: mapGuid(raw.guid),
    title: raw.title,
    model: raw.model,
    createdAt: mapUnixMilliseconds(raw.created_at),
    updatedAt: mapUnixMilliseconds(raw.updated_at),
    ...projection,
  }
}
```

Import `projectConversationGenerationGroups` from the new utility. Do not change `mapMessage` or `enrichMessage`.

- [ ] **Step 4: Run mapper tests and confirm GREEN**

Run: `node --test src/utils/platform-mappers.test.js src/utils/conversation-generation-groups.test.js`

Expected: PASS and all pre-existing mapper cases remain unchanged.

- [ ] **Step 5: Commit the mapper integration**

```bash
git add src/utils/platform-mappers.js src/utils/platform-mappers.test.js
git commit -m "feat: map compare generation history"
```

### Task 3: Recovery and local persistence compatibility

**Files:**
- Modify: `src/stores/chat.js`
- Modify: `src/stores/chat.test.js`

- [ ] **Step 1: Write failing store regressions**

Add one history-load regression and one interrupted-generation recovery regression. The first must load a grouped detail after a fresh authenticated store initialization and assert one aggregate assistant. The second must provide terminal compare results whose GUIDs exist only in `rawMessages` and assert recovery commits instead of entering the failed recovery state.

```js
test('re-login history load keeps compare results in one aggregate reply', async () => {
  route = ({ url }) => url === listPath
    ? { items: [summary(A)], total: 1 }
    : compareConversationDetail(A)
  const store = useChatStore()
  await store.fetchConversations()
  await store.ensureActive()
  const conversation = store.getActive()
  assert.deepEqual(conversation.messages.map(message => message.role), ['user', 'assistant'])
  assert.equal(conversation.messages[1].multiModel, true)
  assert.deepEqual(conversation.messages[1].models, ['model-a', 'model-b', 'model-c'])
})
```

Also assert:

```js
const persisted = projectConversationForPersistence(groupedConversation)
assert.equal('rawMessages' in persisted, false)
assert.equal(JSON.stringify(persisted).includes('source-only answer'), false)
```

- [ ] **Step 2: Run store tests and confirm RED**

Run the repository test command with all required backend contract variables and filter the output for the new regression names.

Expected: the grouped history test reaches the mapper result, while raw-message recovery or persistence assertions fail until store changes are made.

- [ ] **Step 3: Preserve raw messages only at runtime**

Change persistence projection to strip `rawMessages` before returning:

```js
export function projectConversationForPersistence(conversation) {
  const { rawMessages: _rawMessages, ...persistentConversation } = conversation
  return {
    ...persistentConversation,
    messages: (conversation.messages || []).filter(isContextMessage).map(projectPersistentMessage),
  }
}
```

Change recovery matching to use the authoritative flat list:

```js
const messages = Array.isArray(conversation.rawMessages)
  ? conversation.rawMessages
  : (conversation.messages || [])
```

Leave UI rendering and subsequent context construction on `conversation.messages`; its aggregate `contextReplies` preserves the current compare context semantics.

- [ ] **Step 4: Run store and mapper tests and confirm GREEN**

Run the full `npm test` command with the six repository-required contract environment variables.

Expected: all tests PASS, including the re-login aggregate and raw GUID recovery regressions, with zero new skips.

- [ ] **Step 5: Commit store compatibility**

```bash
git add src/stores/chat.js src/stores/chat.test.js
git commit -m "fix: preserve compare grouping after re-login"
```

### Task 4: Frontend and shared interface contracts

**Files:**
- Modify: `interface-contract.json`
- Create: `docs/agents/contracts/platform-compare-history-grouping-v1.json`
- Create: `src/utils/conversation-generation-contract.test.js`

- [ ] **Step 1: Write the failing contract test**

Read the local root and versioned JSON files and assert version/status, exact GET/PUT endpoints, `generation_groups` field names, GUID string rules, result order, and completed/failed field combinations. Cross-repository byte identity is verified explicitly in Task 5 after both copies exist.

```js
test('conversation grouping contract is explicit and bound to detail endpoints', () => {
  const shared = JSON.parse(readFileSync(contractPath, 'utf8'))
  assert.equal(shared.version, 'platform-compare-history-grouping.v1')
  assert.equal(shared.status, 'agreed_for_implementation')
  assert.deepEqual(shared.endpoints, [
    'GET /api/v1/conversations/{guid}',
    'PUT /api/v1/conversations/{guid}',
  ])
  assert.deepEqual(shared.generation_group.results_order, 'model_index_ascending')
})
```

- [ ] **Step 2: Run contract test and confirm RED**

Run: `node --test src/utils/conversation-generation-contract.test.js`

Expected: FAIL because the versioned contract does not exist and the root contract still says only “Conversation with messages”.

- [ ] **Step 3: Add and bind the exact contract**

Create canonical JSON with `version` equal to `platform-compare-history-grouping.v1`, `status` equal to `agreed_for_implementation`, endpoints `GET /api/v1/conversations/{guid}` and `PUT /api/v1/conversations/{guid}`, and an explicit `generation_group` schema. The schema must state compare-only groups, `model_index_ascending` result order, positive decimal-string GUIDs, completed/failed nullability, stable error codes, corrupt-group omission, raw-message preservation, and the absence of database IDs. Update the `conversation_detail` and `conversation_title` entries in `interface-contract.json` with the explicit response fields and a `contract_ref` of `docs/agents/contracts/platform-compare-history-grouping-v1.json`. Append a history entry with both approved design commits and mark environment/browser acceptance as pending; do not change the overall status to production accepted.

Use this complete canonical content for the versioned artifact:

```json
{
  "version": "platform-compare-history-grouping.v1",
  "status": "agreed_for_implementation",
  "endpoints": [
    "GET /api/v1/conversations/{guid}",
    "PUT /api/v1/conversations/{guid}"
  ],
  "response_extension": {
    "field": "generation_groups",
    "detail_responses_only": true,
    "list_and_create_unchanged": true,
    "value_when_empty": []
  },
  "generation_group": {
    "mode": "compare",
    "generation_id": "canonical_lowercase_uuid",
    "user_message_guid": "positive_decimal_string_int64",
    "results_order": "model_index_ascending",
    "result_count": { "minimum": 2, "maximum": 3 },
    "models_unique": true,
    "completed": {
      "assistant_message_guid": "positive_decimal_string_int64",
      "tokens": "nonnegative_integer",
      "error_code": null
    },
    "failed": {
      "assistant_message_guid": null,
      "tokens": 0,
      "error_code": "stable_lower_snake_case"
    }
  },
  "integrity": {
    "ownership": "authenticated_user_and_current_conversation",
    "invalid_group": "omit_group_and_preserve_flat_messages",
    "database_error": "fail_detail_request",
    "database_ids_exposed": false
  },
  "compatibility": {
    "old_backend": "frontend_preserves_flat_messages",
    "old_frontend": "ignores_generation_groups",
    "legacy_multi_model_marker": "preserved",
    "database_migration_required": false
  },
  "acceptance": {
    "production": "pending",
    "required": "create_compare_logout_login_reopen_one_aggregate_reply"
  }
}
```

- [ ] **Step 4: Validate JSON and contract tests**

Run:

```bash
python3 -m json.tool interface-contract.json >/dev/null
python3 -m json.tool docs/agents/contracts/platform-compare-history-grouping-v1.json >/dev/null
node --test src/utils/conversation-generation-contract.test.js
git diff --check
```

Expected: both JSON files parse, contract assertions PASS, and diff check is clean.

- [ ] **Step 5: Commit the contract update**

```bash
git add interface-contract.json docs/agents/contracts/platform-compare-history-grouping-v1.json src/utils/conversation-generation-contract.test.js
git commit -m "docs: bind compare history grouping contract"
```

### Task 5: Frontend verification and tracker evidence

**Files:**
- Modify: `feature_list.json`
- Modify: `progress.md`

- [ ] **Step 1: Run focused and full verification**

Run the focused utility/mapper tests, then the full repository test command with all six required backend contract environment variables, followed by:

```bash
VITE_USE_MOCK=false npm run build
git diff --check
python3 -m json.tool interface-contract.json >/dev/null
python3 -m json.tool feature_list.json >/dev/null
cmp docs/agents/contracts/platform-compare-history-grouping-v1.json /Users/xuzhihao/code/Porsche/.worktrees/compare-history-grouping/docs/agents/contracts/platform-compare-history-grouping-v1.json
```

Expected: focused and full tests PASS, production build succeeds with only already-recorded chunk warnings, JSON parses, and diff check is clean.

- [ ] **Step 2: Run local browser acceptance against paired revisions**

Start the frontend against a disposable backend fixture implementing the approved contract. Log in with a dedicated test account, create a three-model comparison with one successful or failed sibling case, log out, log back in, reopen the conversation, and assert one aggregate reply with ordered tabs/cards and no duplicate assistant blocks. Record the frontend revision, backend revision, contract SHA-256, URL, fixture identity, and cleanup result.

- [ ] **Step 3: Record evidence without overstating production status**

Append exact command output, test counts, build result, browser matrix, paired revisions, and remaining public HTTPS/production acceptance to `progress.md`. Add the regression evidence to `web-013` in `feature_list.json`; retain its local-versus-production boundary until deployment and public acceptance are separately authorized.

- [ ] **Step 4: Commit verification evidence**

```bash
git add feature_list.json progress.md
git commit -m "docs: record compare history frontend verification"
```
