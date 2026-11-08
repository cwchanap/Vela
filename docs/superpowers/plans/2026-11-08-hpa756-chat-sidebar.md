# HPA-756: Chat Sidebar & Thread Rename — Implementation Plan

**Date:** 2026-11-08  
**Linear:** https://linear.app/cwchanap/issue/HPA-756/add-chat-sidebar-with-thread-rename  
**Design:** [HPA-756 chat sidebar design](../specs/2026-11-08-hpa756-chat-sidebar-design.md)

> **Handoff:** This draft PR initially contains **only the reviewed design and implementation plan**. Implement, test, and handle review comments on **the same HPA-756 branch and PR**. Do not create one PR per phase, and do not move HPA-756 to Done until the acceptance gates pass.

## Ticket alignment and decisions

The Linear ticket requires a sidebar (not the current history dialog), persistent thread table, title rename, delete, split chat UI components, TanStack Query hooks, and an API contract that HPA-758 can build on. This plan delivers all of those in a single implementation PR.

Decisions consistent with that intent, without broadening product scope:

- The existing global `MainLayout` nav stays unchanged. Use a page-local container `q-layout` and `q-drawer` for the chat sidebar; avoid injecting chat navigation into the app-wide layout.
- Keep the message table and its message DTO unchanged. Replace message-derived thread summaries with row metadata in a new table; no backfill/old endpoint compatibility.
- `model` is a validated optional provider/model pair that PATCH can store, **not** a working model picker. `lastLlmAt` is reserved but not written until HPA-758.
- Query thread rows by user and sort in memory; no `updatedAt` GSI until there is a real scalability need.
- Keep the existing Pinia chat store as the only owner of currently displayed messages. Thread-list fetching/mutations use TanStack Query, not a new Pinia store.
- Persist message saves in order while a send is active; failures warn but do not suppress the AI response. Do not add DynamoDB transactions or a job queue.

## Task 1 — Persistence infrastructure

**Modify**

- `packages/cdk/lib/database-stack.ts`
- `packages/cdk/lib/api-stack.ts`
- `packages/cdk/test/database-stack.test.ts`
- `packages/cdk/test/api-stack.test.ts`
- `apps/vela-api/src/dynamodb.ts`

**Steps**

1. Add `chatThreadsTable` to `DatabaseStack`, named `vela-chat-threads`, with `UserId` string PK and `ThreadId` string SK; on-demand billing and the existing database-table lifecycle/PITR convention.
2. Expose the table as a stack property. Wire `CHAT_THREADS_TABLE_NAME` into `VelaApiFunction` and grant the Lambda read/write access, parallel to the existing `chatHistoryTable`.
3. Add `TABLE_NAMES.CHAT_THREADS` to the API's shared DynamoDB constants, with the same local default pattern.
4. Assert the new table's keys, environment variable, and IAM grant in the existing CDK tests. No extra secondary index.

**Gate:** CDK unit tests and synth include the thread table and API configuration. This task alone makes no endpoint/UI behavior claims.

## Task 2 — Thread storage, API validation, and route tests

**Modify**

- `apps/vela-api/src/validation.ts`
- `apps/vela-api/src/routes/chat-history.ts`
- `apps/vela-api/test/routes/chat-history.test.ts`

**Steps**

