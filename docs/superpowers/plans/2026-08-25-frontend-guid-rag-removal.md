# Frontend GUID Contract and RAG Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Porsche-Web over to backend GUID resource identifiers and remove the retired RAG/dataset contract.

**Architecture:** API adapters send and URL-encode GUID strings. Platform mappers are the single DTO boundary; Pinia stores consume mapped GUIDs and `conversation_guid` SSE metadata. No frontend fallback preserves legacy internal IDs or dataset fields.

**Tech Stack:** Vue 3, Pinia, Axios, Fetch/SSE, Node built-in test runner, Vite.

---

### Task 1: Define and test the API/mapping boundary

**Files:**
- Modify: `src/utils/platform-mappers.js`
- Modify: `src/utils/sse.js`
- Modify: `src/utils/sse.test.js`
- Create: `src/utils/platform-mappers.test.js`

- [ ] Write failing mapper tests proving `guid` is retained as a string, `id` is absent, Unix-millisecond times map correctly, and no dataset properties appear.
- [ ] Run `node --test src/utils/platform-mappers.test.js`; expect failure because current mappers expose `id` and dataset fields.
- [ ] Map user, conversation, message, and order DTOs from `guid`; remove dataset metrics/attribution; preserve model IDs as strings.
- [ ] Update SSE tests for `conversation_guid` meta/done fields and remove dataset metadata expectations.
- [ ] Run `npm test`; expect all tests pass.
- [ ] Commit `refactor: map frontend resources by guid`.

### Task 2: Cut API adapters to GUID and remove RAG payloads

**Files:**
- Modify: `src/api/platform.js`
- Modify: `src/api/conversations.js`
- Modify: `src/api/billing.js`
- Modify: `src/api/gatewayTokens.js`
- Modify: `src/api/auth.js`
- Modify: `src/api/modelAnalytics.js`
- Modify: `src/api/mock.js`
- Test: `src/utils/platform-mappers.test.js`

- [ ] Write failing payload assertions for platform chat/compare: payload has optional `conversation_guid` and has no `conversation_id`, `dataset_enabled`, or `dataset_ids`.
- [ ] Run the focused test; expect failure against legacy adapters.
- [ ] Encode GUIDs in conversation/order/token paths; send `conversation_guid`; rename returned `conversationId` metadata to `conversationGuid`; remove `user_id` analytics parameters and use `user_guid`.
- [ ] Remove dataset fields and dataset mock state; mock users/auth responses use `user_guid` only.
- [ ] Run `npm test`; expect pass.
- [ ] Commit `refactor: send frontend requests with guids`.

### Task 3: Update stores, views, and user-visible state

**Files:**
- Modify: `src/stores/chat.js`
- Modify: `src/stores/user.js`
- Modify: `src/views/ApiKeys.vue`
- Modify: `src/views/Billing.vue`
- Modify: `src/components/analytics/ModelAnalyticsPanel.vue`
- Modify: `src/utils/conversation-cache.js`
- Modify: `src/components/chat/ChatSidebar.vue`

- [ ] Write a focused store/helper test showing a snowflake-sized GUID remains a string through create, SSE meta, refresh, and delete paths.
- [ ] Run it and observe failure from numeric conversation handling.
- [ ] Replace numeric conversation checks with nonempty GUID string checks; use `conversation_guid` SSE metadata; remove all dataset state from creation/chat/compare/user usage views.
- [ ] Make Token editing/revocation and order payment use GUIDs; change analytics selection/query state to `userGuid` and `user_guid`.
- [ ] Run `npm test` and `npm run build`; expect both pass.
- [ ] Commit `refactor: use guid state throughout frontend`.

### Task 4: Remove RAG documentation and verify delivery

**Files:**
- Modify: `README.md`
- Modify: `feature_list.json`
- Modify: `progress.md`
- Test: all frontend tests

- [ ] Remove current RAG/data set claims and mark this cutover as the sole active completed feature only after evidence exists.
- [ ] Search `rg -n 'dataset_enabled|dataset_ids|datasetEnabled|datasetIds|conversation_id|user_id' src` and retain only explicit legacy-rejection comments/tests, if any.
- [ ] Run `npm test`, `npm run build`, and `git diff --check`; record outcomes in `progress.md` and `feature_list.json`.
- [ ] Commit `docs: record frontend guid cutover verification`.

### Task 5: Security and acceptance gates

**Files:**
- Review: all Task 1–4 files

- [ ] Security review verifies no raw backend error, prompt, token, or internal ID is persisted/displayed; catalog remains dynamic; no `v-html` receives DTO fields.
- [ ] Test engineer reruns `npm test`, `npm run build`, and source scans; tests normal, GUID, removed-field, SSE, and single-model-error paths.
- [ ] Commit only after both reviewers report no Critical/High issue.
