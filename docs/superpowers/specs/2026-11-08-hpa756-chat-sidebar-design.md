# HPA-756: Chat sidebar, persistent threads, and rename

**Date:** 2026-11-08  
**Linear:** https://linear.app/cwchanap/issue/HPA-756/add-chat-sidebar-with-thread-rename  
**State:** Design updated after the 2026-11-08 review; implementation and acceptance have **not** been completed.  
**PR policy:** Exactly one HPA-756 draft PR for these documents, implementation, tests, and subsequent review fixes.

## Goal and dependency

Replace the AI Chat history dialog with a responsive chat sidebar, allow rename and delete, and persist a small thread record independently of messages. Keep the existing chat/LLM behavior intact. HPA-756 unblocks HPA-758 (per-thread model picker and cache-expiry reminder), which needs the new thread row and PATCH contract.

HPA-754 and HPA-755 are Done in Linear; their LLM registry and per-provider Settings are current assumptions. HPA-757 (TTS), HPA-824 (cross-client profile CAS), and HPA-833 (LLM preference tombstones) are outside this work.

### Review reconciliation (2026-11-08)

The [GitHub design review](https://github.com/cwchanap/Vela/pull/82#issuecomment-6724899527) identified a smaller implementation. Adopt it: simple desktop `<aside>` plus mobile left-positioned `q-dialog` rather than a nested Quasar layout; metadata-first **user** saves and message-only assistant saves; remove the now-unused message `UserIdIndex`; reuse one local query-pagination helper; automate responsive testing and update existing browser fixtures. Defer `lastLlmAt` to HPA-758. A subsequent [GitHub review](https://github.com/cwchanap/Vela/pull/82#pullrequestreview-5819110588) clarifies page height/overflow, 404 for an absent owned thread, server-side 60-character initial-title derivation, and a pure relative-time helper with tests. These are implementation refinements to the same HPA-756 product acceptance, not separate tasks or PRs.

## Observed code seams (main branch, 2026-11-08)

- `apps/vela/src/pages/chat/AIChatPage.vue` is a ~732-line page with chat header, rendered messages, composer, history `q-dialog`, and delete confirmation together. History is fetched only when the dialog opens. The chat store already owns `chatId`, messages, and loading state.
- `apps/vela-api/src/routes/chat-history.ts` saves message rows to `vela-chat-history` (PK `ThreadId`, SK `Timestamp`), lists conversations by reading messages via `UserIdIndex` with an optional Scan fallback, and derives titles/counts from message arrays. `GET /messages` currently reads only the first DynamoDB query page, while delete already paginates and batches up to 25 message rows. The new thread metadata query makes `UserIdIndex` unused.
- `packages/cdk/lib/database-stack.ts` defines the message-history table, while `api-stack.ts` passes its name to the API Lambda and grants read/write.
- `packages/common/src/keys.ts` contains shared TanStack Query key factories. `apps/vela/src/composables/queries` has the existing composable convention.
- `apps/vela/src/layouts/MainLayout.vue` already owns the site's navigation `q-drawer`. The chat-specific drawer must remain scoped to the chat page, not replace or repurpose the global navigation.
- `AIChatPage.test.ts` and `apps/vela-api/test/routes/chat-history.test.ts` extensively assert the old dialog, thread summary fields, query-parameter delete endpoint, and Scan fallback. Those tests intentionally require replacement rather than compatibility shims.
- The mocked Playwright suite `apps/vela/e2e/llm-settings.spec.ts` already uses `llm-chat-input`/`llm-chat-send` on `/chat`. `apps/vela/e2e/fixtures/syntheticAuth.ts` returns 500 for unmocked API routes; `playwright.mocked.config.ts` currently runs only the settings spec. `apps/vela/e2e/api.spec.ts` still asserts the old `?user_id=` contract. Update all four.

## Product behavior

1. Desktop: on the chat page only, display a scrollable `ChatSidebar` inside a flex `<aside>` beside the message area; show a New chat action and title/relative last-updated time for each thread. Highlight the current thread. Use a pure feature-local `formatRelativeTime(timestamp, now)` helper backed by `Intl.RelativeTimeFormat` (no dependency); unit-test just-now, minute/hour/day transitions and future clock skew.
2. Narrow screens: render the same `ChatSidebar` inside a left-positioned `q-dialog` opened from the chat header. Reuse Quasar's existing overlay, Esc, backdrop and focus behavior instead of nesting `q-layout` in `MainLayout`. Close it after selecting a conversation. Content and composer remain usable with keyboard/safe-area constraints; the global nav remains independent.
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
| `title` | String | Server-derived initial title `message.trim().slice(0, 60) || 'New conversation'`; later manual rename is trimmed and at most 60 characters |
| `createdAt` | Number (epoch ms) | Write once |
| `updatedAt` | Number (epoch ms) | Latest saved **user** message or title/model mutation |
| `model` | `{ provider, model }` or absent | PATCH accepts/stores the value for HPA-758; no per-thread picker in HPA-756 |

Messages remain in `vela-chat-history`; no copying or dual-read migration. Remove `UserIdIndex` from the message table: after thread-list queries move to the new table, it has no runtime reader. Existing old message-only threads do not appear because there are no real users yet. No chat-specific ORM, cache store, or new GSI. `lastLlmAt` is intentionally **not** part of HPA-756's schema/DTO: DynamoDB is schemaless and HPA-758 will add its own cache-timestamp write contract when it needs it.

`GET /threads` queries by `UserId`, paginates until complete (DynamoDB's 1 MiB query-page limit), then sorts records by `updatedAt` descending, with a deterministic `ThreadId` tie-break. Sorting in memory is deliberate at hobby-project scale: the required sort key is `ThreadId`, and a second index is not justified yet.

## HTTP contract (under existing /api/chat-history prefix)

| Method/path | Request | Response / constraints |
| --- | --- | --- |
| `GET /threads` | No user ID parameter | `{ threads: ChatThreadSummary[] }`; identity from `requireAuth`; newest first |
| `GET /messages?thread_id=…` | Existing query parameter | Check the metadata row for `(authenticatedUserId, ThreadId)` **first**. If absent, return HTTP **404** `{ error: 'Thread not found' }` for both unknown and other users' threads; if present, paginate messages and return `{ items }` (empty list is 200 for an owned row with no messages) |
| `POST /save` | Existing `ChatHistoryItemSchema` message payload | Existing `{ ok: true }`; server overwrites `UserId` and timestamp. For user messages, upsert the row **before** writing the message; for assistant messages, write only the message |
| `PATCH /thread/:id` | `{ title?: string, model?: { provider: LlmProvider, model: string } }`, at least one field | `{ thread }`; trim title; use conditional update for existing row; missing own row returns 404 |
| `DELETE /thread/:id` | No body | `{ ok: true }` after deleting message rows and thread row; missing own row returns 404 |

This intentionally drops the legacy `user_id` query parameter for listing and the old `DELETE /thread?thread_id=…` endpoint. No compatibility alias is needed. Restrict PATCH to known fields; provider is one of `LLM_PROVIDERS` (OpenRouter model ID remains free text), while HPA-758 will own model-selection behavior.

Shared Zod definitions go in `apps/vela-api/src/validation.ts`, with the new client DTO in a focused chat-history service/types module. The UI no longer depends on `messageCount` or `lastTimestamp`: both were derived from history and are not persisted on thread rows.

### Save ordering and update rules

- For a **user** save, compute the initial title **on the server** as `item.message.trim().slice(0, 60) || 'New conversation'` (the chat-message schema allows whitespace and unbounded text), then upsert the row using `if_not_exists(title)` and `if_not_exists(createdAt)`, set `updatedAt`, **then** write the message. This preserves manual rename and avoids an invisible message when metadata creation fails; a metadata-only row on message-write failure stays visible and can be retried/deleted.
- Assistant saves write **only the message**. Do not conditionally update metadata or introduce a swallowed `ConditionalCheckFailedException` path. HPA-758 will write its own `lastLlmAt` when it owns cache lifecycle.
- Set `chat.isLoading` **before** the first history-save await; serialize/await user save, LLM generation, and assistant save in `onSend`. Keep history failure nonfatal for LLM generation, but warn the user. Disable thread selection/new/delete while the entire operation settles to prevent replies landing in another chat.
- User saves must never overwrite a manually renamed title or stored `model`. PATCH updates only supplied fields and `updatedAt`.
- Delete is ordered **message rows first, thread row last**, so a partial batch-delete failure remains visible and retryable. Reuse existing bounded `BatchWrite` retry logic rather than introduce cross-table transactions.
- Add one small local `queryAllPages` helper around `QueryCommand` with `ExclusiveStartKey`, reused by the metadata list, message read and message-delete query; no generic database abstraction.
- No state backfill, event bus, queue, or transaction orchestration. Tests should demonstrate the core ordering and ownership behavior.

## Frontend ownership and layout

- `ChatSidebar.vue` owns thread list rendering, loading/empty/error states, relative timestamps from `src/pages/chat/utils/formatTime.ts`, inline rename form, and row actions; it emits select/new/rename/delete intents. `formatRelativeTime(timestamp: number, now = Date.now())` is pure for deterministic testing, returns 'just now' for sub-minute/near-future clock skew, and uses `Intl.RelativeTimeFormat` for larger intervals. No library or generic date module.
- `ChatMessageList.vue` owns the existing sanitized Markdown chat bubbles, typing indicator, and scroll-to-bottom behavior (preserve marked + DOMPurify behavior).
- `ChatComposer.vue` owns draft input and send controls; emits a trimmed send intent; no provider picker or cache chip yet.
- `AIChatPage.vue` remains the thin orchestrator: use the existing Pinia chat store and LLM client, own current selection/confirm flow, and coordinate history fetch/persistence.
- On wide screens mount `ChatSidebar` in a normal flex `<aside>` with a constrained width; on narrow screens mount the same component inside a left-positioned `q-dialog`. **Constrain the chat page height to the viewport below `MainLayout`'s toolbar** (currently `min-height: 60px` in `MainLayout.vue`; e.g. `height: calc(100dvh - 60px)` with `box-sizing: border-box` and `overflow: hidden` instead of `min-height: 100vh`). Give flex children `min-height: 0`, keep the composer/header non-shrinking, and make `<aside>` and the message list independently vertically scrollable (`overflow-y: auto`). This reuses an established Quasar pattern without nested-layout plumbing. Leave `MainLayout.vue` unchanged; test 1280px/375px with a long message history, asserting the composer remains in the viewport and page body does not grow.
- Add `chatKeys.threads(userId)` to `@vela/common` with an identity-scoped key. Add `useChatThreads` / `useRenameThread` / `useDeleteThread` composables using TanStack Query. Invalidate after successful saves/deletes; rename uses optimistic update and rollback. Continue to load one selected conversation directly; do **not** create a second source of truth for chat message state.

## Non-goals

No HPA-758 model picker, cache countdown, or `lastLlmAt` write; no TTS work; no historical message migration; no new authentication system; no general chat repository framework; no new state manager; no additional DynamoDB indexes; no cross-client preference versioning; no deployment of these changes during the docs-only review.

## Acceptance and verification

- A new user's chat page shows an empty sidebar; first user message creates exactly one thread summary using the server-trimmed, 60-character title (or 'New conversation' for whitespace-only messages), not the decorative greeting/assistant reply.
- Threads sort newest-first; selection restores correct chat content; new chat stays in-memory until a user sends.
- Rename Enter/Save persists, Escape cancels, blank titles reject; an API error rolls back the optimistic title.
- Deleting inactive/active threads removes their messages and metadata; active deletion resets the greeting; a partial failure leaves a retryable row.
- Cross-user list/read/rename/delete are not allowed; absent or unowned thread metadata yields the same 404 `{ error: 'Thread not found' }` for `GET /messages`, PATCH and DELETE; PATCH cannot upsert an arbitrary thread. A present owned metadata row with no messages returns `{ items: [] }` (200).
- Main navigation + chat navigation coexist at desktop and mobile widths (mocked Playwright at 1280px and 375px); with a long conversation, sidebar/messages scroll independently, the page height stays constrained, and the composer remains visible. Keep `llm-chat-input` and `llm-chat-send` selectors intact for the existing settings E2E suite.
- Update Bun API tests (including metadata-lookup-first 404 vs owned-empty 200, message pagination and long/whitespace title truncation), Vitest page/composable tests (including pure relative-time helper), CDK table/permission tests (including GSI removal), the synthetic API router, and old API E2E tests that assume `?user_id=`. Add one stateful mocked browser scenario for send → new thread → rename → reload → delete active thread at both widths, with a long-list scroll assertion.
- Run targeted tests, API type-check, web type-check/build, CDK tests, `cdk:synth` and `bun run test:e2e:mocked`; record any missing environment-dependent verification honestly.
