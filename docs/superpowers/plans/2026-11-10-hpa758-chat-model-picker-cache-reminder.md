# HPA-758 — Chat model picker and cache reminder: single-PR implementation plan

**Date:** 2026-11-10; revised 2026-11-11  
**Linear:** https://linear.app/cwchanap/issue/HPA-758/add-chat-model-picker-and-prompt-cache-expiry-reminder  
**Design:** [Reconciled HPA-758 design](../specs/2026-11-10-hpa758-chat-model-picker-cache-reminder-design.md)  
**Reviews:** https://github.com/cwchanap/Vela/pull/84#pullrequestreview-5855374846 and https://github.com/cwchanap/Vela/pull/84#pullrequestreview-5863703520  
**Delivery:** This same draft PR #84 contains documentation now, implementation/tests/review fixes next. **One PR for this ticket**, no second implementation PR.

## Alignment and decisions

HPA-754, HPA-755 and HPA-756 have merged; HPA-758 is In Progress. Keep HPA-757 (TTS), HPA-824 (profile CAS) and HPA-833 (preference tombstones) separate. Follow YAGNI: extend the existing chat store, model settings, thread save/patch endpoints and shared registry. No new dependency, DynamoDB table/GSI, API endpoint, LLM transport change, backfill, cache service or billing logic.