1. Define `ChatThreadSummarySchema` for the new returned fields (`ThreadId`, `title`, `createdAt`, `updatedAt`, optional `model`/`lastLlmAt`). Replace obsolete `lastTimestamp` and `messageCount`. Define `PatchChatThreadSchema` with optional trimmed title (1–100 chars) and optional `model: { provider: LlmProvider, model: string }`; refine to reject an empty PATCH. Reuse `LLM_PROVIDERS` from the pure `@vela/common/contracts/llm` subpath.
2. Add small local helpers inside `routes/chat-history.ts` for querying a user's metadata rows (all DynamoDB pages), getting a row by authenticated user+thread, and conditionally updating metadata. Avoid a generic chat repository layer.
3. Replace `GET /threads`' old GSI/Scan/history grouping with a metadata query by authenticated `UserId`. Remove the `user_id` request parameter and sort `updatedAt` descending, tie-break by `ThreadId`.
4. On `POST /save`, keep the existing message write and server-derived user/timestamp. If `is_user=true`, upsert the thread row with the first message's trimmed 60-character title and `createdAt` only when absent; always touch `updatedAt`. If `is_user=false`, touch `updatedAt` only when the row exists, ignoring the known no-row case rather than manufacturing an assistant-titled row. Never reset manually renamed titles or the reserved model/cache fields.
5. Implement `PATCH /thread/:id` using the authenticated `UserId` key and an existence condition; update only supplied fields and `updatedAt`, return the resulting row. Return 400 on bad title/model, 404 on no row for this user.
6. Keep `GET /messages?thread_id=…` and its response shape; check matching metadata ownership first, then use the existing message lookup (and retain the existing mixed-owner guard).
7. Replace query-string `DELETE /thread` with `DELETE /thread/:id`. Check ownership via the metadata row; reuse the existing paginated message delete + bounded BatchWrite retry, then remove the metadata row **last**. Return 404 for a missing own row. Do not add a legacy alias.
8. Replace old Scan fallback and computed-title tests. Mock `UpdateCommand`/`GetCommand`/`DeleteCommand` in the existing Bun setup, and assert the message and metadata write sequences.

**Backend test matrix**

| Scenario | Expected |
| --- | --- |
| First user save | Message + one thread row, first-user title, timestamp fields |
| Later user/assistant save | `updatedAt` bumps, manual title/model preserved |
| Assistant save before any user row | Does not create a thread row |
| List | Authenticated user only; all DynamoDB pages included; newest first |
| Rename | Trimmed title persists, other metadata unchanged |
| PATCH bad/empty title or missing own thread | 400 / 404 |
| PATCH model | Valid provider/model stored without changing the actual LLM request |
| Get messages | Wrong-user thread refused |
| Delete | Messages removed in batches, row removed last, wrong-user refused |
| Partial batch delete failure | Metadata retained for retry |

**Gate:** `cd apps/vela-api && bun test test/routes/chat-history.test.ts && bun run compile` (and the full API suite before final acceptance).

## Task 3 — Client service, query keys, and mutations

**Modify**

- `packages/common/src/keys.ts`
- `packages/common/src/index.ts`
- `packages/common/src/keys.test.ts`

**Add**

- `apps/vela/src/services/chatHistoryService.ts`
- `apps/vela/src/composables/queries/useChatThreads.ts`
- `apps/vela/src/composables/queries/useChatThreads.test.ts`

**Steps**

1. Add `chatKeys.all` and `chatKeys.threads(userId: string | null)` to shared common keys. Include the authenticated user ID to avoid showing a previous account's thread list.
2. In `chatHistoryService.ts`, type the new metadata DTO and encapsulate `httpJsonAuth` calls for list/rename/delete and the existing message fetch/save. Use the API paths from the design; stop appending `user_id` for listing and stop using query-string deletion.
3. Implement `useChatThreads` with a reactive authenticated user ID and `enabled` guard. Implement `useRenameThread` with optimistic update (cancel in-flight list, snapshot, update, rollback on error, invalidate on settle), and `useDeleteThread` with invalidation after success. Export through `src/composables/queries/index.ts`.
4. Expose a small list invalidation call after successful user/assistant message save, rather than maintaining duplicated manual `threads` state on the page.

**Gate:** composable tests cover cache scope on account switch, optimistic rename success/failure, delete invalidation, and list errors.

## Task 4 — Page-scoped chat sidebar and component extraction

**Add**

- `apps/vela/src/pages/chat/components/ChatSidebar.vue`
- `apps/vela/src/pages/chat/components/ChatMessageList.vue`
- `apps/vela/src/pages/chat/components/ChatComposer.vue`

