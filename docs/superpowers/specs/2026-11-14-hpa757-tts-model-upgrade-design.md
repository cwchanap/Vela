# HPA-757 — TTS Model Upgrade (Design Spec)

**Status:** Proposed, documentation-only draft PR (implementation follows in this same PR)  
**Linear:** https://linear.app/cwchanap/issue/HPA-757/update-tts-models-and-move-openai-tts-to-the-realtime-api  
**Dependency:** HPA-755 is Done; its extracted `TtsSection` exists on `main`.  
**Baseline:** `main` inspected on 2026-11-14 (`b1baf1c`).

## Goal

Keep Japanese vocabulary and sentence pronunciation working after OpenAI's 2027-01-06 Speech API model shutdown. Default to ElevenLabs `eleven_v4`, Gemini `gemini-3.8-flash-tts`, and OpenAI `gpt-realtime-2.1-mini`; expose a provider-specific model picker in the existing Settings TTS section. Preserve the existing authenticated generation, S3 storage/presigned-URL playback, and short-lived client URL caching paths. **One PR** owns design, code and tests.


## What is already implemented (do not rebuild it)

- `apps/vela-api/src/routes/tts.ts` handles authenticated `GET/POST /tts/settings`, `POST /tts/generate`, and `GET /tts/audio/:vocabularyId`.
- The S3 cache key **already hashes `provider:voiceId:model`** (lines 83–99), and the web `ttsService.ts` cache key already includes the model. Do not add another cache or a second key dimension.
- Generate and audio lookup responses already include `effectiveSettings`; the web client uses it to avoid caching a URL under stale settings.
- `apps/vela/src/pages/settings/components/TtsSection.vue` is the existing Quasar UI; its model field is free text for ElevenLabs and hidden for the other two providers. Saving currently requires a freshly entered API key even when a key is stored.
- `apps/vela-api/src/llm/types.ts` already exports `REQUEST_TIMEOUT_MS = 25_000` and `withRequestTimeout()`. Existing TTS adapters instead use 30 seconds and a route message-substring timeout check; adapt them to the shared deadline and named errors.
- `openai@7.53.0` is already an API dependency, and the SDK exposes `OpenAIRealtimeWS` via `openai/realtime/ws`. Reuse its typed event API rather than constructing a separate raw protocol client.
- `packages/cdk/lib/api-stack.ts` gives the Node 20 API Lambda 60 seconds; API Gateway REST has a 29-second default integration window. The **production bundle** is the separate `packages/cdk` `bun run lambda:build` esbuild command, not the API's Bun-target build.

## Scope and boundaries

In: a small typed TTS catalog in `@vela/common`, provider adapters, minimal server settings/normalization changes, the current TTS settings component/service, and focused tests. The existing one-user-one-active-TTS-provider DynamoDB row remains the persistence model.

Out: new audio queue/worker, streaming audio to browsers, a multi-provider TTS key vault, migration machinery, rebuilding the TTS screens, mobile-only Settings UI, general audio engine, new infrastructure by default, or LLM preferences. No extra art or sound assets are needed.


## Shared TTS provider registry and effective selection

Match the existing `LLM_PROVIDER_REGISTRY` convention rather than inventing parallel lists: export `TTS_PROVIDERS`, `TTS_PROVIDER_REGISTRY` and a small pure `resolveTtsSelection(provider, model, voiceId)` from `packages/common/src/contracts/tts.ts`, with tests in `tts.test.ts`. A registry entry has `label`, `defaultModel`, `models: {id,label}[]`, `defaultVoice` and `voices: string[] | null` (`null` means user-entered voice ID, for ElevenLabs). Keep the registry in `@vela/common`, not duplicated in UI/adapters.

| Provider | Default | Other selectable model | Voice input |
| --- | --- | --- | --- |
| ElevenLabs | `eleven_v4` | `eleven_multilingual_v2` (existing compatible alternative) | Free-form voice ID, existing default |
| OpenAI | `gpt-realtime-2.1-mini` | None: no speculative Realtime models | alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar |
| Gemini | `gemini-3.8-flash-tts` | `gemini-3.8-flash-lite-tts` (cost-sensitive 3.8 alternative) | Official 30 prebuilt voices; remove `Iocaste` |