The [design review](https://github.com/cwchanap/Vela/pull/84#pullrequestreview-5855374846) was **accepted in full**:

1. Active model, temporary thinking override and cache timestamp belong in the existing Pinia chat store, since that store survives route changes.
2. Extract the already-shipped Settings model-option logic to one pure helper and add llmSettings.selectionFor(pair), reused by default Settings selection and the Chat picker. Do not fork provider rules, key/thinking lookup, custom OpenRouter ID or available-option handling.
3. Store lastLlmAt in the **assistant-message save transaction**, not a second cache-only PATCH. Missing evidence removes the timestamp. The backend removes lastLlmAt automatically when model PATCH changes the model. PATCH schema stays unchanged.
4. Include model on the **first user-message save** (if_not_exists), not a new-thread PATCH between save and generate. Existing saved-thread picker changes still use model PATCH.
5. Replace root bun run typecheck (which only covers mobile in this repo) with the actual affected gates: vela-api compile and @vela/app build (vue-tsc via Vite checker).
6. Rename useRenameThread to **useUpdateThread** (title + model), clear the optimistic lastLlmAt when model changes, and place the small chip **above ChatComposer**, not inside the header.

## Task 1 — API save/list metadata and mutation contract

**Modify**

- apps/vela-api/src/validation.ts
- apps/vela-api/src/routes/chat-history.ts
- apps/vela-api/test/routes/chat-history.test.ts
- apps/vela/src/services/chatHistoryService.ts
- apps/vela/src/services/chatHistoryService.test.ts
- apps/vela/src/composables/queries/useChatThreads.ts
- apps/vela/src/composables/queries/useChatThreads.test.ts
- apps/vela/src/composables/queries/useChatThreads.auth.test.ts (where affected)
- apps/vela/src/composables/queries/index.ts (export rename)

**Steps**

1. Extend ChatHistoryItemSchema with optional model pair and positive-integer lastLlmAt. Consume model only for a user turn and lastLlmAt only for an assistant turn. The API continues to overwrite authenticated UserId and server Timestamp. No need to add either to messageItem.
2. On **user** save, conditionally append model = if_not_exists(model, :model) to the current metadata Update inside the existing message/metadata transaction when supplied. Its fallback for a stale updatedAt still requires an alive thread. Keep server-derived title, monotonic updatedAt, and existing deletion fencing. A new row is created with its active model; an existing stored model is never overwritten by a later user save or by the first-save retry.
3. On **assistant** save, replace the thread ConditionCheck in the current transaction with a conditioned Update carrying the unchanged THREAD_ALIVE_CONDITION. SET lastLlmAt when the optional positive timestamp is supplied; otherwise REMOVE lastLlmAt. Keep the separate message Put. Do **not** bump updatedAt or add a second request. In the REMOVE-only branch, **omit ExpressionAttributeValues entirely**, not `{}` or unused placeholders; the alive condition requires no values. In the SET branch include only `:lastLlmAt`. Missing/deleted rows still reject with 404.
4. In the existing model PATCH code, append REMOVE lastLlmAt when patch.model is present, regardless of whether title is also patched. Title-only updates retain timestamp. No lastLlmAt in PatchChatThreadSchema and no null semantics. Keep current 404/400 and identity conditions.
5. Include optional lastLlmAt in GET /threads explicit projection and ChatThreadSummaryDTO; leave existing rows without it untouched. Update saveChatMessage and useSaveChatMessage to accept typed optional metadata. Keep user/query-key scope. On successful assistant save, update the cached thread list lastLlmAt in place, without changing updatedAt or triggering a redundant fetch.
6. Rename the generic title/model mutation to useUpdateThread and update its callers/exports. Optimistic model patch clears the cached lastLlmAt, rolls back old model/timestamp on error, and invalidates on settle. Title-only rename still behaves as before.
7. Tests: first user save sets model and title atomically; subsequent save cannot replace a manually chosen model; model omitted is legal; assistant save with/without cache evidence runs conditioned metadata SET/REMOVE + message Put, no updatedAt bump; assert no ExpressionAttributeValues key on REMOVE and exactly one timestamp value on SET; delete barrier and 404; list fields; PATCH model clears timestamp, title-only preserves; optimistic update/rollback; user scope.

**Gate:** Focused Bun API tests and vela-api compile; service/composable unit tests. No runtime code or tests are included in the current docs-only submission.

## Task 2 — Shared options and Pinia-owned chat selection

**Modify**

- apps/vela/src/pages/settings/components/LlmProvidersSection.vue
- apps/vela/src/pages/settings/components/LlmProviderCard.vue
- apps/vela/src/stores/llmSettings.ts
- apps/vela/src/stores/chat.ts
- apps/vela/src/pages/chat/AIChatPage.vue
- apps/vela/src/pages/chat/AIChatPage.test.ts
- apps/vela/src/pages/settings/components/LlmProvidersSection.test.ts and LlmProviderCard.test.ts
- apps/vela/src/stores/chat.test.ts and llmSettings.test.ts

**Add**

- apps/vela/src/utils/llmModelOptions.ts and llmModelOptions.test.ts
- apps/vela/src/pages/chat/components/ChatModelPicker.vue and ChatModelPicker.test.ts

**Steps**

1. Extract a **pure** utility from Settings for provider-encoded model options, registry model lists and efforts, available-key/capability filtering, an unavailable-current display option, and the OpenRouter custom-model entry. Share it with Settings and Chat without changing Settings save/draft behavior. Let /llm-chat/capabilities be the source of server-key eligibility; a failed lookup means no server-key-only choices.
2. Add selectionFor({ provider, model }) in llmSettings to return provider/model, its saved key and that model's saved effort override. Have the existing computed selection delegate to selectionFor(global default). Avoid reimplementing this in the chat page; existing backend normalizer remains the validator.
3. Add activeModel, thinkingOverride, cacheStartedAt, **isPersistedThread: boolean**, plus small setters to the existing Pinia chat store. startNewChat/resetForUser reset all four (persistence flag = false). AIChatPage explicitly seeds fresh activeModel from Settings when creating a new chat / first mounting a new account; **do not reset an existing active model on route remount**. Selecting a thread, after existing stale checks, restores row.model (or Settings default) and row.lastLlmAt and clears its ephemeral thinking choice. restartDeletedChat retains selected model but clears stale cacheStartedAt.
4. Show grouped model options in a compact ChatModelPicker in the chat **header** and optional native effort select next to it. **At 375px, wrap the header into two rows:** menu + visible title, then full-width model and compact thinking controls (model flex/min-width: 0, thinking width bounded). Do not force all controls into the available 327px single-row content area. For a free-form OpenRouter model ID require nonempty trimmed input. Render the unavailable current model clearly and prevent silent fallback. Thinking choices are Default (saved thinking/registry fallback) plus the model's supported efforts; OpenRouter hides effort control.
5. **Guard PATCH with chat.isPersistedThread, never Boolean(chat.chatId)**: the UUID exists before the metadata row. Set the flag true on successful first user-message save or saved-thread selection, false after New chat/account switch/deleted-thread restart. Do not rely solely on `threads.value.some(...)` because the query cache may lag a successful save. Saved-thread model changes await the existing PATCH /thread/:id mutation before changing store.activeModel; disable sending/model edits while pending and rollback on error. Fresh-thread model changes update local store immediately; the **first user save carries the model** (no model PATCH). Subsequent user saves also may carry it as a harmless if_not_exists. Preserve full chat history across model changes.
6. Snapshot selectionFor(activeModel), any temporary thinking override, correct provider key and authenticated identity right before llmClient.generate; never use llmSettings.selection for a thread-specific choice. Guard async updates by operation + session generation, and block send for unavailable choices with a helpful key/capabilities hint. Do not write global Settings.
7. Tests: Settings reuse and defaults unchanged; capability success/error, user key vs confirmed server key, custom OpenRouter, effort options, unavailable stored model; fresh chat default; navigation away/back preserves model + transcript; reload from thread row; first user save carries model; changing models before first send produces no PATCH despite non-null chatId; after successful save a model change PATCHes even if the thread list remains stale; failed save leaves flag false; saved-thread PATCH rollback; mid-chat complete-history request with new provider and key; pending locks, account switch and deleted-thread replacement.

**Gate:** app unit/component suites for Settings, chat store and Chat page, plus existing sidebar tests.

## Task 3 — Cache evidence, one timer and assistant-save persistence

**Add**

- apps/vela/src/pages/chat/utils/cacheReminder.ts and cacheReminder.test.ts
- apps/vela/src/pages/chat/components/ChatCacheReminder.vue and ChatCacheReminder.test.ts

**Modify**

- apps/vela/src/pages/chat/AIChatPage.vue and AIChatPage.test.ts
- apps/vela/src/stores/chat.ts and chat.test.ts

**Steps**

1. Add pure cacheReminder(provider, cacheStartedAt, now) returning hidden/warm/warning/elapsed + bounded remaining seconds and M:SS. Use only LLM_PROVIDER_REGISTRY.cacheTtlSeconds (Anthropic 300 s / OpenAI 1800 s / null for Google and OpenRouter). At 60 s still warm, at 59 s warn, at 0 show elapsed. Set `MAX_ELAPSED_WINDOW_SECONDS = 300`: return hidden once `now - cacheStartedAt > TTL + 300 seconds`, including when reopening old persisted threads. This is display-only; keep the stored timestamp.
2. Place ChatCacheReminder **directly above the composer input** and below messages, rather than in the already busy mobile header. Use a **single page-local 1 s setInterval**, cleared on unmount. No library, background sync, keep-alive or polling.
3. Capture Date.now() immediately before the LLM request. On successful response, cache evidence = cachedInputTokens > 0 OR cacheWriteTokens > 0. If positive and the provider has a TTL, set the chat store cacheStartedAt to the request-start time, and include lastLlmAt in the pending **assistant save**; otherwise clear cacheStartedAt and omit lastLlmAt so the same transaction REMOVEs old evidence. Errors don't synthesize a fresh timer.
4. Keep the existing user-save → generate → assistant-save order and deletion-restart logic. The timestamp is persisted only when the assistant save commits; a successful response with failed history save can show a local estimate but cannot claim a durable cache marker. After a deleted-thread restart, first re-save the user turn with model, then replay assistant with this response's evidence; clear any old evidence before replay.
5. On saved-thread model PATCH, the server clears lastLlmAt atomically, and the client optimistic row + chat store clear the current timer. Selecting a thread/reloading copies optional lastLlmAt into chat store after identity/staleness guards. Successful assistant save patches the local query cache without updating sidebar updatedAt.
6. Tests with fake time: evidence only on positive reads/writes; 5:00, 1:00, 0:59, 0:00, elapsed exactly at TTL+300 s, hidden at TTL+301 s even after historical-thread reload, and future skew; request start vs completion time; zero cache, request error and failed assistant save; model/thread/user switch, route navigation, reload; Gemini/OpenRouter hidden; no invalid optimistic cache timestamp or extra PATCH.

**Gate:** Pure helper, component and AIChatPage tests pass with fake clocks and mocked API.

## Task 4 — Mocked browser checks and acceptance

**Modify**

- apps/vela/e2e/chat-sidebar.spec.ts
- apps/vela/e2e/fixtures/syntheticAuth.ts (only necessary request mocks)
- apps/vela/e2e/llm-settings.spec.ts (verify regression, change only if needed)
- these same spec/plan docs for tested receipts

**Steps**

1. Mock provider keys, capability GET, chat usage, thread list, PATCH and user/assistant saves. Exercise selection, mid-chat switching with full history, saved-thread persistence after reload, cache warm/near-expiry/elapsed/hidden, custom OpenRouter and failed capability lookup.
2. **Explicitly call page.setViewportSize({ width: 375, height: 812 })** for mobile within chat-sidebar.spec.ts. The mocked Playwright config defines only a Desktop Chrome project; without a manual viewport change no mobile layout is exercised. Assert at 375px that navigation/title occupy header row 1, model/effort selectors occupy row 2 and remain usable; verify no horizontal overflow (document.scrollWidth <= clientWidth) and composer remains visible. Also verify desktop width and existing rename/delete and Settings scenarios.
3. Run affected gates (focused tests first, then project):
   - bun --filter vela-api test:unit
   - bun --filter vela-api compile
   - bun --filter @vela/app test:unit
   - bun --filter @vela/app test:e2e:mocked
   - bun run lint
   - bun --filter @vela/app build (vue-tsc checker)
   - **Do not list root bun run typecheck as verification for this ticket**; it currently only covers @vela/mobile.
4. Optional explicitly authorized live Japanese two-turn provider checks verify real response usage and persistence. Do not claim mocked tests prove real cache hits, make paid calls without authorization or block the draft spec on an unavailable credential.
5. Record real test outcomes and any review-driven revisions on this same PR. Keep the PR draft until implementation and acceptance; do not mark Linear Done from docs alone.

## Risk and deferral notes

| Risk                                              | Minimal handling                                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh chat has no metadata row                    | Pinia isPersistedThread is false until successful first save; UUID alone never triggers PATCH, stale thread list cannot block a real persisted-thread PATCH |
| Cache evidence and assistant message must agree   | One existing transaction SETs/REMOVEs lastLlmAt with assistant Put                                                                                          |
| Model change invalidates old cache marker         | Model PATCH atomically REMOVEs lastLlmAt on server and optimistic client cache                                                                              |
| Route remount retains messages                    | Active model and cache timestamp live in Pinia next to transcript                                                                                           |
| Failed capability fetch                           | Only saved user-key options; explicit retry and block unavailable model                                                                                     |
| Provider eviction/billing is uncertain            | Estimated-window copy, never guaranteed cost or expiry                                                                                                      |
| Same-thread concurrent client edits               | Defer CAS, server clock sync and cross-client reconciliation                                                                                                |
| Synthetic tests cannot verify live vendor caching | Report optional live check separately                                                                                                                       |

## Same-PR acceptance checklist

- [x] Model/key availability and thinking choices share Settings implementation.
- [x] Active model sticks across navigation/reload and is sent on first user save.
- [x] Existing thread PATCH selection persists without silent fallback; rollback on error.
- [x] Assistant save transaction persists or clears cache evidence without a cache-only PATCH.
- [x] Cache chip is evidence-gated, near composer, timer cleaned up, TTL registry-driven.
- [x] API/chat/Settings unit tests, API compile, web build, lint and desktop/mobile mocked browser checks completed and reported.

## Second review reconciliation (2026-11-11)

[Latest review](https://github.com/cwchanap/Vela/pull/84#pullrequestreview-5863703520): all four edge-case findings are valid. The persistence guard is adjusted from the suggested `threads.some(...)` to one tiny `chat.isPersistedThread` flag: the sidebar list may be stale immediately after a successful save. The rest is adopted: five-minute elapsed warning cutoff, 375px two-row header, and no empty DynamoDB ExpressionAttributeValues on REMOVE. These changes remain inside the original four tasks on **this single PR #84**, with no extra infrastructure.

## Final verification (2026-11-12 UTC)

On implementation commit `1a04239`: API unit tests **772/772**, API compile, app unit tests **2166/2166**, root lint **5/5**, app build (vue-tsc), and mocked browser tests **34/34** passed. The mocked browser suite includes desktop and an explicit 375px viewport; no live or paid provider check was performed. App unit output included the expected missing-Cognito-configuration warning in this environment.

A superseded in-flight thread-list fetch may be canceled and replaced to preserve server-derived rows and ordering; this is not a cache-only PATCH. Per the user's decision, PATCHes are serialized per session: an already-dispatched old-session write can still commit after a new session's write. A paused or stalled old-session mutation may retain queue state until page reload, but does not block a new session. Under unusual overlapping edits, cached sidebar `updatedAt` can temporarily lag server truth until the next successful refresh.
