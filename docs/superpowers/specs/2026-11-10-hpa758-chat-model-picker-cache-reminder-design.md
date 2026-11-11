# HPA-758 — Chat model picker and prompt-cache reminder: design spec

**Date:** 2026-11-10  
**Linear:** https://linear.app/cwchanap/issue/HPA-758/add-chat-model-picker-and-prompt-cache-expiry-reminder  
**Prerequisites:** HPA-754, HPA-755, and HPA-756 are Done; HPA-756 merged in Vela PR #82.  
**Delivery:** One draft PR starts with this design and its implementation plan. Put implementation, tests, and review fixes on this same PR; no follow-up implementation PR.

## Goal

On the existing AI Chat page, let a signed-in learner choose any chat-capable provider/model for which a user API key or verified server key is available. The choice applies to the next request, can change mid-conversation without losing history, and persists on the current thread. Optionally override the model's thinking effort for the active chat. Show a small **estimated** cache-reuse countdown only after actual provider usage reports a cache read or write.

Do **not** implement a caching service, provider discovery, billing estimator, global settings rewrite, or chat-streaming refactor. HPA-757 (TTS), HPA-824 (cross-client preference ordering), and HPA-833 (preference tombstones) stay separate.

## Existing code seams, verified on main after PR #82

- packages/common/src/contracts/llm.ts provides LLM_PROVIDER_REGISTRY, registered models/efforts/defaults, cacheTtlSeconds (300 for Anthropic, 1800 for OpenAI, null for Google and OpenRouter), and LlmResponse.usage with cachedInputTokens and cacheWriteTokens.
- apps/vela/src/stores/llmSettings.ts owns saved per-provider keys, model-specific thinking overrides, and the global default model. Do not save a chat selection to global Settings.
- apps/vela/src/composables/queries/useLlmCapabilitiesQuery.ts reports authenticated server key availability; only Google and OpenRouter can use those keys. A failed capability lookup is not proof that a server key exists.
- apps/vela/src/pages/chat/AIChatPage.vue currently passes llmSettings.selection into each llmClient.generate call. It owns the account/session generation guard, thread selection, new-chat, send, deleted-thread restart, and message persistence.
- apps/vela/src/pages/chat/components/ChatComposer.vue owns input/send; ChatSidebar.vue owns navigation. Add the model picker near the chat header, keeping the composer simple.
- apps/vela/src/services/chatHistoryService.ts, useChatThreads.ts, and apps/vela-api/src/routes/chat-history.ts already support the authenticated user-scoped PATCH /chat-history/thread/:id for model: { provider, model }, as well as title rename. A thread row is created only on the first persisted **user** message.
- apps/vela-api/src/llm/providers/anthropic.ts requests ephemeral 5-minute caching, and the OpenAI mapper surfaces provider usage. No changes to LLM adapter internals are required for the reminder.

## Product and interaction contract

### Model selector

1. Put a compact ChatModelPicker in the chat header (usable beside the mobile sidebar button). Quasar select options are grouped by provider label. Registered providers show their registry models; OpenRouter shows one custom model-ID entry/input. Trim and require a nonempty OpenRouter ID before applying. No remote model-list fetch.
2. Show provider/model choices only for providers with a saved key or an **affirmative** useLlmCapabilitiesQuery server-key result. Server keys are allowed for Google/OpenRouter chat, not OpenAI/Anthropic. On a capabilities error, retain verified user-key options, show a brief retry affordance, and do not assume server-key eligibility.
3. New chat starts with the current llmSettings.llm.defaultModel, with any saved per-model thinking override. Do not change that global default when the user picks a chat model.
4. Opening a persisted thread restores its model field; an old thread without model falls back to the current Settings default. If its stored provider/model is no longer available, show it as unavailable and ask the user to select/configure a usable choice; never silently rewrite the thread or send under a different model.
5. Switching model mid-chat keeps the full ordered message transcript. The next llmClient.generate call gets an explicit snapshot of provider, model, and that provider's current key; the existing backend normalization still removes the decorative greeting. Reset cache indication when the provider **or model** changes.
6. The adjacent thinking control offers **Use model/Settings default** plus only the selected registered model's effort values. Resolve the default as the saved thinking override for that model when present; otherwise let the backend apply the registry default. An explicitly selected level overrides it for subsequent requests while that chat/model remains active. OpenRouter has no registered effort list: hide this control there. The temporary thinking choice is **not persisted** in the thread metadata or global Settings; reset it on thread/model switch, reload, and New chat. Only model identity is persisted by this ticket.
7. Disable model/thinking edits while a send or thread PATCH is in flight. For an existing thread, PATCH model before activating a new choice; on PATCH failure keep the previous choice and report the error. For a fresh thread, keep the chosen model locally because no row exists yet; after the first successful user-message save creates the metadata row, PATCH the model before generating. If that PATCH fails, warn that the choice is not durable; keep existing nonfatal history-save behavior rather than silently claiming persistence.
8. Reuse the existing account/session generation guards in asynchronous selection, patch, send, and reload flows. Do not add a second global store or generic conversation runtime. When restartDeletedChat creates a replacement ID, reset cache evidence and persist the active model against the **replacement** row after its first user save.

### Cache reminder (best-effort estimate, not a guarantee)

