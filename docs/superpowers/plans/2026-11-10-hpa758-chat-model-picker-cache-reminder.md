# HPA-758 — Chat model picker and cache reminder: single-PR implementation plan

**Date:** 2026-11-10  
**Linear:** https://linear.app/cwchanap/issue/HPA-758/add-chat-model-picker-and-prompt-cache-expiry-reminder  
**Design:** [HPA-758 chat model picker and cache reminder design](../specs/2026-11-10-hpa758-chat-model-picker-cache-reminder-design.md)  
**Delivery rule:** One HPA-758 PR. This draft starts with the design + plan only. Commit all later code, test changes, and review revisions to this same branch/PR. No implementation PR or separate "phase" tickets.

## Why this task is next

HPA-754 (shared provider registry), HPA-755 (per-provider settings/keys), and HPA-756 (chat sidebar + thread model PATCH) are all Done and already merged. HPA-758 is Todo and has no dedicated PR. HPA-757 (TTS) is also unblocked but independent. HPA-824/HPA-833 remain backlog follow-ups, not prerequisites.

## Design decisions to preserve

- Use the existing LLM_PROVIDER_REGISTRY, settings store, capabilities query, chat page, LlmResponse usage, chat-history service, and thread metadata table.
- Chat model is per-thread; new chats start from Settings. Optional thinking is a **temporary current-chat override**, not a new saved preference field. The backend already applies model defaults when thinking is omitted.
- Model PATCH is already supported; extend only that contract for optional lastLlmAt. No new table, cache database, GSI, billing/cost API, event bus, or global settings mutation.
- Show a cache **estimate** only when cachedInputTokens or cacheWriteTokens is positive and provider cacheTtlSeconds is non-null. Elapsed 30-minute OpenAI windows are not guaranteed actual eviction.
- One PR for the entire ticket. Keep testable local helpers, but do not extract a generic model-picker framework or standalone caching subsystem.

## Task 1 — Extend existing thread metadata PATCH/list contract

**Files**

- apps/vela-api/src/validation.ts
- apps/vela-api/src/routes/chat-history.ts
- apps/vela-api/test/routes/chat-history.test.ts
- apps/vela/src/services/chatHistoryService.ts
- apps/vela/src/services/chatHistoryService.test.ts
- apps/vela/src/composables/queries/useChatThreads.ts
- apps/vela/src/composables/queries/useChatThreads.test.ts

**Steps**

1. Add optional lastLlmAt (positive epoch milliseconds) to thread list/response DTO. In PATCH, accept integer milliseconds or explicit null to clear; reject invalid values and empty patches.
2. Reuse the existing conditional UpdateCommand keyed by authenticated user + thread ID. Build SET and REMOVE clauses for title, model, lastLlmAt. Model change should clear lastLlmAt **atomically** in the same PATCH from the UI. A cache-only timestamp update must not bump updatedAt or reorder the sidebar; title/model updates retain the current monotonic updatedAt semantics.
3. Return lastLlmAt from GET /threads; DynamoDB is schemaless, so existing rows simply have no value. Do not touch message-table structure, API auth, user-scoped keys, or CDK.
4. Extend PatchChatThreadDTO and ChatThreadSummaryDTO. Reuse the current thread mutation/optimistic list cache; rename useRenameThread to useUpdateThread if needed so model updates do not use misleading method names. Do not optimistically assign a cache timestamp before confirmed usage.
5. Test: GET includes/missing timestamp; PATCH set/clear/combine with model/title; invalid/empty 400, unowned/missing 404, untouched title/model retained, cache-only PATCH leaves updatedAt unchanged, failed optimistic model update rolls back; existing rename/delete behavior remains green.

**Gate:** API chat-history tests, API compile, chat-history service/mutation tests pass.

## Task 2 — Wire per-thread model selection into the existing chat page

**Files**

