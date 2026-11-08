# HPA-756: Chat sidebar, persistent threads, and rename

**Date:** 2026-11-08  
**Linear:** https://linear.app/cwchanap/issue/HPA-756/add-chat-sidebar-with-thread-rename  
**State:** Design for review; implementation and acceptance have **not** been completed.  
**PR policy:** Exactly one HPA-756 draft PR for these documents, implementation, tests, and subsequent review fixes.

## Goal and dependency

Replace the AI Chat history dialog with a responsive chat sidebar, allow rename and delete, and persist a small thread record independently of messages. Keep the existing chat/LLM behavior intact. HPA-756 unblocks HPA-758 (per-thread model picker and cache-expiry reminder), which needs the new thread row and PATCH contract.

HPA-754 and HPA-755 are Done in Linear; their LLM registry and per-provider Settings are current assumptions. HPA-757 (TTS), HPA-824 (cross-client profile CAS), and HPA-833 (LLM preference tombstones) are outside this work.

## Observed code seams (main branch, 2026-11-08)

- `apps/vela/src/pages/chat/AIChatPage.vue` is a ~732-line page with chat header, rendered messages, composer, history `q-dialog`, and delete confirmation together. History is fetched only when the dialog opens. The chat store already owns `chatId`, messages, and loading state.
- `apps/vela-api/src/routes/chat-history.ts` saves message rows to `vela-chat-history` (PK `ThreadId`, SK `Timestamp`), lists conversations by reading messages via `UserIdIndex` with an optional Scan fallback, and derives titles/counts from message arrays. `GET /messages` and `DELETE /thread` already verify ownership; deletion batches up to 25 message rows.
- `packages/cdk/lib/database-stack.ts` defines the message-history table, while `api-stack.ts` passes its name to the API Lambda and grants read/write.
- `packages/common/src/keys.ts` contains shared TanStack Query key factories. `apps/vela/src/composables/queries` has the existing composable convention.
- `apps/vela/src/layouts/MainLayout.vue` already owns the site's navigation `q-drawer`. The chat-specific drawer must remain scoped to the chat page, not replace or repurpose the global navigation.
- `AIChatPage.test.ts` and `apps/vela-api/test/routes/chat-history.test.ts` extensively assert the old dialog, thread summary fields, query-parameter delete endpoint, and Scan fallback. Those tests intentionally require replacement rather than compatibility shims.

## Product behavior

1. Desktop: on the chat page only, display an expanded, scrollable thread sidebar beside the message area; show a New chat action and title/relative last-updated time for each thread. Highlight the current thread.
2. Narrow screens: collapse the chat sidebar into an overlay opened from the chat header, independent of the existing global navigation drawer. Close it after selecting a conversation. Content and composer remain usable with keyboard/safe-area constraints.
3. Selecting a thread loads its message history and preserves the existing decorative Japanese greeting behavior. New chat generates a fresh `chatId` and displays the greeting but creates **no persistent row** until the first user message.
4. Rename: inline action (pencil icon), Enter/Save commits a trimmed nonempty title, Escape/Cancel restores the original. Optimistically update the sidebar; roll back if the server rejects the edit. Renaming persists after reload.
5. Delete: a row menu opens the existing confirmation UI. On success remove the row, and reset to a fresh chat if it was active; on failure preserve the row and active conversation.
6. Keep the active conversation stable while a message/LLM response is in flight. Disable new-chat/thread-switch/delete while sending so async replies cannot land in another thread or resurrect a deleted one.

## Data model

Create `vela-chat-threads` in `packages/cdk/lib/database-stack.ts`, mirroring the current pay-per-request / lifecycle conventions:

| Attribute | Type | Notes |
| --- | --- | --- |
| `UserId` | String, partition key | Authenticated user ID from server middleware |
| `ThreadId` | String, sort key | Existing chat UUID |
| `title` | String | Initial title = trimmed first user message, max 60 chars; later user rename can use up to 100 chars |
| `createdAt` | Number (epoch ms) | Write once |
| `updatedAt` | Number (epoch ms) | Latest saved message or title/model mutation |
| `model` | `{ provider, model }` or absent | Reserved for HPA-758; PATCH accepts it now; no per-thread picker in HPA-756 |
| `lastLlmAt` | Number (epoch ms) or absent | Reserved for HPA-758; **do not** fake cache timestamps from message saves |

Messages remain in `vela-chat-history`; no copying or dual-read migration. Existing old message-only threads do not appear because there are no real users yet. No chat-specific ORM, cache store, or new GSI.

