# BE06 Cross-Repository Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the local Porsche/Porsche-Web BE06 delivery by freezing `platform-chat-sse.v2`, integrating authoritative generation recovery and cancellation into the real chat UI, and binding both repositories to one reviewed cross-repository snapshot.

**Architecture:** Keep the backend implementation at `Porsche@4680c549bd28f8be57a438061cf9161914c046a0` unchanged unless verification exposes a product defect. Bring the already approved parser/playback/lifecycle tranche from `docs/chat-streaming-prd` onto the frontend branch, then add a strict transport adapter and a Pinia/UI coordinator. A browser disconnect aborts only the reader; the server-owned generation continues under its application context, while the client polls owner-bound GET until an authoritative terminal result is available. POST generation requests are never replayed.

**Tech Stack:** Go 1.22/Gin/Redis/MySQL backend; Vue 3/Pinia/Vite/JavaScript ESM frontend; Node `node:test`; controlled browser acceptance.

**Explicit boundaries:** No push, PR, production migration, deployment, public HTTPS request, real account mutation, or paid upstream call. Those remain separate release authorization. Local disposable fixtures must be loopback-only and exactly cleaned by identity.

---

### Task 1: Integrate the approved v2 foundations and freeze the contract

**Files:**

- Merge from branch: `docs/chat-streaming-prd`
- Modify: `interface-contract.json`
- Create: `src/api/platform-generation-contract.test.js`

- [ ] **Step 1: Integrate the approved foundation history**

Merge `docs/chat-streaming-prd` into `feature/be06-frontend-recovery` with `--no-ff`. The resulting tree must add only the approved PRD, three existing tranche plans/reports, and these tested utilities:

```text
src/utils/grapheme-playback.js
src/utils/grapheme-playback.test.js
src/utils/platform-sse-v2.js
src/utils/platform-sse-v2.test.js
src/utils/chat-generation.js
src/utils/chat-generation.test.js
```

Run the three focused test files before further changes.

- [ ] **Step 2: Write a failing frozen-contract test**

The test must require exact entries for:

```text
POST /api/v1/platform/chat/completions
POST /api/v1/platform/chat/compare
POST /api/v1/platform/chat/generations/{generation_id}/cancel
GET  /api/v1/platform/chat/generations/{generation_id}
```

It must assert authentication, no-store/no-replay rules, `generation_id` canonical UUID ownership, the exact SSE v2 named-event schemas, ordered compare results, `200|202` cancel behavior, `Retry-After`, safe errors, and the completed/nonterminal GET envelopes. Run it and retain RED because the current contract leaves compare in `p1_outline` and has no generation GET/cancel inventory.

- [ ] **Step 3: Freeze the minimal contract**

Update `interface-contract.json` without weakening or rewriting unrelated A03/A05/A06/A08/A14/public-pricing contracts. Use one closed `platform_chat_sse_v2` section and four interface entries. Preserve the rule:

```json
{
  "disconnect_policy": "reader_disconnect_does_not_cancel_generation",
  "recovery_policy": "poll_owner_bound_generation_get_without_replaying_post"
}
```

- [ ] **Step 4: Verify and commit**

Run the contract test, the three foundation test files, `node -e "JSON.parse(require('fs').readFileSync('interface-contract.json','utf8'))"`, and `git diff --check`. Commit only the foundation merge plus the contract/test changes.

### Task 2: Add strict v2 transport and authoritative polling

**Files:**

- Create: `src/api/platform-generation.js`
- Create: `src/api/platform-generation.test.js`
- Modify: `src/api/platform.js`
- Modify: `src/api/chat.js`
- Test: `src/api/platform.test.js` or the nearest existing platform API test

- [ ] **Step 1: Write RED tests for transport identity and no replay**

Require one canonical lower-case UUID generated before the POST. Both single and compare bodies must contain:

```js
{ stream: true, stream_version: 'platform-chat-sse.v2', generation_id: generationId }
```

The parser must be `createPlatformSSEv2Parser`, not the legacy reader. EOF, malformed bytes, missing done, network error, or reader abort must return an indeterminate outcome containing only the generation ID; none may replay the POST or claim completion.

- [ ] **Step 2: Implement strict stream transport**

Expose a caller-supplied `generationId` in `streamPlatformChat` and `comparePlatformChat`. Feed response bytes incrementally into the strict parser and pass only validated events to the lifecycle callback. A local reader abort must stop consumption without calling the cancel endpoint.

- [ ] **Step 3: Write RED tests for GET/cancel envelopes and polling**

Require:

```js
getPlatformGeneration(generationId, { signal })
cancelPlatformGeneration(generationId, { signal })
pollPlatformGeneration(generationId, { signal, schedule })
```

GET may return `running|cancelling|committing|completed|cancelled|failed`. Cancel accepts only 200 terminal or 202 `cancelling|committing` plus bounded `Retry-After`. Poll delays are 250ms, 500ms, 1s, 2s for at most eight polls in the first ten seconds, then 5s. Every response must be closed-schema, owner-safe, no-store, and free of transport bodies/secrets.

- [ ] **Step 4: Implement the adapter and verify**

