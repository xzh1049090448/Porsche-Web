# Chat Grapheme Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, resource-safe adaptive playback controller that converts received Unicode text deltas into observable grapheme-by-grapheme display updates without depending on the unconfirmed SSE v2 backend contract.

**Architecture:** Add one framework-independent utility with an injected frame scheduler and clock. It owns received/displayed text, pending graphemes, segmentation carry, playback mode, and cleanup; Vue, network parsing, persistence, and generation status remain outside this tranche.

**Tech Stack:** JavaScript ESM, Node `node:test`, `Intl.Segmenter`, injected `requestAnimationFrame`-style scheduler.

---

### Task 1: Deterministic grapheme playback controller

**Files:**

- Create: `src/utils/grapheme-playback.js`
- Create: `src/utils/grapheme-playback.test.js`

- [ ] **Step 1: Add a failing construction and standard-playback test**

Create a Node test that imports `createGraphemePlayback`, supplies a fake frame scheduler, pushes `"你好世界"`, advances four distinct frames, and asserts the snapshots grow as `"你"`, `"你好"`, `"你好世"`, `"你好世界"`. Assert the import or behavior fails before implementation.

- [ ] **Step 2: Run the focused test and retain RED evidence**

Run: `node --test src/utils/grapheme-playback.test.js`

Expected: non-zero exit caused by the missing module/export or missing playback behavior, not a test syntax error.

- [ ] **Step 3: Implement the minimal public controller**

Export:

```js
export function createGraphemePlayback({
  onDisplay,
  requestFrame,
  cancelFrame,
  now,
  reducedMotion = false,
  targetLagMs = 500,
} = {})
```

Return methods `push(delta)`, `finish()`, `cancel()`, `dispose()`, and `snapshot()`. The snapshot must expose immutable scalar diagnostics including `receivedText`, `displayedText`, `pendingCount`, `mode`, `finished`, and `disposed`. Standard mode schedules at most one grapheme per frame and never mutates text after disposal.

- [ ] **Step 4: Verify the focused test is GREEN**

Run: `node --test src/utils/grapheme-playback.test.js`

Expected: zero exit and all initial tests pass.

- [ ] **Step 5: Add Unicode boundary tests and retain RED evidence**

Add separate tests for combining marks, regional-indicator flags, skin-tone emoji, and ZWJ emoji split across two or more `push()` calls. Assert an incomplete trailing candidate is held until a later delta or `finish()`, and final displayed text is byte-for-byte equal to the concatenated received text without `\uFFFD`.

Run: `node --test src/utils/grapheme-playback.test.js`

Expected: at least one new boundary assertion fails against the minimal implementation.

- [ ] **Step 6: Add incremental grapheme segmentation carry**

Use `Intl.Segmenter(undefined, { granularity: 'grapheme' })`. Re-segment only the unresolved tail plus the new delta, retain the last potentially extendable cluster as carry while input is open, and flush it on `finish()`. Do not use UTF-16 indexing as the user-visible character unit.

- [ ] **Step 7: Add adaptive catch-up tests and retain RED evidence**

For a controlled 100-grapheme input, force catch-up mode by the injected clock/lag signal and assert at least 10 distinct display growth callbacks, no callback appends the entire remaining queue, and each batch is at most:

```js
Math.min(8, Math.max(1, Math.ceil(remainingBeforeFrame * 0.1)))
```

Also assert a 20-grapheme standard-mode input produces exactly 20 distinct frame callbacks with one grapheme each.

- [ ] **Step 8: Implement catch-up and reduced-motion scheduling**

Keep standard mode while estimated lag is at most 500 ms. In catch-up or reduced-motion mode, calculate the batch cap from the queue size before the frame, never drain all remaining graphemes in one callback when more than one remains, and expose the active mode in diagnostics.

- [ ] **Step 9: Add lifecycle tests and retain RED evidence**

Cover `cancel()`, `dispose()`, duplicate `finish()`, and callbacks delivered after cancellation. Assert pending content is discarded on cancel, displayed content is preserved, scheduled frame handles are cancelled, and no later callback changes state.

- [ ] **Step 10: Implement idempotent lifecycle cleanup**

Make finish, cancel, and dispose idempotent. Store at most one scheduled frame handle, cancel it during cleanup, clear pending/carry data as required, and ignore stale scheduled callbacks using an instance generation token or disposed check.

- [ ] **Step 11: Run focused and full verification**

Run:

```bash
node --test src/utils/grapheme-playback.test.js
npm test
npm run build
git diff --check
```

Expected: all commands exit zero. Record exact test counts and preserve any pre-existing build warnings separately from new failures.

- [ ] **Step 12: Self-review and commit the isolated tranche**

Confirm only the two utility/test files plus this approved plan are in scope, no network/API/store/component behavior changed, and no response text is written to logs or persistent storage.

Run:

```bash
git status --short
git diff -- src/utils/grapheme-playback.js src/utils/grapheme-playback.test.js
git add src/utils/grapheme-playback.js src/utils/grapheme-playback.test.js docs/superpowers/plans/2026-09-07-chat-grapheme-playback.md
git commit -m "feat(chat): add adaptive grapheme playback controller"
```

Expected: one isolated commit. Do not push, merge, deploy, or update the PRD status.

## Deferred Contract-Gated Work

The following are deliberately excluded from this plan and require separately reviewed plans after the product decision and front-end/back-end revision plus `platform-chat-sse.v2` contract confirmation: SSE v2 parser integration, API cancel/status calls, chat store state machine, UI stop/retry/scroll/accessibility changes, Go/Redis generation registry, Nginx/CDN changes, browser fixture acceptance, and real-model public HTTPS acceptance.
