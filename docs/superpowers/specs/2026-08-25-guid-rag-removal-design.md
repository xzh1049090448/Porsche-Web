# Frontend GUID Contract and RAG Removal Design

## Goal

Make Porsche-Web compatible with the MySQL-only backend persistence refactor: business resources are identified externally by snowflake GUID strings, and the removed RAG/dataset capability is absent from UI state, API requests, and mappings.

## Scope

This is a single, breaking frontend cutover. There is no fallback to legacy numeric `id`, `conversation_id`, `dataset_enabled`, or `dataset_ids` fields.

The retained product surface is login, profile, API keys, chat, multi-model comparison, conversations, billing, analytics, and dynamic model catalog.

## Contract Mapping

| Area | Old frontend contract | New contract |
| --- | --- | --- |
| User | `id`, `dataset_calls` | `guid`; no dataset metrics |
| Conversation | numeric `id`; dataset fields | `guid` string; no dataset fields |
| Message | numeric `id`; dataset attribution | `guid` string; no dataset fields |
| Order | numeric `id` | `guid` string |
| Gateway API token | numeric URL parameter | `guid` string |
| Platform chat / compare | `conversation_id` plus dataset fields | optional `conversation_guid`; no dataset fields |

All GUIDs remain strings in JavaScript. They must not be parsed into `Number`, because snowflake values can exceed JavaScript’s safe integer range.

## Architecture

`src/api/` owns request shaping and URL encoding. `src/utils/platform-mappers.js` is the only boundary that maps backend DTOs into camelCase view state. Pinia stores and views consume mapped GUID strings without interpreting them as numeric values.

The chat store supplies `conversation_guid` to platform chat/compare calls and replaces its local active conversation ID only from an SSE `conversation_guid` metadata field. Conversation CRUD URL paths use `encodeURIComponent(guid)`.

## RAG Removal

Remove dataset payload fields, mapped fields, mock state, and user-facing dataset metrics. Unknown legacy dataset fields must not be sent to the backend. Existing conversation history and Markdown export remain intact.

## Error Handling and Security

The dynamic backend catalog remains the sole source of selectable models. The UI must not use static model or RAG fallback data to grant access. API errors remain generic; frontend code must not persist raw errors, GUID internals, prompts, or tokens beyond existing permitted UI state.

## Verification

- Unit tests verify API payloads have `conversation_guid` and omit all dataset fields.
- Mapper tests verify GUIDs stay strings and no internal `id` or RAG properties remain in mapped objects.
- Existing SSE tests cover GUID metadata and multi-model error isolation.
- `npm test`, `npm run build`, security review, and test-engineer acceptance must pass.