Copy Gemini's complete official voice list from vendor docs; do not keep a second list in `TtsSection`. The UI shows the model dropdown even for the single OpenAI choice, with no custom-model input.

Add the `./contracts/tts` subpath export beside `./contracts/llm` in `packages/common/package.json`. The server's **runtime** registry import must use `@vela/common/contracts/tts`; importing the root barrel at runtime would pull in query-client/Vue code (`packages/common/src/index.ts`). Re-export from the barrel for existing frontend imports if needed.

Both generation and audio lookup resolve null/legacy/invalid **stored** settings to the current provider defaults; strict validation rejects unsupported **new writes**. The public `GET /tts/settings` and `effectiveSettings` report the same resolved values. Make `TTSGenerateRequest.voiceId` and `model` non-nullable strings and remove adapters' own `DEFAULT_*` and `VOICES` constants and fallback branches. Also replace the API-local `TTSProviderName` with shared `TtsProvider`, and derive the route provider schema from `TTS_PROVIDERS`. This makes adapter generation and cache hashing use **exactly one source of defaults**. No DynamoDB migration.


## Provider design

### ElevenLabs

Keep `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}` and MP3 output. The route supplies a non-null selected model (default `eleven_v4`) and voice; the adapter must not choose its own defaults. Use the shared 25-second deadline and existing request adapter. Test the default/alternate model request bodies and MP3 output.

### Gemini

The existing adapter uses the 2.5 `models/{id}:generateContent` contract; switching to 3.8 needs the documented AI Studio API-key `POST https://generativelanguage.googleapis.com/v1beta/interactions` JSON contract: `input`, `response_format:{type:'audio'}`, and `generation_config.speech_config`. Decode `output_audio.data`. Both `gemini-3.8-flash-tts` and Flash-Lite use this same contract.

Unary 3.8 output is **documented** as complete 24 kHz mono RIFF/WAV; save valid WAV unchanged, or use the shared `pcm16ToWav(buffer, 24_000)` helper only for a credible raw PCM16LE response. **Raw PCM has no magic bytes**, so byte parity alone cannot distinguish it from compressed audio. Apply this small decision rule to the decoded `output_audio.data`:

1. Reject an empty buffer.
2. If its first four bytes are `RIFF`, require `buffer.length > 44` and bytes 8–11 equal `WAVE`; malformed RIFF must fail (never attempt to wrap it as PCM).
3. Otherwise, require an even byte length and audio response MIME metadata, **when present**, matching `audio/pcm` or `audio/L16` (ignore case and permit MIME parameters). If metadata is absent, accept raw PCM only if the Step 0 live Gemini 3.8 test confirms that this specific response path returns headerless PCM; otherwise fail the ambiguous result. Reject explicitly compressed/unsupported MIME types, including MP3/OGG.

Return `audio/wav` for both supported representations. Drop the old format-to-content-type map and obsolete tests, and remove the unused `outputFormat` request property. Keep the MIME check local to this adapter; do not reinstate the old generic MIME registry.

### OpenAI

Use the installed OpenAI SDK's typed **`OpenAIRealtimeWS`** via `openai/realtime/ws` and the existing SDK-client factory testing pattern in `apps/vela-api/src/llm/providers/openai.ts`. Add direct `ws@^8.21.0` and needed types for Node 20; transitive `ws@8.19.0` in the lockfile does not satisfy the SDK peer. No hand-typed `RealtimeClientEvent`/`RealtimeServerEvent` clones. Open one server-to-server socket per pronunciation request; no pool/WebRTC/browser stream. The stored API key remains server-side.

