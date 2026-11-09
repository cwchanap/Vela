# HPA-756: Chat Sidebar & Thread Rename — Implementation Plan

**Date:** 2026-11-08  
**Linear:** https://linear.app/cwchanap/issue/HPA-756/add-chat-sidebar-with-thread-rename  
**Design:** [HPA-756 chat sidebar design](../specs/2026-11-08-hpa756-chat-sidebar-design.md)  
**Review reconciliation:** Revised 2026-11-08 following the [first design review](https://github.com/cwchanap/Vela/pull/82#issuecomment-6724899527) and [latest review](https://github.com/cwchanap/Vela/pull/82#pullrequestreview-5819110588). Implementation is now complete on this PR with the automated gates below green; live authenticated acceptance remains outstanding.

> **Handoff:** This draft PR began with **only the reviewed design and implementation plan**; implementation, tests, and review fixes have since landed on the same branch and PR. Do not create one PR per phase, and do not move HPA-756 to Done until the acceptance gates pass.

## Ticket alignment and decisions

The Linear ticket requires a chat sidebar (replacing the history dialog), a new thread table and API, title rename/delete, extracted chat UI components, TanStack Query hooks, and an HPA-758-ready `model` PATCH contract. The GitHub review preserves that acceptance while simplifying the architecture. The aligned Linear description must reflect these reviewed changes.

- Keep `MainLayout.vue` and its global `q-drawer` unchanged. Chat layout is a flex `<aside>` on desktop and the **same** `ChatSidebar` inside a left-positioned `q-dialog` on mobile. Constrain the chat page to the viewport below the current 60px MainLayout toolbar, hide page overflow, and scroll the sidebar/messages independently; keep header/composer visible. No nested `q-layout` or second drawer plumbing.
- Preserve the message table/DTO. Add one thread metadata table; remove the now-unused message-table `UserIdIndex`. No backfill or old endpoint compatibility.
- `model` is a validated optional pair accepted by PATCH, not a working picker. Drop `lastLlmAt` from this ticket; HPA-758 adds the timestamp and its write path when the cache reminder is built.
- One maximum title length (60 characters) for both generated and manually entered titles. Server derives initial title as `message.trim().slice(0, 60) || 'New conversation'`. Use a small pure `formatRelativeTime(timestamp, now)` helper backed by `Intl.RelativeTimeFormat`, covered by focused unit tests without any dependency.
- Paginate all three thread/message queries using one small route-local helper; don't abstract DynamoDB globally or add an `updatedAt` GSI. A missing or unowned thread metadata row returns the **same 404** for `GET /messages`, PATCH and DELETE, while an owned row with no messages returns 200 with an empty list.
- Pinia remains the source of truth for displayed messages. TanStack Query owns only the user-scoped thread list and mutations.
- Write the user thread row **before** its first message. Assistant saves write **only** messages. Set `chat.isLoading` before persistence; await saves sequentially until send settles; no transaction coordinator or queue.
- Keep all review fixes and implementation in this one draft PR.

## Task 1 — Persistence infrastructure

**Modify**

- `packages/cdk/lib/database-stack.ts`
- `packages/cdk/lib/api-stack.ts`
- `packages/cdk/test/database-stack.test.ts`
- `packages/cdk/test/api-stack.test.ts`
- `apps/vela-api/src/dynamodb.ts`

**Steps**

1. Add `chatThreadsTable` to `DatabaseStack`, named `vela-chat-threads`, with `UserId` string PK and `ThreadId` string SK; on-demand billing and existing table lifecycle/PITR convention.
2. Expose the table from the stack. Wire `CHAT_THREADS_TABLE_NAME` into `VelaApiFunction` and grant read/write access, parallel to the message-history table.
3. Add `TABLE_NAMES.CHAT_THREADS` with the existing local-name fallback convention.
4. **Remove `UserIdIndex` from `vela-chat-history`**. Its only runtime reader is the old `dynamodb_listThreads`, replaced by the new table query. Update the old index assertion in `database-stack.test.ts` to assert that the unused GSI is absent, while retaining the separate SRS index.
5. Assert thread-table keys, Lambda environment, and IAM grant in CDK tests. No secondary index for sorting threads.

**Gate:** CDK unit tests and synth reflect the new table and removal of the unused chat-history GSI. No runtime behavior is claimed at this stage.

## Task 2 — Thread storage, API validation, and route tests

**Modify**

- `apps/vela-api/src/validation.ts`
- `apps/vela-api/src/routes/chat-history.ts`
- `apps/vela-api/test/routes/chat-history.test.ts`
- `apps/vela/e2e/api.spec.ts`
- `apps/vela-api/README.md` (remove outdated query-param API examples)

**Steps**

1. Replace `ChatThreadSummarySchema` with `ThreadId`, `title` (nonempty, max 60), `createdAt`, `updatedAt`, optional `model`; drop `lastTimestamp`, `messageCount` and `lastLlmAt`. Define `PatchChatThreadSchema` with a trimmed nonempty title **up to 60 characters** or a `model: { provider: LlmProvider, model: string }` (or both); reject an empty PATCH. Derive provider validation from `LLM_PROVIDERS` via the pure `@vela/common/contracts/llm` subpath.
2. Add one local `queryAllPages(input: QueryCommandInput)` helper that copies the query input and advances `ExclusiveStartKey` until no `LastEvaluatedKey`. Reuse for metadata list (`GET /threads`), message retrieval (`GET /messages`), and message-delete enumeration (`DELETE /thread/:id`). Keep the bounded 25-item `BatchWrite` retry logic.
3. Add simple route-local helpers to fetch a thread by authenticated `UserId` + `ThreadId`, and to conditionally update an existing thread; don't create a repository abstraction.
4. Replace `GET /threads`' message GSI/Scan grouping with a metadata query by the authenticated `UserId`. Remove the `user_id` query parameter, paginate all rows, sort by `updatedAt` descending with `ThreadId` tie-break, return `{ threads }`.
5. On `POST /save` derive user ID/timestamp server-side. If `is_user=true`, compute `initialTitle = item.message.trim().slice(0, 60) || 'New conversation'` **on the server** before upserting the metadata row (only set title/createdAt via `if_not_exists`, set updatedAt), then write the message. Never store raw unbounded message text as the title; the message schema currently permits whitespace-only content. If `is_user=false`, write the message **only**; do not touch metadata or suppress conditional exceptions. Metadata creation failure does not write an invisible message. A message-write failure after metadata upsert leaves a visible empty thread that can be retried/deleted. Preserve a manual rename or stored model.
6. Implement `PATCH /thread/:id` using the authenticated `UserId` key and an existence condition; update only supplied fields plus `updatedAt`, returning the new row. Bad/empty title/model returns 400, missing own row 404.
7. Keep `GET /messages?thread_id=…` shape. **First** use `GetCommand` with `(UserId = authenticatedUserId, ThreadId = thread_id)` on `vela-chat-threads`; if missing, return **404** `{ error: 'Thread not found' }` for unknown and other users' IDs alike. If present, load _all_ message pages via the shared helper, return `{ items: [] }` (200) for an owned empty thread, and retain the mixed-owner check for corrupted message rows.
8. Replace query-string `DELETE /thread` with `DELETE /thread/:id`: check own thread row, enumerate and delete message pages using existing batch retry, **delete metadata last**, return the same 404 `{ error: 'Thread not found' }` for absent/unowned row. Use this error contract for PATCH too; no legacy alias.
9. Replace the obsolete Scan fallback and computed-title unit tests, including the old GSI assertions. Mock `GetCommand`/`UpdateCommand`/`DeleteCommand` in the existing Bun test harness; set up a successful metadata Get before successful message-list queries, test missing/unowned 404, owned-empty 200, page continuation, and long/whitespace first-message title derivation. Assert save/delete ordering.
10. **Rewrite the old API E2E assumptions** in `e2e/api.spec.ts`: it currently expects `?user_id=` and a 400 when missing, but the new route uses server auth and no user query parameter. Also fix the unauthenticated chat-history expectations; test 401 without credentials and appropriate authenticated flows when Cognito credentials are provided.

**Backend test matrix**

| Scenario                                    | Expected                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| First user save                             | Upsert thread row **before** message; server trims/truncates long prompt at 60, whitespace-only prompt uses `New conversation`, timestamps |
| Later user save                             | Bumps `updatedAt` without overwriting title or `model`                                                                                     |
| Assistant save                              | Message-only write; no metadata call                                                                                                       |
| Thread list                                 | Authenticated user only; all pages; newest first                                                                                           |
| Message list                                | Metadata Get before Query; absent/other-user row returns 404 `Thread not found`; owned empty row returns 200 `items: []`; all pages loaded |
| Rename                                      | Trimmed title persists; unrelated fields untouched                                                                                         |
| PATCH bad/empty title or missing own thread | 400 / 404                                                                                                                                  |
| PATCH model                                 | Validated pair stored and returned; no runtime provider change in this ticket                                                              |
| Delete                                      | Paged messages removed in batches, metadata removed last                                                                                   |
| Partial batch-delete failure                | Metadata retained for retry                                                                                                                |
| Former GSI/Scan path                        | Removed, with no extra fallback                                                                                                            |

**Gate:** `cd apps/vela-api && bun test test/routes/chat-history.test.ts && bun run compile`. Full API suite before acceptance. Reconcile `e2e/api.spec.ts` in this task rather than deferring stale contract assertions.

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
4. Invalidate the thread list after a successful **user** message save (which creates/touches metadata), rename or delete. Assistant saves do not change the thread list. Do not maintain duplicated manual `threads` state on the page.

**Gate:** composable tests cover cache scope on account switch, optimistic rename success/failure, delete invalidation, and list errors.

## Task 4a — Pure chat component extraction (intermediate green commit)

**Add**

- `apps/vela/src/pages/chat/components/ChatMessageList.vue`
- `apps/vela/src/pages/chat/components/ChatComposer.vue`

**Modify**

- `apps/vela/src/pages/chat/AIChatPage.vue`

**Steps**

1. Move only the existing bubble/Markdown/typing UI and scroll-to-bottom behavior to `ChatMessageList`. Preserve `marked` + `DOMPurify` behavior and existing greeting placement.
2. Move only the existing draft input/send UI to `ChatComposer`. Retain `data-testid="llm-chat-input"` and `data-testid="llm-chat-send"` for the already-running `e2e/llm-settings.spec.ts` suite.
3. Leave the history dialog, API calls, page behavior, and **existing `AIChatPage.test.ts` assertions unchanged** during this step. This provides a regression gate on the pure extraction.
4. Run the unchanged chat page test and mocked settings Playwright checks, and commit this extraction **to the same PR** before rewriting the navigation.

**Gate:** Existing `AIChatPage.test.ts` and `llm-settings.spec.ts` tests remain green without behavior-specific rewrites.

## Task 4b — Sidebar, rename/delete, and automated responsive behavior

**Add**

- `apps/vela/src/pages/chat/components/ChatSidebar.vue`
- `apps/vela/e2e/chat-sidebar.spec.ts`
- `apps/vela/src/pages/chat/utils/formatTime.ts`
- `apps/vela/src/pages/chat/utils/formatTime.test.ts`

**Modify**

- `apps/vela/src/pages/chat/AIChatPage.vue`
- `apps/vela/src/pages/chat/AIChatPage.test.ts`
- `apps/vela/e2e/fixtures/syntheticAuth.ts`
- `apps/vela/playwright.mocked.config.ts`

**Steps**

1. Build `ChatSidebar` with New chat, scrollable thread list, active highlight, relative `updatedAt`, loading/empty/error states, inline rename (Save/Enter, Cancel/Escape), row delete menu and confirm trigger. Use feature-local pure `formatRelativeTime(timestamp: number, now = Date.now()): string` backed by `Intl.RelativeTimeFormat` instead of inline date math. In its small Vitest test, cover just-now, minutes, hours, days and future-clock-skew/zero boundaries. Emit intents; don't introduce another store.
2. **Desktop:** place `ChatSidebar` in a fixed-width flex `<aside>` beside the message column. **Mobile:** render that same component inside a left-positioned `q-dialog` toggled from the chat header. Keep `MainLayout.vue` unchanged, no nested `q-layout`. Replace `.chat-page { min-height: 100vh }` with a **bounded viewport-height** rule accounting for MainLayout's current `min-height: 60px` toolbar (e.g. `height: calc(100dvh - 60px); box-sizing: border-box; overflow: hidden`), use `min-height: 0` on flex descendants, independently `overflow-y: auto` on the sidebar/list, and prevent header/composer shrinkage. Account for the main nav mini rail and chat column at 375px; avoid hardcoding 50px or allowing the body to scroll to the composer.
3. Remove the old history dialog, retain the existing delete confirmation, and coordinate `useChatThreads` with Pinia chat state, thread selection, loading and delete behavior. Deleting the active thread starts a fresh chat + greeting. New chat stays in memory until a user save succeeds.
4. In `onSend` set `chat.isLoading` **before** awaiting user-message persistence; await user save, LLM request, and assistant save in sequence, making save failures nonfatal for the LLM but visible as warnings. Block thread-select/new/delete while the entire sequence settles. Keep the current HPA-755 provider/model/key snapshot; no HPA-758 picker.
5. Replace obsolete history-dialog page assertions and add tests for sidebar, selection, greeting, rename/rollback, delete/cancel/error, busy gating, ordered saves, user-specific cache and existing Markdown sanitization.
6. Extend `syntheticAuth.ts`'s mocked API with in-memory per-user thread rows and per-thread message arrays. Respond to `POST /save`, `GET /threads`, `GET /messages`, `PATCH /thread/:id` and `DELETE /thread/:id`. Do not let unmocked requests silently pass (existing router fails them with 500).
7. Edit `playwright.mocked.config.ts`'s `testMatch` to include the **new** `chat-sidebar.spec.ts` as well as the existing `llm-settings.spec.ts`. Add one synthetic Playwright flow at **1280px and 375px**: sidebar visible or togglable, send creates a row, rename persists after reload, delete active thread resets to greeting. Add a long-message/long-thread case verifying the chat page stays within the viewport, sidebar and messages can scroll independently, and the composer stays visible. Assert coexistence with the main navigation. Keep the existing LLM settings chat-request specs green.

**Frontend test matrix**

- Desktop `<aside>` and mobile `q-dialog` independently from the global nav; long content cannot expand page height or push composer out of view.
- Empty/list/loading/error states, selection restoration, greeting, current thread highlight and New chat.
- Rename Enter/Save/Escape, server rollback, delete confirmation/cancel/success/error, active deletion.
- Pure relative-time helper test covering just now, minutes/hours/days and future clock skew; no `messageCount` dependency.
- In-flight send blocks destructive navigation; saves run in order; LLM request still uses current Settings.
- Existing `llm-chat-input` and `llm-chat-send` E2E selectors, chat rendering and error notifications remain intact.
- Stateful synthetic browser flow at both widths covers the actual changed UI.

**Gate:** `cd apps/vela && bunx vitest run src/pages/chat/AIChatPage.test.ts src/composables/queries/useChatThreads.test.ts src/pages/chat/utils/formatTime.test.ts`, then `bun run test:e2e:mocked`, full web unit tests, lint and build.

## Task 5 — Consolidated verification and handoff

Run from a clean checkout after installing workspace dependencies and building `@vela/common` where required:

```sh
cd packages/common && bun run build && bun run test:unit
cd ../../apps/vela-api && bun test test/routes/chat-history.test.ts && bun run compile
cd ../vela && bun run test:unit && bun run lint && bun run build && bun run test:e2e:mocked
cd ../../packages/cdk && bun run test:unit && bun run cdk:synth
```

The mocked Playwright run **must include both** `llm-settings.spec.ts` and `chat-sidebar.spec.ts`; it is part of CI's mocked-settings job, not a manual optional smoke. Ensure the new spec covers desktop 1280px and mobile 375px, includes long-history viewport/scroll containment, and preserves existing LLM request selectors.

**Manual only where mocks are insufficient:**

1. With a real authenticated local/staging environment, verify thread create/rename/reopen/delete survives a reload and that user A cannot read, rename or delete user B's thread.
2. If a native/physical device is available, optionally spot-check the mobile keyboard and main-navigation interaction. This is not a substitute for the deterministic mocked responsive test.
3. Review against Linear "Done when"; capture exact test commands and results. If live credentials/deployment are unavailable, name the blocker rather than claim acceptance.

## Explicit stop line

All implementation steps, review feedback, and tests remain in **one** HPA-756 draft PR. Do not start HPA-758 in this PR, modify unrelated Settings/TTS/profile code, implement data backfills, or add chat abstractions for hypothetical consumers. Keep HPA-756 active until implementation and acceptance are complete; only then consider HPA-758 unblocked.