1. The successful llmClient.generate response already includes usage. Treat cachedInputTokens > 0 **or** cacheWriteTokens > 0 as evidence of a cached prefix; do not infer it from input length, token prices, elapsed time alone, or a zero/absent usage record.
2. Capture the wall-clock epoch milliseconds immediately **before** calling llmClient.generate; use that request-start timestamp, **not response completion**, for the countdown. The browser clock is a deliberate lightweight approximation. Do not add server-time synchronization or a background refresh.
3. For Anthropic use 5 minutes, OpenAI 30 minutes, directly from LLM_PROVIDER_REGISTRY[provider].cacheTtlSeconds. With null TTL (Google/Gemini or OpenRouter), no chip is rendered even if those adapters report cached reads.
4. For the active selection with confirmed evidence, render: more than 60 seconds remaining, a small neutral "Cache likely warm · M:SS left" chip; from 0 to <60 seconds, an amber "Cache window · M:SS left" warning; after the window, "Cache window elapsed · next message may miss cache". Tick once per second while the chat page is mounted, using one local timer/composable, cleared on unmount. Clamp negative remaining time to zero; future timestamps are clamped to the TTL.
5. Each successful response with positive cache usage refreshes the reference start time. A successful response reporting **zero** read/write evidence clears the indication; failed/aborted requests never fabricate a fresh window. While sending, do not claim the new call refreshed it until usage is known.
6. Store only **lastLlmAt?: number (epoch ms)** on the existing thread row as the persisted marker for last verified cached usage. Its presence implies positive usage for the thread's current model. Clear it (PATCH null / DynamoDB REMOVE) on a model change or a successful response without evidence. There is no second boolean, per-message cache history, localStorage snapshot, or extra table.
7. Persist the timestamp only for a successfully saved assistant turn so the restored transcript corresponds to the cache evidence; after that save, use the existing PATCH /thread/:id. A metadata-only timestamp PATCH should not bump thread updatedAt or resort the sidebar. If cache metadata persistence fails, do not fail the already-saved chat response; keep the chip conservative and allow the next send to retry naturally.
8. When reopening the thread, derive the chip from the thread's model, lastLlmAt, and Date.now(); an absent timestamp, unsupported provider, changed model, or changed account hides it. Changing thread, New chat, or signing out must never show the previous thread's timer.
9. This is an **estimated reuse window**, not a claim that a provider guarantees a cache hit or exact token charge. OpenAI describes 30 minutes as a *minimum* cache lifetime, and entries may persist longer; upstream routing/prefix changes also affect hits. Do not use "cache expired, next message pays full price" as a factual guarantee. No keep-alive requests or auto-messages.

## Minimal API/data changes

- In apps/vela-api/src/validation.ts add optional lastLlmAt to ChatThreadSummarySchema and optional lastLlmAt: positive integer | null to PatchChatThreadSchema. PATCH must still require at least one supported field; unknown fields remain excluded. Null means explicitly clear. Keep existing authenticated ownership/404 behavior.
- In apps/vela-api/src/routes/chat-history.ts expose lastLlmAt in GET /threads and PATCH return values. Update dynamodb_updateThread to support SET and REMOVE expressions without overwriting other fields. Bump updatedAt for model/title changes only; a cache-only PATCH leaves sidebar ordering alone. Changing model and clearing timestamp can happen in one PATCH. No new DynamoDB table, index, migration, or extra API route.
- In apps/vela/src/services/chatHistoryService.ts and apps/vela/src/composables/queries/useChatThreads.ts extend the DTO/patch type and reuse the existing optimistic thread-update mutation (rename it to useUpdateThread if that improves clarity). Do not perform optimistic timestamp writes that imply success before the provider confirms usage. Keep cache keys scoped by authenticated identity.
- Keep the LlmResponse usage contract, provider normalizer, and LLM transport unchanged.

## Failure/edge behavior

- A nonempty but invalid/removed registered model must not be sent; OpenRouter accepts free-form IDs as it does in Settings.
- Missing key or unknown server availability: block sending with an actionable setting/retry hint, rather than pretending the backend can serve the model.
- PATCH 404 on a deleted thread uses the existing deleted-thread recovery semantics; do not resurrect a deleted row with a stale model/cache timestamp.
- Stale async results after account change or selecting another thread cannot change the new active model or its cache chip.
- Cross-tab concurrent model selection, precise provider cache-hit prediction, and clock-skew correction are explicitly deferred.

## Acceptance criteria

- Model list and available keys reflect registry/settings/capabilities; custom OpenRouter ID works; unavailable providers do not appear as usable.
- Selected provider/model is used for the next chat request, including after switching mid-conversation with complete history, and persists after reopening/reload.
- New chats default to Settings; thread-specific model changes never mutate Settings. Thinking control exposes only valid efforts, respects saved defaults, and is explicitly session-only.
- Cache chip appears **only after confirmed usage** for a provider with TTL; counts down from request start, warns in the final minute, becomes an elapsed-window hint, resets after a confirmed cache read/write, and hides for Gemini/OpenRouter or unconfirmed cache usage.
- Timer survives thread reload through lastLlmAt; switching model, thread, or account cannot leak the previous timer.
- Focused frontend/API/component tests cover persistence, error recovery, capability failure, zero usage, countdown boundaries, model switch, restored thread, and account isolation. No implementation is claimed by this documentation-only commit.

## Provider documentation

- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- OpenAI prompt caching (newer-model 30-minute minimum): https://developers.openai.com/api/docs/guides/prompt-caching
- Gemini caching: https://ai.google.dev/gemini-api/docs/caching