1. Create one `OpenAIRealtimeWS` session with **reconnect disabled**, subscribe to SDK `error` and the underlying `rt.socket.once('close')` **before** sending. Wait for `session.created` (or `rt.socket.once('open')`) before `rt.send({type:'session.update', ...})`: the SDK's non-reconnecting `send()` does **not** queue messages while `CONNECTING`; it reports the send failure on its SDK error emitter. Configure type `realtime`, selected voice, `session.audio.output.format={type:'audio/pcm',rate:24000}`, and instructions: "Read the user's text aloud exactly as written, in Japanese, without adding or changing anything."
2. After `session.updated`, send one user `conversation.item.create` with `input_text`, then `response.create` with audio output. Use the SDK-typed event API.
3. Collect ordered base64 `response.output_audio.delta` chunks and output transcription from `response.output_audio_transcript.done` (or from `response.done.response.output` if available). At `response.done`, accept only status `completed`, nonempty PCM and a usable output transcript.
4. **Per-request cache guard:** normalize whitespace/punctuation in source and generated transcript, and reject *obvious* deviations (e.g. an output transcript longer than 2× input length plus a small slack established by the live Japanese samples). Kanji may transcribe as kana; do **not** demand character-for-character equality. Missing transcript or clearly excessive content fails generation (`tts_generation_failed`), so it is never uploaded to S3. Keep a `ponytail:` implementation comment documenting that this heuristic is not a semantic verifier and may miss short paraphrases. Refine only from observed Japanese samples; avoid a second LLM verifier or elaborate Japanese parser.
5. Wrap valid PCM16LE 24 kHz mono audio in a 44-byte WAV header and return `audio/wav`. If `rt.socket` closes before a successful completed response, fail immediately; do not rely on `rt.on('close')` (the SDK wires that only when reconnect is enabled). On success/error/abort/timeout, clean up event handlers and timer/abort listener and call `rt.close()` or `rt.socket.terminate()` as appropriate.

Use `withRequestTimeout()` / `REQUEST_TIMEOUT_MS = 25_000` for the socket deadline **as well as** the REST adapters. For socket operations, bridge the signal to explicit SDK/socket close and a named `TimeoutError`; an AbortSignal alone does not close a WebSocket. In `routes/tts.ts`, classify timeouts using `error.name === 'TimeoutError'`, not a substring search of error messages that could contain upstream response bodies. Avoid a CDK timeout increase absent real latency evidence.

**Early provider quality gate:** make real requests with representative Japanese vocabulary, kana/kanji, numbers and short sentences via OpenAI Realtime, **and at least one Gemini 3.8 unary interaction**. Check literal reading, decoded audio, response latency and the actual transcript/format shape. If OpenAI paraphrases or Japanese is unacceptable, stop and report to HPA-757 rather than changing models behind the ticket's back. The per-request guard complements, but does not replace, the early live gate.

## Settings and API-key save behavior

- In `TtsSection.vue`, replace the free-form ElevenLabs model input with a `q-select` **for every provider**, wired to the common catalog. The voice picker follows the chosen provider's official options; ElevenLabs remains an optional free-text voice ID. Show current defaults and an unobtrusive AI-generated-audio label.
- On provider changes, select a valid default model/voice rather than carrying a model/voice from a different provider. On query reload, preserve the saved provider/model/voice and do not clobber in-progress user edits.
- `POST /tts/settings` keeps the current row and route; make `apiKey` optional **only when updating settings for the same provider with an existing key**. Preserve that stored key. A new user or a provider switch must provide a key. Never send a secret back in the settings GET.
- In the UI, leave the key blank to retain the **same provider's** stored key; entering a key replaces it. In `TtsSection.vue`, compute `hasSavedKeyForSelectedProvider` only when `ttsSettingsData.value?.hasApiKey && ttsSettingsData.value?.provider === ttsProvider.value`. Use it in **both** the Save button's disabled condition and the `saveSettingsHandler` blank-key guard, and in any `Configured`/status label: switching provider must not display the new provider as configured. Keep existing feedback and query invalidation.
- Update `TTSSettingsPayload.apiKey` in `apps/vela/src/composables/queries/useTTSQueries.ts` and `saveTTSSettings(..., apiKey, ...)` in `apps/vela/src/services/ttsService.ts` to accept `apiKey?: string`. Omit the field from the POST JSON when the input is blank; do not send a dummy empty key. Only the backend retains an existing key after verifying the saved provider matches. Keep unconfigured and provider-switched saves blocked until a key is supplied.
- Keep the `TtsSettings`/generate-response data shapes; normalize the effective model and voice rather than adding new persisted preference objects.


## Cache semantics

Re-use the existing `generateCacheKey(userId,vocabularyId,provider,voiceId,model)` on the server and the existing client URL cache key, passing **resolved effective values** and reporting them in `GET /tts/settings` / generate/audio `effectiveSettings`. This prevents the old adapter defaults from producing the wrong S3 cache identity.

