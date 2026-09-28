# Chat Generation Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone generation lifecycle state machine that connects validated v2 events to independent FE-01 playback controllers without network, Pinia, Vue, or persistence integration.

**Architecture:** One generation owns immutable identity and one playback instance per model. Network completion and visual completion remain separate; only a valid completed terminal plus empty playback queues yields `completed`. Cancellation/status resolution is authoritative and fail-closed.

**Tech Stack:** JavaScript ESM, Node `node:test`, FE-01 `createGraphemePlayback`.

---

### Task 1: Generation identity and legal state transitions

**Files:**

- Create: `src/utils/chat-generation.js`
- Create: `src/utils/chat-generation.test.js`

- [ ] Write failing tests for immutable nonblank `generationId`, `conversationGuid`, `messageKey`, `single|compare`, unique opaque models, initial `waiting`, and invalid construction.
- [ ] Run `node --test src/utils/chat-generation.test.js` and retain the expected RED.
- [ ] Implement `createChatGeneration(options)` with immutable snapshots and legal `waiting → receiving → cancelling|draining|failed → completed|cancelled` transitions.

### Task 2: Per-model receive and playback

- [ ] Add RED tests for validated meta, generation/model/seq mismatch, single and interleaved compare deltas, and independent model terminal states.
- [ ] Inject/use `createGraphemePlayback`; do not copy segmentation or scheduling logic.
- [ ] Track per model `receivedText`, `displayedText`, `pendingCount`, last seq, and terminal state. Reject late/mismatched events without writing another conversation/message.

### Task 3: Network done versus visual draining

- [ ] Add RED tests proving valid done enters `draining`, not `completed`, while any queue remains.
- [ ] Finish each successful playback only after its model terminal; enter `completed` only after the valid global completion and all queues drain.
- [ ] Ensure EOF, parser failure, transport failure, duplicate/conflicting terminal events and model gaps never become success.

### Task 4: Cancel and authoritative status recovery

- [ ] Add RED tests for local cancelling freeze, authoritative `cancelled|failed|completed`, and continued waiting on `cancelling|committing`.
- [ ] On cancelled, discard undisplayed queues and preserve displayed prefixes.
- [ ] On authoritative completed, require every displayed text to be a prefix of authoritative content and enqueue only the remaining suffix; prefix mismatch becomes a stable data error without overwriting displayed text.
- [ ] Compare completion must map results by exact model set/order and keep sibling failures isolated.

### Task 5: Lifecycle, callbacks and safety

- [ ] Add RED tests for dispose, retry/new instance isolation, late playback callbacks, callback exceptions, repeated terminal methods, and absence of Storage access.
- [ ] Fail closed with stable diagnostic categories; never include response text, prompt, Authorization, upstream errors, secrets or internal URLs in diagnostics.
- [ ] Ensure all playback instances are cancelled/disposed and no scheduled callback can mutate after disposal.

### Task 6: Verification and isolated commit

Run:

```bash
node --test src/utils/chat-generation.test.js
npm test
npm run build
git diff --check
```

Expected: all exit zero with only pre-existing build warnings. Commit only the two lifecycle files plus this plan and the approved decision record using `feat(chat): add generation lifecycle state machine`. Do not modify API/store/Vue/Mock/backend/deployment files and do not push, merge or deploy.

## Deferred

API transport, polling schedules, Pinia integration, UI behavior, backend Redis/MySQL lifecycle, Nginx/CDN and real HTTPS acceptance require later contract-gated plans.