- apps/vela/src/pages/chat/AIChatPage.vue
- apps/vela/src/pages/chat/components/ChatModelPicker.vue (new, small feature-local UI)
- apps/vela/src/pages/chat/components/ChatModelPicker.test.ts (new)
- apps/vela/src/pages/chat/AIChatPage.test.ts
- apps/vela/src/stores/chat.ts (only if current active selection must survive page remount; prefer existing state + thread query)
- apps/vela/src/composables/queries/useLlmCapabilitiesQuery.ts (reuse unchanged if possible)

**Steps**

1. Derive grouped, available model options from the registry, saved provider keys, and affirmative capability results. Only Google/OpenRouter may rely on server keys. Show missing-capabilities retry and unavailable current-thread choice without silently switching it. Include a validated custom OpenRouter model-ID input.
2. Add the compact model select and optional thinking select to the chat header without changing ChatComposer, global MainLayout drawer, or ChatSidebar. Use one narrow-screen layout and keep existing chat/test selectors intact.
3. Maintain the active model as one { provider, model } value for the current chat; when selecting a thread, use row.model or Settings default. Starting a new chat resets to Settings default. On a saved thread, PATCH a model change before making it active; on rejection show an error and retain the old model. On a fresh thread, keep the choice locally until the first user save creates the row, then PATCH before calling the LLM.
4. Resolve key and thinking for **the active selection**, not llmSettings.selection (which follows the global Settings default). Default thinking is saved per-model preference if present, otherwise the registry's default; explicit chat thinking is allowed only from that model's efforts and never writes Settings. Hide thinking for OpenRouter; reset the temporary override when model/thread changes.
5. Keep onSend's existing user-save -> generate -> assistant-save ordering, loading lock, account/session generation guard, and full-history request. Snapshot provider/model/key/thinking immediately before generate; do not send a stale selection after an async thread switch. Preserve missing-key/server-capabilities errors as a visible actionable message.
6. On restartDeletedChat, persist the active model on the fresh thread after the new user row exists. Ensure the new ID gets no cache indication inherited from the deleted thread.
7. Test: new-chat default; provider-key and server-key option filtering (including failed capability lookup); OpenRouter ID; valid effort options and ephemeral override; persisted-thread reopen; model PATCH rollback; first user message PATCH ordering; mid-chat switch sends complete history to the new model with the right key; deleted-thread retry/account-switch race.

**Gate:** Component and AIChatPage unit tests pass; existing sidebar and settings tests still pass.

## Task 3 — Add the evidence-gated cache timer and persistence

**Files**

- apps/vela/src/pages/chat/utils/cacheReminder.ts (new, pure helper)
- apps/vela/src/pages/chat/utils/cacheReminder.test.ts (new)
- apps/vela/src/pages/chat/components/ChatCacheReminder.vue (new, small)
- apps/vela/src/pages/chat/components/ChatCacheReminder.test.ts (new)
- apps/vela/src/pages/chat/AIChatPage.vue
- apps/vela/src/pages/chat/AIChatPage.test.ts

**Steps**

1. Implement a pure function accepting provider, lastLlmAt, and now. Return hidden/warm/warning/elapsed state, bounded remaining seconds, and M:SS. TTL comes only from LLM_PROVIDER_REGISTRY.cacheTtlSeconds. Hide for Google/OpenRouter or absent evidence.
2. Drive the chip via one page-local clock tick (one-second interval while mounted, clean up on unmount). Small neutral warm state; warning for strictly less than 60 seconds; elapsed-window copy at zero. Do not present guaranteed cache hits, evictions, or billing claims.
3. Record Date.now() **immediately before** llmClient.generate. After a successful response, inspect usage.cachedInputTokens/cacheWriteTokens. Positive usage on a supported provider permits lastLlmAt = requestStart; zero usage clears lastLlmAt; errors do not synthesize a refresh. Wait until assistant history is saved before PATCHing the timestamp to the existing thread; do not turn a cache PATCH failure into a failed response.
4. Model PATCH includes lastLlmAt: null, clearing evidence on model switch. New chat, thread switch, deleted-thread restart, sign-out, and account changes also reset local chip state. A reloaded thread with lastLlmAt computes its current state from the persisted timestamp and selection.
5. Test exact boundaries: no evidence; positive cached read and positive write independently; 5:00, 1:00, 0:59, 0:00; future clock skew; countdown while idle; OpenAI 30m, Anthropic 5m, Gemini/OpenRouter hidden; response-start vs completion timestamp; zero usage; request error; cache PATCH failure; new provider/model/thread/user isolation; persisted reload.