Test: (1) same effective settings hit S3; (2) a different model causes a new S3 object and generation; (3) a stored null/legacy model resolves to the new default and cannot accidentally reuse old cached audio; (4) provider/voice changes remain isolated on client and server; (5) a clearly non-verbatim OpenAI transcript **fails before S3 upload**, and a valid transcript allows upload; (6) no raw upstream response body or secret leaks into logs.

The S3 bucket has no expiration rule and no regenerate endpoint, so a single bad cached pronunciation persists. The cheap per-request transcript guard is important even after a one-time live evaluation.


## Failure and cost boundaries

Keep the existing sanitized route errors and S3 presigning contracts. Apply the shared 25-second deadline to **all three TTS adapters**; classify `TimeoutError` by name rather than inspecting upstream-derived messages. Keep buffers bounded to short pronunciation requests rather than long sessions.

OpenAI `gpt-realtime-2.1-mini` published pricing at planning time is about **$0.60/1M text input tokens and $20/1M audio output tokens**; record sample cost/latency during the early gate. Avoid a new background job. Note Node 20 upstream EOL as a separate maintenance concern, not a reason to change CDK for this ticket.


## Verification and acceptance

**Automated:** shared registry/resolver Bun tests; provider tests including Gemini Interactions response shape, valid/malformed RIFF, metadata-confirmed PCM, compressed MIME rejection and absent-metadata behavior; SDK-mocked OpenAI Realtime `CONNECTING` handshake, `session.created`, underlying `rt.socket` premature close, error/timeout/transcript checks and WAV headers; route tests for same-provider key retention, model validation, effective settings and S3 key separation; Vitest `TtsSection` model/voice/save tests. Check errors are sanitized and do not store a rejected transcript. Extend the **existing** `apps/vela/e2e/llm-settings.spec.ts` TTS regression case using its `e2e/fixtures/syntheticAuth.ts` mock: test blank-key save for `hasApiKey:true` on the same provider, preserve keys in the mock state, and retain the unconfigured/save-disabled case. No new TTS Playwright suite/framework.

**Build checks:** first run **`bun run build --filter=@vela/common`** after adding the new contract subpath, so `packages/common/dist/contracts/tts.*` exists before API typecheck and Lambda bundling. Then run API tests/typecheck, web tests/build, and crucially **`bun run lambda:build` from `packages/cdk`** (production Node 20 esbuild CJS output). Verify the SDK/`ws` import bundles there; a Bun-target build is not sufficient.

**End-to-end platform acceptance (no human sign-off):**

- **macOS browser:** signed-in Settings displays provider-specific models/voices; changing ElevenLabs model and saving without re-entering the same provider's key persists after reload; pronunciation plays, model changes get a new cache identity. Capture a Settings screenshot.
- **Windows browser:** same Settings/model/save/reload flow; play applicable MP3/WAV audio. Capture a screenshot and confirm correct labels/no desktop overflow.
- **iOS:** the existing Capacitor WKWebView audio path plays **24 kHz mono WAV** returned by OpenAI and Gemini and preserves existing playback/interruption behavior. The iOS Safari responsive Settings model/voice controls save/reload/play as applicable. Capture a narrow-layout screenshot.
- **Visual check:** compare screenshots with a Linear UI mockup if attached (none was attached at planning). Otherwise check model labels, voices, blank-key retention hint and narrow layout.

Android/Linux are CI-only. Successful mocked provider tests do not count as live Japanese speech quality verification.

## References

- OpenAI TTS deprecation (2027-01-06): https://developers.openai.com/api/docs/deprecations
- OpenAI Realtime events: https://developers.openai.com/api/docs/guides/realtime-conversations
- OpenAI Realtime WebSocket: https://developers.openai.com/api/docs/guides/voice-websockets
- OpenAI Node SDK Realtime WebSocket: https://github.com/openai/openai-node/blob/main/src/realtime/ws.ts
- OpenAI model/pricing: https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
- Gemini 3.8 AI Studio TTS: https://ai.google.dev/gemini-api/docs/speech-generation
- ElevenLabs TTS models: https://elevenlabs.io/docs/overview/models
- AWS API Gateway integration timeout quotas: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-execution-service-limits-table.html
