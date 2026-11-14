# HPA-757 — TTS Model Upgrade (Implementation Plan)

**Plan status:** Proposed — not implemented or tested.  
**Ticket:** https://linear.app/cwchanap/issue/HPA-757/update-tts-models-and-move-openai-tts-to-the-realtime-api  
**Design:** [HPA-757 design spec](../specs/2026-11-14-hpa757-tts-model-upgrade-design.md)  
**Delivery rule:** **One PR per ticket:** implement, test and address review comments on this same HPA-757 draft PR. Do not create separate implementation or refactor PRs.

## Ground truth on current main (2026-11-14)

- `packages/common/src/contracts/tts.ts` defines the existing client settings and audio response contracts, but not a TTS model catalog.
- `apps/vela-api/src/tts/providers/{elevenlabs,openai,gemini}.ts` use the old defaults; the OpenAI adapter calls `/v1/audio/speech`, and the Gemini adapter uses `:generateContent`.
- `apps/vela-api/src/routes/tts.ts` already hashes **provider, voice and model** into its S3 cache key. `apps/vela/src/services/ttsService.ts` already includes these in the short-lived client URL cache. Focus on effective-default normalization and test separation, **not** new cache infrastructure.
- `apps/vela/src/pages/settings/components/TtsSection.vue` currently supports only free-form ElevenLabs model selection; its save button requires entering a key on every edit, including when a key exists.
- `packages/cdk/lib/api-stack.ts` already has a 60s Lambda deadline. Prefer a provider-level limit comfortably within API Gateway's 29s default integration budget; do not modify CDK unless measured evidence requires it.

## Implementation sequence

### 0. First: OpenAI live Japanese quality and latency gate

Before implementing every downstream OpenAI change, run a minimal, local server-side smoke call using a test key (never commit keys, generated audio, or full responses). Send a small Japanese test set: kana, kanji, a vocabulary term, a number, and a short sentence. Confirm: (a) the model accepts session and text events, (b) received delta audio is nonempty, (c) 24k PCM decodes to intelligible Japanese, (d) it reads the specified text rather than answering or paraphrasing, and (e) the end-to-end response leaves headroom for S3 and API Gateway.

**Stop condition:** If the speech changes the text, adds commentary, has unacceptable Japanese pronunciation, or consistently exceeds the deadline, document the observed result in this PR/Linear issue and stop the OpenAI migration pending a product decision. Do not substitute another model without updating the design. This is an engineering gate, not a human acceptance criterion.

### 1. Add one common model/voice catalog and resolve effective selections

**Files:** `packages/common/src/contracts/tts.ts`, its exports and focused tests; small API resolver as needed.

- Add `TTS_MODELS`, model labels, default IDs, and provider voice data in the existing contract module. Keep types inferred from `as const` where practical.
- ElevenLabs: `eleven_v4` default, existing `eleven_multilingual_v2` optional alternative. OpenAI: `gpt-realtime-2.1-mini` only. Gemini: `gemini-3.8-flash-tts` default and `gemini-3.8-flash-lite-tts` as a cheaper option with the same request shape.
- Include the official 30 Gemini voice names and ticket-listed OpenAI voices, removing `Iocaste`. Keep ElevenLabs' custom voice ID.
- Create one small helper that resolves `provider + stored model/voice` to an effective valid selection. Unknown/null stored model resolves to that provider's new default; invalid selections **on new writes** get a 400. No separate registry framework, migrations or per-provider setting tables.

**Tests:** exhaustive provider default coverage; unsupported new model rejection; null/old model fallback; official voices and IDs match UI/server.

### 2. Update the existing three adapters (no shared abstraction)

**ElevenLabs:** change the default model to `eleven_v4`, retain current REST endpoint, output and timeout, test default and alternate model request bodies.

**Gemini:** switch from `models/{id}:generateContent` to the documented 3.8 **`/v1beta/interactions`** endpoint. Send the documented audio response format, `generation_config.speech_config` with selected prebuilt voice, and selected 3.8 model. Read `output_audio.data` from the response. Store the complete WAV bytes as-is (`audio/wav`); **do not** add another RIFF header. Test Flash and Flash-Lite requests, missing/invalid output, upstream failure, timeout and RIFF content type.

**OpenAI:** replace the Speech REST call with a fresh `ws` server-side WebSocket each request to `wss://api.openai.com/v1/realtime?model=...`. Authenticate using the existing stored key, send `session.update` with 24 kHz PCM output, voice and Japanese verbatim-read instructions, await `session.updated`, then send `conversation.item.create` with an `input_text` item and `response.create` with audio output. Buffer sequential base64 `response.output_audio.delta` chunks, accept only a completed `response.done` with audio, wrap PCM16LE/24k mono in a WAV header, and close the socket.

- Add only the small runtime `ws` dependency and types required by Node 20 Lambda; no realtime session manager or streaming-to-browser path.
- One bounded timeout (~22–24s including connection setup), and deterministic cleanup on success, error, non-completed response, early close and timeout.
- Do not log API keys, upstream error bodies, user text, or raw event payloads.
- Mock the socket/event stream in unit tests. Verify ordered chunks, WAV header sizes/sample rate, empty audio, unsuccessful `response.done`, error events, early close and timeout. A successful mock is not evidence of Japanese speech quality (Step 0 covers that).