**Gate:** Cache pure-function/component tests and AIChatPage regression tests pass with fake clocks and mocked APIs.

## Task 4 — Mocked browser verification and final acceptance

**Files**

- apps/vela/e2e/chat-sidebar.spec.ts (extend existing authenticated desktop/mobile scenario)
- apps/vela/e2e/fixtures/syntheticAuth.ts (adjust only required mock responses)
- apps/vela/e2e/llm-settings.spec.ts (keep existing Settings behavior unchanged)
- docs/superpowers/specs/2026-11-10-hpa758-chat-model-picker-cache-reminder-design.md
- docs/superpowers/plans/2026-11-10-hpa758-chat-model-picker-cache-reminder.md

**Steps**

1. Mock registry-backed providers, user keys/capabilities, chat response usage, thread GET/PATCH and send history. Exercise desktop and ~375px mobile: model select, send, reload, restore, switch provider mid-chat, display near-expiry vs elapsed, and hide on zero usage/Gemini.
2. Verify no hidden duplicate navigation, no regression to model Settings, and no overflow in the narrow header/composer. Confirm existing renamed/deleted thread behavior and authentication isolation remain intact.
3. Run the applicable commands from repo root (use focused test files during development):
   - bun --filter vela-api test:unit
   - bun --filter vela-api compile
   - bun --filter @vela/app test:unit
   - bun --filter @vela/app test:e2e:mocked
   - bun run lint
   - bun run typecheck
   - bun --filter @vela/app build
4. Optional live check with the user's own provider keys: two-turn Japanese chat under Anthropic/OpenAI, confirm usage is actually nonzero when long enough, verify stored model/timestamp after reload. This is an **acceptance check**, not a unit-test claim; do not require a paid provider call or silently send one without appropriate authorization. A synthetic browser check does not prove live cache hits.
5. Update these same design/plan documents with review decisions and verification receipts, still on this single PR. Merge only once acceptance is satisfactory; do not move HPA-758 to Done from the docs-only submission.

## Risk and deferral notes

| Risk | Smallest acceptable handling |
| --- | --- |
| First message has no thread row yet | Persist user message first, then model PATCH before generate |
| A model changes after a cache hit | Atomically set model and clear lastLlmAt |
| Provider says zero cached tokens | Hide/clear chip; don't invent cache creation |
| Provider may retain a cache beyond 30m or route to a different machine | Label as estimated window and say **may** miss cache |
| Device clock differs across browsers | Best-effort epoch-ms timer; defer server clock synchronization |
| Model selection PATCH fails | Retain old model on existing thread; notify if fresh-thread choice did not persist |
| Other browser edits same thread concurrently | Defer precise cross-client CAS for this hobby-scale feature |
| No credentials for live LLM smoke | Complete mocked automated gates and list live verification as pending |

## PR review checklist

- [ ] Every acceptance item in HPA-758 maps to one test or explicit manual check.
- [ ] Shared provider registry and existing thread PATCH are reused; no new infrastructure or dependency.
- [ ] Chat model selection is separate from Settings default; thinking override scope is explicit.
- [ ] Only confirmed cache usage causes a timer; warning copy does not promise billing outcomes.
- [ ] Model, timestamp and chat state are identity/thread scoped; no stale async result changes the current chat.
- [ ] Focused tests, full relevant checks, and mocked mobile/desktop flow are recorded on this same PR.