`GET /threads` queries by `UserId`, paginates until complete (DynamoDB's 1 MiB query-page limit), then sorts records by `updatedAt` descending, with a deterministic `ThreadId` tie-break. Sorting in memory is deliberate at hobby-project scale: the required sort key is `ThreadId`, and a second index is not justified yet.

## HTTP contract (under existing /api/chat-history prefix)

| Method/path | Request | Response / constraints |
| --- | --- | --- |
| `GET /threads` | No user ID parameter | `{ threads: ChatThreadSummary[] }`; identity from `requireAuth`; newest first |
| `GET /messages?thread_id=…` | Existing query parameter | Existing `{ items }` shape; check a row keyed by authenticated `UserId` + `ThreadId` before loading messages |
| `POST /save` | Existing `ChatHistoryItemSchema` message payload | Existing `{ ok: true }`; server overwrites `UserId` and timestamp, writes message, then touches thread metadata |
| `PATCH /thread/:id` | `{ title?: string, model?: { provider: LlmProvider, model: string } }`, at least one field | `{ thread }`; trim title; use conditional update for existing row; missing own row returns 404 |
| `DELETE /thread/:id` | No body | `{ ok: true }` after deleting message rows and thread row; missing own row returns 404 |

This intentionally drops the legacy `user_id` query parameter for listing and the old `DELETE /thread?thread_id=…` endpoint. No compatibility alias is needed. Restrict PATCH to known fields; provider is one of `LLM_PROVIDERS` (OpenRouter model ID remains free text), while HPA-758 will own model-selection behavior.

Shared Zod definitions go in `apps/vela-api/src/validation.ts`, with the new client DTO in a focused chat-history service/types module. The UI no longer depends on `messageCount` or `lastTimestamp`: both were derived from history and are not persisted on thread rows.

### Save ordering and update rules

- Only a **user** message may create a thread row. Its first successful write uses an upsert with `if_not_exists(title)` and `if_not_exists(createdAt)`, preserving a later manual rename. Any message can bump `updatedAt` on an existing row.
- Assistant messages do not create placeholder thread rows. If an assistant save arrives first, the message may persist but the metadata touch is skipped; the eventual first user save creates the correct title.
- Serialize/await the user and assistant history saves within `onSend` (while keeping history failure nonfatal to LLM generation). Do not allow destructive navigation while the send is settling. This prevents a late assistant write from re-creating a deleted thread and keeps user-first titles predictable.
- Update only the metadata fields explicitly relevant to each operation. In particular, message saves must **not** overwrite a renamed title, `model`, or `lastLlmAt`.
- Delete is ordered **message rows first, thread row last**, so a partial batch-delete failure remains visible and retryable. Reuse existing bounded `BatchWrite` retry logic rather than introduce cross-table transactions.
- No state backfill, event bus, queue, or transaction orchestration. Tests should demonstrate the core ordering and ownership behavior.

## Frontend ownership and layout

- `ChatSidebar.vue` owns thread list rendering, loading/empty/error states, relative timestamps, inline rename form, and row actions; it emits select/new/rename/delete intents.
- `ChatMessageList.vue` owns the existing sanitized Markdown chat bubbles, typing indicator, and scroll-to-bottom behavior (preserve marked + DOMPurify behavior).
- `ChatComposer.vue` owns draft input and send controls; emits a trimmed send intent; no provider picker or cache chip yet.
- `AIChatPage.vue` remains the thin orchestrator: use the existing Pinia chat store and LLM client, own current selection/confirm flow, and coordinate history fetch/persistence.
- Use a **page-scoped container `q-layout` with `q-drawer`**, constrained to the chat page, so MainLayout's left navigation remains independent. Keep the drawer expanded on wide screens and overlay on mobile; confirm correct clipping and height with a browser smoke check.
- Add `chatKeys.threads(userId)` to `@vela/common` with an identity-scoped key. Add `useChatThreads` / `useRenameThread` / `useDeleteThread` composables using TanStack Query. Invalidate after successful saves/deletes; rename uses optimistic update and rollback. Continue to load one selected conversation directly; do **not** create a second source of truth for chat message state.

## Non-goals

No HPA-758 model picker or cache countdown; no TTS work; no historical message migration; no new authentication system; no general chat repository framework; no new state manager; no additional DynamoDB indexes; no cross-client preference versioning; no deployment of these changes during the docs-only review.

## Acceptance and verification

- A new user's chat page shows an empty sidebar; first user message creates exactly one thread summary using the user text (not the decorative greeting/assistant reply).
- Threads sort newest-first; selection restores correct chat content; new chat stays in-memory until a user sends.
- Rename Enter/Save persists, Escape cancels, blank titles reject; an API error rolls back the optimistic title.
- Deleting inactive/active threads removes their messages and metadata; active deletion resets the greeting; a partial failure leaves a retryable row.
- Cross-user list/read/rename/delete are not allowed; PATCH cannot upsert an arbitrary thread.
- Main navigation + chat navigation coexist at desktop and mobile widths; no jump/overflow after keyboard open.
- Update Bun API tests, Vitest page/composable tests, and CDK table/permission tests. Run targeted tests, API type-check, web type-check/build, CDK tests and `cdk:synth`; record any missing environment-dependent verification honestly.