Use `authenticatedFetch` for all three calls. Only exact GET may use the existing safe refresh behavior; neither stream POST nor cancel POST is replayed. Run focused tests, legacy SSE regression tests, full `npm test` with all explicit backend-contract variables, and commit.

### Task 3: Integrate lifecycle, recovery, cancellation, and grapheme playback into Pinia

**Files:**

- Modify: `src/utils/chat-generation.js`
- Modify: `src/utils/chat-generation.test.js`
- Modify: `src/stores/chat.js`
- Modify: the nearest existing chat store test file, or create `src/stores/chat-generation.test.js`

- [ ] **Step 1: Write RED tests for server-assigned conversation identity**

Allow a new conversation generation to start without a server GUID, bind the first valid meta `conversation_guid` exactly once, and reject later mismatch. Existing conversations must still require an exact matching meta GUID.

- [ ] **Step 2: Write RED store tests for single and compare recovery**

Cover: client UUID before POST; interleaved compare deltas; one failed sibling; strict per-model sequence; visual `draining`; EOF/network interruption followed by GET `running → committing → completed`; completed authoritative suffix playback; prefix mismatch fail-closed; cancelled/failed terminal handling; identity epoch change; and duplicate send suppression while recovery is active.

- [ ] **Step 3: Integrate one generation coordinator per assistant reply**

The store must route validated SSE events into `createChatGeneration`, project lifecycle snapshots into the existing message shape, and update user token totals only from the validated global terminal. On indeterminate transport it must keep the reply recoverable and poll GET. On compare completion it preserves successful siblings and stable failure codes in requested model order.

- [ ] **Step 4: Enforce partial-content persistence boundaries**

Cancelled or failed partial assistant content remains only in the current view. It must not be written to localStorage and must disappear after refresh/conversation reload. Completed authoritative content may be persisted/refreshed from server history. Add an explicit storage regression test before implementation.

- [ ] **Step 5: Verify and commit**

Run lifecycle and store focused tests, then the full explicitly contracted suite. Commit only lifecycle/store/tests.

### Task 4: Wire user-visible stop/recovery states and compare cardinality

**Files:**

- Modify: `src/views/Chat.vue`
- Modify: `src/components/chat/ChatMessageList.vue` and/or the existing message component actually rendering replies
- Modify: `src/components/chat/ModelPanel.vue`
- Modify: `src/i18n/messages.js`
- Test: nearest Chat/ModelPanel component tests, adding a focused file if no suitable owner exists

- [ ] **Step 1: Write RED component tests**

Prove the button calls authoritative cancel instead of only aborting the reader; `waiting|receiving|cancelling|draining|completed|cancelled|failed` have distinct visible states; recovery blocks a second generation; compare requires exactly 2–3 unique models; sibling failures do not hide successful output; and reduced-motion/keyboard behavior remains accessible.

- [ ] **Step 2: Implement minimal UI projection**

Keep protocol logic out of Vue components. Components render store-owned lifecycle state, expose “正在确认结果/重新确认”, freeze playback while cancelling, and restore controls only after an authoritative terminal state. Do not insert error text into model content or render untrusted HTML.

- [ ] **Step 3: Verify and commit**

Run focused component/store tests, full `npm test` with contract variables, `VITE_USE_MOCK=false npm run build`, and `git diff --check`. Commit only UI/i18n/tests.

### Task 5: Cross-repository acceptance, review snapshot, and evidence

**Files:**

- Frontend modify: `feature_list.json`, `progress.md`
- Frontend create: `docs/agents/validation/2026-09-12-be06-cross-repo/manifest.json`
- Backend modify only after all code gates pass: `feature_list.json`, `progress.md`, `docs/superpowers/reports/2026-09-11-platform-compare-stream-v2.md`

- [ ] **Step 1: Reverify backend after the main merge**

Run no-fixture full tests/build/vet and the focused BE06 normal/race selectors. If authorized disposable MySQL/Redis fixtures are available, rerun the eight BE06 integration tests with zero skip; otherwise retain `PASS_LIMITED_SCOPE` and explicitly record the environmental boundary. A failure returns to the backend worker and invalidates reviews.

- [ ] **Step 2: Run frontend full and controlled browser acceptance**

Run all explicit contract variables, full Node tests, production build, and a controlled browser matrix for single/compare incremental display, disconnect→GET recovery, cancellation, sibling failure, scrolling, 375/390 widths, reduced motion, focus, and console/page errors. No production or paid upstream is used.

- [ ] **Step 3: Bind the cross-repository snapshot**

Record exact backend/frontend HEADs, contract version and SHA-256, dirty-state/hash manifest, commands, counts, skips, and environment. Run Spec Review first, Security Review second, Test Verification third against the same snapshot. Any scoped change invalidates all downstream verdicts.

- [ ] **Step 4: Update trackers only to the proven boundary**

Mark BE06 locally complete only if implementation and all local cross-repository gates pass. Keep production migration/deploy/public HTTPS/real upstream as explicit release acceptance, not silently completed. Commit evidence and tracker changes separately; do not push, open a PR, merge, deploy, or clean unrelated resources.