**Modify**

- `apps/vela/src/pages/chat/AIChatPage.vue`
- `apps/vela/src/pages/chat/AIChatPage.test.ts`

**Steps**

1. Move the existing bubble/Markdown/typing UI and scroll-to-bottom behavior to `ChatMessageList`, preserving the `marked` + `DOMPurify` sanitization rule and decorative greeting behavior.
2. Move the draft input/send UI to `ChatComposer`. Keep provider selection and the actual `llmClient.generate` call in the page orchestrator, with the existing HPA-755 model/key selection. No model dropdown until HPA-758.
3. Build `ChatSidebar` with New chat, scrollable thread rows, active highlighting, relative `updatedAt`, loading/empty/error states, inline title edit (Save/Enter, Cancel/Escape), row delete menu, and a confirm trigger. Emit intents rather than importing a second global store.
4. Remove the history dialog. Wrap the chat content in a page-scoped, height-constrained `q-layout container` and a chat `q-drawer`; keep `MainLayout.vue` untouched. Desktop drawer stays visible; at mobile width it is toggled from the chat header and overlays the chat without modifying the global nav.
5. In `AIChatPage` coordinate `useChatThreads`, active chat/store state, existing `GET /messages` restoration, and the delete confirmation. On success, delete active thread => `startNewChat()` + greeting; deleting a nonactive thread leaves current content intact.
6. Make `onSend` await each history-save attempt in send order (with nonfatal warning on persistence failure), so `chat.isLoading` can guard select/new/delete until both LLM generation and saves settle. Disable those actions while sending, and ensure the active conversation cannot change mid-flight.
7. New chat does not create a metadata row until the first user message. After the first successful user save, invalidate the thread list to make the row appear.

**Frontend test matrix**

- Desktop and mobile chat-sidebar toggling independent of the existing main navigation.
- Empty list, loaded list, selection restoration, greeting, current thread highlight, and New chat behavior.
- Rename Enter/Save/Escape and network rollback; delete confirmation/cancel/success/error, including active deletion.
- Relative timestamps from `updatedAt` (not `lastTimestamp`); no `messageCount` dependency.
- In-flight send blocks destructive navigation; user/assistant history saves complete in order; provider request still uses current Settings.
- Existing chat content rendering, sanitization, and error notifications still pass.

**Gate:** `cd apps/vela && bunx vitest run src/pages/chat/AIChatPage.test.ts src/composables/queries/useChatThreads.test.ts`, then full web unit tests, lint and build.

## Task 5 — Consolidated verification and handoff

Run from a clean checkout after installing workspace dependencies and building `@vela/common` where required:

```sh
cd packages/common && bun run build && bun run test:unit
cd ../../apps/vela-api && bun test test/routes/chat-history.test.ts && bun run compile
cd ../vela && bun run test:unit && bun run lint && bun run build
cd ../../packages/cdk && bun run test:unit && bun run cdk:synth
```

Additionally perform a manual browser smoke pass (authenticated local/dev environment where available):

1. Desktop: app nav and chat sidebar coexist, send a message, reload, select saved thread, rename, reload, delete.
2. Mobile viewport: independently open/close the chat sidebar; confirm overlay fits and the composer remains visible with the keyboard.
3. Verify user A cannot read/edit/delete user B's metadata and that a fresh account sees no inherited thread list.
4. Confirm legacy message-only threads are intentionally omitted (no backfill) and that a new chat appears only after a persisted user message.
5. Review the PR against the Linear "Done when" section; capture exact commands/results. If a deployed or physical-device check cannot be run, name the blocker rather than claiming it passed.

## Explicit stop line

All implementation steps, review feedback, and tests remain in **one** HPA-756 draft PR. Do not start HPA-758 in this PR, modify unrelated Settings/TTS/profile code, implement data backfills, or add chat abstractions for hypothetical consumers. Keep HPA-756 active until implementation and acceptance are complete; only then consider HPA-758 unblocked.