### 3. Normalize TTS settings and retain existing keys for settings-only edits

**Files:** `apps/vela-api/src/routes/tts.ts`, small helper if appropriate, existing route tests.

- Resolve the effective model and voice **before both** `POST /generate` and `GET /audio/:vocabularyId`; feed them consistently into `createTTSProvider.generate`, S3 key, and `effectiveSettings`.
- `GET /settings` must expose resolved model/voice so the client-side URL cache and screen display agree with what the API actually generates. Never return the key.
- Extend `POST /settings` to accept an omitted/empty API key **only if a previously saved key exists for the same provider**; retain it on the DynamoDB row. Require a key for a new user or provider switch. Validate provider/model and preset voices using the shared catalog before writing.
- Preserve the existing single-row storage, authentication, sanitized errors, S3 caching and presigned URL behavior. Do not widen the scope to multiple provider secrets or concurrency infrastructure.

**Tests:** settings-only save retains key; changing provider without a new key fails; new users must supply key; invalid model 400; model-only change produces distinct S3 object key and `cached:false` then a hit; model null resolves deterministically; generated and looked-up `effectiveSettings` agree.

### 4. Expose provider models in existing Quasar Settings UI

**Files:** `apps/vela/src/pages/settings/components/TtsSection.vue`, `TtsSection.test.ts`, `apps/vela/src/composables/queries/useTTSQueries.ts`, `apps/vela/src/services/ttsService.ts` and related tests only as required.

- Keep provider, API key, voice, model and Save in the current `TtsSection`; show one `q-select` for model across all providers, populated by the common registry. Do not create extra provider cards or a settings framework.
- Use the official preset voices for OpenAI/Gemini, leave ElevenLabs as custom voice ID. On provider change choose that provider's default model and voice; do not silently reuse another provider's model. Hydration of stored settings must not overwrite in-progress edits.
- Show a short hint that a blank API key retains the saved key for the **same provider**. Allow a model/voice-only Save if that provider has an existing key. A provider switch must prompt for the new provider's key. Show success only on successful mutation.
- Keep `useTTSSettingsQuery` invalidation and existing client-side `effectiveSettingsMatch` logic. No new network API endpoints.

**Tests:** options for each provider; correct model/voice on switch; persisted model after refetch/reload; blank-key model-only save; provider-switch key requirement; failure toast; responsive UI test hooks.

### 5. Focused regression and end-to-end verification

Run the repository's affected Bun API tests, Vitest Settings/service tests, lint, API compile and web build. Run the existing mocked Playwright TTS/Settings tests, adapting their provider fixtures and assertions. Do not add a second E2E framework. Verify the real-provider Japanese audio path with authorized test keys; do not conflate adapter mocks with provider acceptance.

**Acceptance matrix (automated and observable, no human sign-off):**

| Platform | End-to-end acceptance |
| --- | --- |
| **macOS browser** | Authenticated Settings shows the correct provider/model/voice options; selecting a different ElevenLabs model, saving with a retained API key and refreshing preserves the choice; Japanese pronunciation plays, and model switching does not reuse the prior audio cache key/URL. A Settings screenshot is captured and visually inspected. |
| **Windows browser** | Same authenticated model-save-reload-playback flow; both MP3 and WAV playback remain usable as selected; desktop screenshot shows no clipped labels, overflow or misleading provider/model defaults. |
| **iOS** | Existing available mobile pronunciation playback path (Capacitor Simulator) works with the upgraded backend. For Settings controls, responsive iOS Safari can select provider/model/voice, save, reload and play audio. Narrow-screen screenshot shows accessible dropdowns and Save action without overlaps. |

**Visual comparison:** HPA-757 has **no attached Linear UI mockup** at plan creation. If one is attached before implementation review, compare captured screenshots against that mockup. Otherwise compare with the current Settings section and the documented model/voice/retained-key behavior. Android/Linux: rely on CI only, no platform acceptance tasks.

**Critical E2E assertions:** every provider returns playable Japanese audio with its current model; generating once then repeating with the same effective settings hits S3; changing model produces a miss and new audio; editing model alone never discards the stored API key; signs of OpenAI paraphrasing or invalid Japanese cause the gate to fail.

## Risk controls and scope discipline

- **OpenAI literal reading:** the realtime model may paraphrase and Japanese quality is not guaranteed. Test early; stop and record findings if it does.
- **Runtime budget:** existing Lambda 60s is already adequate; API Gateway REST integration often defaults to 29s. Target <25s provider generation, leaving room for S3. Avoid CDK changes until measured latency requires them.
- **Cache correctness:** already model-aware; normalize effective model/voice values and keep server/client identity aligned. Avoid a new cache or broad invalidation system.
- **Costs:** OpenAI realtime is roughly $0.60 / million input text tokens and $20 / million output audio tokens at plan time; keep tests short and record representative cost/latency. No jobs, streaming gateway or larger infrastructure.

## Delivery and definition of done

- All feature code, unit tests, focused E2E tests and reviewer fixes land in **this one HPA-757 PR**, not follow-up PRs for the same ticket.
- PR description records completed test commands, screenshots/visual comparison, representative live Japanese provider results, and OpenAI cost/latency findings.
- Mark ready for review only when the real Japanese audio gate and applicable end-to-end checks pass; do not claim these have run at the documentation stage.
