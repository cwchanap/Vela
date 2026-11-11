# HPA-758 — Chat model picker and prompt-cache reminder: design spec

**Date:** 2026-11-10; revised 2026-11-11 after [first review](https://github.com/cwchanap/Vela/pull/84#pullrequestreview-5855374846) and [follow-up review](https://github.com/cwchanap/Vela/pull/84#pullrequestreview-5863703520)  
**Linear:** https://linear.app/cwchanap/issue/HPA-758/add-chat-model-picker-and-prompt-cache-expiry-reminder  
**Prerequisites:** HPA-754/755/756 Done; HPA-756 merged in PR #82  
**Delivery:** All design, implementation, tests and review fixes remain on this one draft PR (#84).

## Goal and bounds

On AI Chat, choose a provider/model with a saved key or verified server-side chat key. Keep the complete transcript when switching models, persist the model per thread, optionally override thinking for the session, and show an **estimated cache-reuse window** after a successful response reports cached reads or writes.

Reuse the existing registry, Settings, LLM usage, chat thread table, user-scoped API and Quasar components. No new database/table/index, endpoint, cache service, billing calculator, remote model discovery, general-purpose framework, or LLM transport rewrite. HPA-757 (TTS), HPA-824 (cross-client preference CAS) and HPA-833 (preference tombstones) are out of scope.

## Verified code seams and review decisions

- packages/common/src/contracts/llm.ts defines LLM_PROVIDER_REGISTRY, effort choices, cacheTtlSeconds (Anthropic 300, OpenAI 1800, Google/OpenRouter null), and LlmResponse.usage.cachedInputTokens/cacheWriteTokens.
- apps/vela/src/stores/chat.ts persists chatId and messages across route navigation. **It must also own activeModel, thinkingOverride, cacheStartedAt and a small isPersistedThread flag** to avoid silent model changes or PATCHing an unsaved chat. startNewChat/resetForUser clear these fields; the chat page seeds the Settings default when starting fresh. Mark the flag true after a successful first user save or saved-thread selection. Avoid relying only on the potentially stale thread-list query.
- apps/vela/src/stores/llmSettings.ts owns keys, saved thinking preferences, and the global default; expose selectionFor(pair) to return the active provider/model/key/saved thinking for **any pair**. Its existing selection computed should delegate to selectionFor(globalDefault).
- Extract the already-shipped model option and effort-option rules from apps/vela/src/pages/settings/components/LlmProvidersSection.vue and LlmProviderCard.vue to one small pure app utility, e.g. src/utils/llmModelOptions.ts. Both Settings and Chat consume it; keep Settings draft behavior and tests intact. It handles registry entries, provider grouping metadata, custom OpenRouter ID, pair encoding, saved keys, capability-based server keys and the display-only unavailable-current option.
- apps/vela/src/composables/queries/useLlmCapabilitiesQuery.ts provides authenticated server-key eligibility; trust only an affirmative capability response, not speculative frontend hardcoded provider permissions. On failure, user-key options remain available and server-key-only options are unavailable.
- apps/vela/src/pages/chat/AIChatPage.vue owns selection/send/restartDeletedChat, and its existing session + operation generation checks must guard async results. A thread metadata row is created by the first **user** message save, not on New chat.
- apps/vela-api/src/routes/chat-history.ts already supports user-scoped thread model PATCH and transactional user/assistant saves. Extend these **existing saves**, rather than adding an extra post-first-save model PATCH or post-assistant-save timestamp PATCH. No changes to the LLM response/transport.
- This reconciliation accepts all six substantive review findings; [PR review](https://github.com/cwchanap/Vela/pull/84#pullrequestreview-5855374846) is the decision record.

## Product behavior — model and thinking

1. Render a compact ChatModelPicker in the **chat header**, beside the mobile conversation button. Group available registered models by provider; provide a single custom OpenRouter model-ID entry/input. Trim and require a nonempty custom ID; backend normalization remains authoritative. **At 375px**, use a responsive two-row header: navigation/title on row one; model and compact thinking controls on full-width row two. Use min-width: 0, flexible model width, bounded effort width, and no horizontal overflow, while preserving the visible title.
2. Build choices from the **shared option utility**, saved provider keys and affirmative server-key capabilities. Reuse the helper in Settings. Do not assume that an unknown capability includes a server key. Keep an unavailable stored/current model visible as a disabled or clearly marked selection, with a configure/retry prompt; never silently substitute another model when sending.
3. A new chat chooses Settings' current default model. Selecting an existing thread loads its stored model, or Settings' current default if absent. The chat store keeps activeModel, thinkingOverride and cacheStartedAt across page unmount/remount. Once a legacy thread without a stored model sends its next user message, that model is pinned on the row.
4. Selecting a different model mid-chat preserves the complete ordered history and uses the selected provider/key for the next LLM request. **Only if chat.isPersistedThread is true** does the picker invoke PATCH /chat-history/thread/:id before activating the new model (disabled UI and rollback on failure). A new chat has a UUID but no stored row: Boolean(chat.chatId) is NOT a persistence check. A fresh-thread change is local, carried on the first user save; mark the flag true only after the server saves it. Clear it on New chat, account change or deleted-thread replacement. Do not use only threads.value.some(...) because list refetch can lag first-save success.
5. Adjacent thinking select offers Default + only the registered model's native effort values (shared effort-option helper). Default means the saved Settings override for that model, else backend registry default. A chat-specific explicit override changes only subsequent requests in this chat; **it is session-only**, not persisted to thread or Settings, and resets on model change, thread switch, new chat, and browser reload. Hide for free-form OpenRouter.
6. Keep model/thinking controls disabled during send and pending model PATCH. Snapshot selectionFor(activeModel) + any explicit chat override immediately before llmClient.generate; supply the correct key (or server-key fallback) and whole transcript. Preserve active model on page navigation; reset all chat-specific fields on account/session switch or sign-out. A deleted-thread replacement keeps the selected model for its replay but clears cache evidence.
7. If no key or confirmed server capability exists, block sending with an actionable settings/retry message. No extra frontend validation machinery beyond option membership and nonempty custom ID.

## Product behavior — cache chip

1. A successful LlmResponse has cache evidence only if cachedInputTokens > 0 **or** cacheWriteTokens > 0. Never infer it from input token counts or prompt length. Capture Date.now() immediately **before** llmClient.generate, not at response completion.
2. Use only LLM_PROVIDER_REGISTRY[provider].cacheTtlSeconds: Anthropic 5 minutes, OpenAI 30 minutes, null hides the chip for Gemini and OpenRouter. These are approximate reuse windows, **not guaranteed eviction or charge estimates**; OpenAI caches may persist longer.
3. Place ChatCacheReminder **directly above the ChatComposer input**, below ChatMessageList. Render nothing until positive usage evidence exists; warm when 60+ seconds remain, warning when 1–59 seconds remain, and an elapsed-window warning at zero **for no more than five minutes after TTL**. Beyond that, hide it, including when reopening an old thread. Copy: 'Cache likely warm · M:SS left', 'Cache window · M:SS left', 'Cache window elapsed · next message may miss cache'. No guaranteed billing wording.
4. One page-local 1-second interval updates a pure cacheReminder(provider, cacheStartedAt, now) function; clear the interval on unmount. Clamp remaining seconds to [0, TTL], including future client timestamps. Define MAX_ELAPSED_WINDOW_SECONDS = 300 as the display-only grace period after TTL: if now - cacheStartedAt > (TTL + 300) seconds, return hidden rather than a permanent warning. Timestamp is epoch milliseconds from **request start**; do not remove stored evidence only because the chip hides.
5. On a successful response, positive cache evidence refreshes the current chat store's cacheStartedAt; zero/absent usage clears it; errors do not create evidence. A failed assistant history save may leave a **local** chip for the successful response, but no persisted timestamp is claimed. While the next request is in flight, keep the previous estimate until new usage is known.
6. The existing **assistant-message save** carries optional lastLlmAt when positive cache evidence exists. The backend atomically SETs that timestamp on the existing thread row, or REMOVEs it if absent, **in the same DynamoDB transaction as the assistant message**. No extra HTTP request and no updatedAt bump. This preserves consistency with a successfully saved assistant turn.
7. Changing a stored model via PATCH **always removes lastLlmAt on the server**, in the same thread update, without accepting timestamp fields in PATCH. The optimistic client thread cache also drops lastLlmAt on a model change, restoring the old row on failure. Successful assistant-save responses update the cached thread summary locally without a redundant GET or updatedAt bump.
8. GET /threads returns optional lastLlmAt, and thread selection restores cacheStartedAt from that row. Model switch, thread switch, New chat, deleted-thread restart, sign-out or user change cannot reuse the previous thread's cache evidence.
9. Do not send a keep-alive request, auto-reply, or background refresh; no cross-device clock correction or cross-tab CAS.

## Minimal HTTP and database contract

Use the existing POST /chat-history/save, PATCH /chat-history/thread/:id and GET /chat-history/threads endpoints, all behind requireAuth and the current per-user thread access rules.

| Operation | Input change | Effect on existing thread metadata |
| --- | --- | --- |
| User-message POST /save | Optional model: { provider, model } for user turns | In the existing transaction, add model = if_not_exists(model, suppliedModel) to the row-creating Update (only when supplied). Never overwrite a later picker PATCH; preserve title/createdAt and monotonic updatedAt. Message row remains unchanged. |
| Assistant-message POST /save | Optional positive integer lastLlmAt; omit for zero cache evidence | Convert the existing metadata ConditionCheck into a conditioned Update in the message-write transaction. SET lastLlmAt when present, otherwise REMOVE it; do not touch updatedAt or the message row. **Omit ExpressionAttributeValues** entirely for REMOVE (no empty object or unused placeholders); the alive condition uses only attribute names. Missing/deleted thread still returns 404. |
| PATCH /thread/:id model | **No schema change**; existing { model } | Existing conditional user-scoped Update SETs model and REMOVEs lastLlmAt together. Title-only PATCH does not remove it. Model PATCH continues to update updatedAt. |
| GET /threads | No request change | Include optional lastLlmAt in the explicit list projection and resulting client DTO; absent on old rows is valid. |

ChatHistoryItemSchema adds optional model and lastLlmAt, consumed only for their corresponding user/assistant turns. The server still overwrites UserId and Timestamp; messageItem continues picking fields explicitly so neither metadata field leaks into message rows. PATCH schema still only accepts title/model, and no lastLlmAt:null contract is introduced. Existing thread tombstone / transaction fencing remains intact. Do not add backward-compatibility paths or migrate old rows.

Client: extend saveChatMessage/useSaveChatMessage with typed optional metadata, extend ChatThreadSummaryDTO with lastLlmAt, and rename useRenameThread to **useUpdateThread** (used by both title and model changes). **Gate model PATCH on chat.isPersistedThread** (seeded by successful first save or saved-thread selection), not a non-null UUID or solely the sidebar query. On assistant-save success, update the user-scoped in-memory thread list timestamp directly; preserve its updatedAt.

## Failure behavior and deferrals

- Model PATCH failure on a persisted thread: leave activeModel and cacheStartedAt unchanged, show error, and restore optimistic query state; avoid a hidden model swap.
- User save failure: preserve existing nonfatal history warning/LLM-generation behavior, but never claim that a new thread/model was persisted.
- Assistant save 404/deleted thread: use the existing restartDeletedChat replay, carry the selected model on the replacement user save, and clear stale cache evidence before assigning any usage for the recovered response.
- Operation/session generation checks suppress late responses from another thread/user. Documented cross-client simultaneous edits, exact cache-hit prediction, and clock skew stay deferred.
- No new shared abstraction beyond one tiny pure model-option helper and one feature-local cache helper; no native mobile work or art/SFX.

## Acceptance

- Saved and server-key-eligible provider options are consistent between Settings and Chat; OpenRouter custom ID works; failed capability checks cannot introduce unusable options.
- Current model and history survive navigation/reopen; next request uses the selected model/key/thinking; first user save pins model without extra PATCH; saved-thread PATCH persists even before sending.
- Changing model clears cached evidence; a positive cache read/write after assistant save persists lastLlmAt without changing sidebar updatedAt; a zero-cache response removes it.
- Cache chip only appears for evidenced TTL-based providers, ticks at 1-second boundaries, and clearly describes an estimated window.
- Targeted tests cover navigation-away/back, model patch rollback, account change, deleted-thread replay, first-user-save payload, assistant-save transaction, cache visibility/boundaries, mobile header/composer and Settings nonregression. Design-only submission does not claim test results.

## Follow-up design-review resolution (2026-11-11)

The [latest review](https://github.com/cwchanap/Vela/pull/84#pullrequestreview-5863703520) identified four valid edge cases. All are accounted for here, with one adjustment: instead of relying only on `threads.value.some(...)` to infer persistence, maintain one `chat.isPersistedThread` flag. The sidebar list may be stale immediately after a successful save; a boolean set only on confirmed save/thread selection and reset on new/deleted/account-switched chats avoids accidental missing PATCHes.

- Expired-cache warnings are visible only from TTL through TTL + 300 seconds, then hidden even for historical threads.
- A fresh thread UUID is **not** a saved row. Only persisted threads PATCH model; first user save persists a new model.
- At 375px, navigation/title and the two controls occupy separate header rows; no horizontal overflow.
- DynamoDB assistant-save REMOVE-only Update omits `ExpressionAttributeValues` rather than sending an empty map.
