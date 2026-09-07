# Platform SSE v2 Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone strict parser for the candidate `platform-chat-sse.v2` protocol without connecting it to production requests or removing the legacy parser.

**Architecture:** A framework-independent incremental byte reader owns UTF-8 decoding and SSE framing, then validates protocol events through a small per-generation/per-model state machine. It emits typed immutable events or one stable protocol failure and never treats EOF or `[DONE]` as success.

**Tech Stack:** JavaScript ESM, Node `node:test`, `TextDecoder`, Web `ReadableStream` compatible chunks.

---

### Task 1: Incremental SSE framing and v2 validation

**Files:**

- Create: `src/utils/platform-sse-v2.js`
- Create: `src/utils/platform-sse-v2.test.js`

- [ ] **Step 1: RED framing tests**

Write tests for CRLF/LF, an event split across chunks, multiple events in one chunk, multi-line `data:`, comments, and UTF-8 bytes split inside a multibyte character. Run `node --test src/utils/platform-sse-v2.test.js` and retain the expected missing-module/behavior failure.

- [ ] **Step 2: Minimal incremental decoder and framer**

Export a factory accepting `generationId`, expected models, `onEvent`, and `onError`, with `push(Uint8Array|string)` and `finish()` methods. Use streaming `TextDecoder`; normalize event boundaries without corrupting data payloads; combine multi-line data using `\n` per SSE rules.

- [ ] **Step 3: RED protocol-order tests**

Add tests requiring the first and only first event to be `meta`, matching schema/generation/models; require non-empty string deltas and strictly increasing per-model `seq` from 1; cover interleaved compare models, `model_done`, `model_error`, global `done`, and global `error`.

- [ ] **Step 4: Minimal v2 state machine**

Validate IDs as opaque strings, models against the meta set, per-model sequence and terminal state, exactly one global terminal event, and compare completion rules. Emit metadata separately from text; never append metadata or errors to content.

- [ ] **Step 5: RED corruption/idempotency tests**

Cover duplicate identical delta/terminal events, conflicting duplicates, sequence gaps/out-of-order events, delta before/duplicate meta, invalid JSON, empty delta, unknown events, event after terminal, `[DONE]`, and EOF without a valid terminal. Assert stable error codes and a single error notification without raw payload leakage.

- [ ] **Step 6: Implement fail-closed completion and deduplication**

Ignore safe unknown events with a diagnostic category; deduplicate only exact already accepted protocol events; reject conflicting duplicates and sequence gaps. `finish()` succeeds only after a valid global `done`; EOF, decoder/framing residue, or missing terminal fails. A global `error` is a terminal failure, not successful completion.

- [ ] **Step 7: Lifecycle and callback-failure tests**

Cover duplicate `finish()`, push after terminal, callback exceptions, invalid input type, and late chunks. Ensure the parser cannot remain half-active or leak raw JSON, Authorization, prompt, response, upstream error, or internal address through its public error.

- [ ] **Step 8: Full verification and isolated commit**

Run:

```bash
node --test src/utils/platform-sse-v2.test.js
npm test
npm run build
git diff --check
```

Expected: all exit zero, with only pre-existing build warnings. Commit only the parser, tests, and this plan using `feat(chat): add strict platform SSE v2 parser`. Do not modify `src/utils/sse.js`, API/store/components, dependencies, PRD status, or perform push/merge/deploy.

## Deferred Integration

Using this parser in `src/api/platform.js` or `src/stores/chat.js` requires product approval plus written confirmation of the exact front-end revision, back-end revision, and `platform-chat-sse.v2` contract.
