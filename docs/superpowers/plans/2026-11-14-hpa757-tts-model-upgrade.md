# HPA-757 — TTS Model Upgrade (Implementation Plan)

**Plan status:** Proposed — not implemented or tested.  
**Ticket:** https://linear.app/cwchanap/issue/HPA-757/update-tts-models-and-move-openai-tts-to-the-realtime-api  
**Design:** [HPA-757 design spec](../specs/2026-11-14-hpa757-tts-model-upgrade-design.md)  
**Delivery rule:** **One PR per ticket:** implement, test and address review comments on this same HPA-757 draft PR. Do not create separate implementation or refactor PRs.


## Ground truth on current main (2026-11-14)

- `packages/common/src/contracts/tts.ts` defines existing client settings/audio contracts, but not a TTS registry. `contracts/llm.ts` already has a provider registry; follow its simple shape. `packages/common/package.json` has an `./contracts/llm` subpath, but no `./contracts/tts`; using the common root barrel in Lambda at runtime can import frontend query-client code.
- `apps/vela-api/src/tts/providers/{elevenlabs,openai,gemini}.ts` contain their **own** default models/voices and take nullable requests. Remove duplicate defaults so the route uses one effective selection throughout.
- `apps/vela-api/src/routes/tts.ts` already hashes **provider, voice and model** into its S3 key. `apps/vela/src/services/ttsService.ts` already includes those dimensions in its client URL cache. Pass resolved selection and test separation; no new cache infrastructure.
- `apps/vela/src/pages/settings/components/TtsSection.vue` currently supports only free-form ElevenLabs model input; saving requires a new API key every time. The `hasApiKey` response pertains to the **saved provider**, not the currently selected dropdown value. The frontend composable and service both currently require a nonoptional API-key argument.
- `apps/vela-api/src/llm/types.ts` already contains `REQUEST_TIMEOUT_MS = 25_000` and `withRequestTimeout()`. Current TTS adapters use 30s and the route infers timeouts by searching upstream-derived error messages.
- The already-installed `openai@7.53.0` SDK provides `openai/realtime/ws` and typed events. Add a compatible direct `ws` peer (`^8.21.0`) for Node 20; don't hand-roll Realtime events.
- API's Bun-target build is **not** the deployed artifact. Production is `packages/cdk` `bun run lambda:build` via esbuild Node 20/CJS; add this gate.
- Existing mocked browser Settings regression is `apps/vela/e2e/llm-settings.spec.ts` around line 816, with TTS mock state in `e2e/fixtures/syntheticAuth.ts`. Extend it; don't invent a new suite.

## Implementation sequence


### 0. First: OpenAI **and Gemini** live contract/quality gate

Before implementing every downstream OpenAI change, run a minimal server-side sample with an authorized test API key; never commit keys, generated audio or full upstream messages. Test OpenAI Realtime with kana, kanji, vocabulary, a number and a short Japanese sentence. Confirm (a) accepted typed session/text events, (b) nonempty 24k PCM, (c) usable output transcript (from `response.output_audio_transcript.done` or `response.done`), (d) literal Japanese reading without commentary, and (e) completion within the shared 25s deadline with S3/gateway headroom.

Also run **at least one Gemini 3.8 unary `/v1beta/interactions`** sample and inspect the actual `output_audio.data` payload/header **and any MIME metadata** along with request schema and playback. Record whether the vendor returns RIFF/WAV or headerless PCM without MIME metadata; only enable the absent-metadata PCM branch if the live result confirms it. Vendor-document-based mocks alone cannot establish that a new transport works.

**Stop condition:** If OpenAI changes the text, adds commentary, has unacceptable Japanese pronunciation or consistently exceeds the deadline, record the finding in this PR/Linear and stop the OpenAI migration pending a product decision. Do not silently swap models or delete the provider. The per-request transcript guard in Step 2 does *not* replace this gate.


### 1. Add one shared provider registry and pure effective-selection helper

**Files:** `packages/common/src/contracts/tts.ts`, `packages/common/src/contracts/tts.test.ts`, `packages/common/package.json`, barrel exports; minimal API import updates.

- Export `TTS_PROVIDERS`, `TTS_PROVIDER_REGISTRY` and `resolveTtsSelection(provider, model, voiceId)`. Match `LLM_PROVIDER_REGISTRY`'s small shape: `{label, defaultModel, models:[{id,label}], defaultVoice, voices:string[] | null}`. `voices:null` means ElevenLabs' free-form ID. No new registry framework.
- ElevenLabs defaults to `eleven_v4` with `eleven_multilingual_v2` selectable; OpenAI has `gpt-realtime-2.1-mini`; Gemini defaults to `gemini-3.8-flash-tts` with Flash-Lite selectable. Copy the official 30 Gemini voices and listed ten OpenAI voices, removing `Iocaste`.
- Resolve null/old/unknown **stored** model and voice to provider defaults consistently. Reject unsupported **new writes**. For the API's `TTSGenerateRequest`, make `voiceId`/`model` non-nullable, delete adapters' duplicated `DEFAULT_MODEL`/`DEFAULT_VOICE_ID`/`VOICES` constants and their outdated pinning tests, and derive `TTSProviderName`/`z.enum` from shared `TtsProvider`/`TTS_PROVIDERS`.
- Add a runtime `@vela/common/contracts/tts` subpath export to avoid importing root-barrel QueryClient/Vue code into Lambda; frontend may keep root-barrel re-exports. **Build `@vela/common` before API typecheck and CDK Lambda esbuild** so the new `dist/contracts/tts.js` and `.d.ts` exist.

**Tests:** one common resolver test suite covering each provider's defaults, old/null stored values and optional custom ElevenLabs voice, plus strict write-validation tests at the route. Typechecking rejects adapters that reintroduce nullable/internal defaults.


### 2. Update adapters with shared deadline, verified audio and cheap transcript guard

**ElevenLabs:** route passes resolved non-null `voiceId`/`model` (default `eleven_v4`); retain existing REST endpoint and MP3, use `withRequestTimeout()`'s 25s signal. Replace tests of adapter-owned defaults with tests of the resolved request body and content type.

**Gemini:** use the 3.8 **`/v1beta/interactions`** API-key endpoint with `model`, `input`, `response_format:{type:'audio'}` and `generation_config.speech_config`; decode `output_audio.data` and its response MIME metadata (if provided). **Raw PCM16LE has no magic bytes**; don't assume every even-length non-RIFF result is PCM. Reject empty bytes; if bytes start with `RIFF`, require `length > 44` and bytes 8–11 equal `WAVE` and pass through, otherwise reject malformed WAV. On non-RIFF input, require even byte length and absent or PCM/L16 MIME; explicitly reject compressed MIME. Allow absent-metadata PCM only after Step 0 confirms this actual vendor output path. Wrap credible PCM16LE using the shared `pcm16ToWav(data, 24_000)` and return `audio/wav`; reject ambiguous unsupported input. Remove unused `outputFormat` and the ~50-line old MIME map/tests. Test Flash and Flash-Lite, valid/malformed RIFF, PCM with/without confirmed metadata, compressed MIME rejection, errors and timeouts.

**OpenAI:** import `OpenAIRealtimeWS` from `openai/realtime/ws`; use its typed events and injected SDK-client factory seam analogous to `src/llm/providers/openai.ts`. Add direct `ws@^8.21.0` and needed typings for Node 20; keep one short-lived **server-side socket per request** with reconnect disabled. Register an SDK `error` handler and the underlying `rt.socket.once('close')` handler first. **Wait for `rt.on('session.created')` or `rt.socket.once('open')` before the first `rt.send({type:'session.update'})`**: the SDK's non-reconnecting `send` does not buffer while the socket is `CONNECTING`. On `session.updated`, send one `conversation.item.create` `input_text` then `response.create`. Collect `response.output_audio.delta` PCM bytes and output transcript (`response.output_audio_transcript.done` or `response.done` output). At `response.done`, require completed status, nonempty PCM, nonempty transcript and a **plausible** read-back. Use a minimal normalized length guard calibrated by Step 0 (e.g. transcript >2× input length + slack fails), not strict kanji/kana equality. Add the planned `ponytail:` comment documenting missed short paraphrases. Rejected transcripts must **never be uploaded to S3**. Wrap PCM in shared WAV utility, return `audio/wav`. If the underlying socket closes before successful response completion, fail immediately; SDK-level `rt.on('close')` is only emitted with reconnect enabled. In every outcome call `rt.close()` or `rt.socket.terminate()` as appropriate and remove listeners/abort hooks.

**Timeout integration for all three:** reuse `REQUEST_TIMEOUT_MS = 25_000` / `withRequestTimeout()` from `apps/vela-api/src/llm/types.ts` rather than adding another timer policy. For WebSocket, connect the abort signal to explicit socket cleanup and named `TimeoutError`. REST fetch uses the signal directly. Change `routes/tts.ts` to recognize `error.name === 'TimeoutError'`, **not** `error.message.includes('timeout')`; avoid re-wrapping timeout errors as a generic `Error`. Keep existing sanitized logging.

**Tests:** SDK-mocked connection still `CONNECTING` (no early send), `session.created` opens handshake, underlying `rt.socket` close before completion fails promptly, SDK error, timeout, partial-response/empty-audio stream, missing transcript, valid kana transcription and obvious commentary rejection; WAV chunk-size/sample-rate; Gemini valid/malformed RIFF, PCM with accepted MIME/confirmed absence, unsupported compressed MIME, odd bytes and abort. No generic realtime abstraction or new background worker.


### 3. Normalize TTS settings and retain same-provider keys

**Files:** `apps/vela-api/src/routes/tts.ts`, `apps/vela-api/src/tts/types.ts` and existing route tests.

- Resolve effective model/voice via the **common pure helper** before both `POST /generate` and `GET /audio/:vocabularyId`; pass them to the adapters, S3 key, and `effectiveSettings`. `GET /settings` exposes the same resolved model/voice so client URL cache identity matches generation. Never return API keys.
- Import runtime registry and `TTS_PROVIDERS` from `@vela/common/contracts/tts`, not the root barrel. Use `z.enum(TTS_PROVIDERS)` and strict model/prebuilt-voice validation for new saves.
- `POST /settings` accepts a blank/omitted API key only when an existing key belongs to the **same provider**, retaining that key in DynamoDB. A provider switch or new user requires a key. Keep one row/one active provider, no migration or key vault.
- Preserve existing authenticated route, sanitized errors, S3 bucket, presigned URL lifetime and frontend `effectiveSettingsMatch`; cache identity uses the resolved model.
- Apply named `TimeoutError` detection to return the existing 504 `tts_generation_timeout`; all other provider failures, including suspect transcript, return `tts_generation_failed` without S3 upload.

**Tests:** same-provider no-key save, provider-switch/no-key failure, fresh-user failure, invalid model 400; null/old persisted settings resolve to active default; same model hits same cache key, changed model causes distinct key and `cached:false`, successful generation then lookup returns matching `effectiveSettings`; failed transcript never uploads.


### 4. Expose registry-backed models in existing Quasar Settings UI

**Files:** `apps/vela/src/pages/settings/components/TtsSection.vue`, `TtsSection.test.ts`, existing `useTTSQueries.ts` and `ttsService.ts` only if needed.

- Keep the current `TtsSection` provider/key/voice/model/Save surface; render one `q-select` for every provider's model from the common `TTS_PROVIDER_REGISTRY` (OpenAI has one choice). Remove component-local duplicated model/voice constants. ElevenLabs keeps free-form voice ID; other providers use official lists.
- Call `resolveTtsSelection()` on provider switch to set valid model/voice. Hydrate stored settings without clobbering in-progress changes. Show a hint that blank key retains the **same** provider's saved key.
- In `TtsSection.vue`, compute `hasSavedKeyForSelectedProvider = Boolean(ttsSettingsData.value?.hasApiKey && ttsSettingsData.value?.provider === ttsProvider.value)`. Use it in the Save disabled condition **and** the blank-key guard in `saveSettingsHandler`. Use it for the provider status/Configured display so a newly selected, unsaved provider is not falsely labeled configured. A provider switch requires a freshly entered key; same-provider model/voice-only edits may omit it.
- Make `apiKey?: string` optional in `apps/vela/src/composables/queries/useTTSQueries.ts` **and** in `apps/vela/src/services/ttsService.ts` `saveTTSSettings`; omit `apiKey` from POST JSON when blank. Keep query invalidation and error/success feedback. Server must still check saved-provider identity before retaining the key.

**Tests:** model/voice options from registry; switching resets incompatible selections; reload shows saved model; same-provider model edit with blank key submits omission; saved `hasApiKey: true` for ElevenLabs **does not** enable an unsaved OpenAI selection and does not display OpenAI as configured; no false success on save failure. Avoid extra settings framework.


### 5. Focused regression, production build and end-to-end verification

After adding the common contract subpath, run **`bun run build --filter=@vela/common` from the monorepo root first** to generate `packages/common/dist/contracts/tts.*` before any dependent import. Then run common tests, API Bun provider/route tests, API compile, Vitest Settings/service tests, lint and web build. Crucially run **`bun run lambda:build` in `packages/cdk`**, using the actual Node 20/CJS esbuild packaging path: new OpenAI Realtime `ws` imports must work in production, not just Bun-target builds.

Extend **`apps/vela/e2e/llm-settings.spec.ts`** around its existing TTS save regression, not a nonexistent TTS Playwright file or separate test suite. Update **`apps/vela/e2e/fixtures/syntheticAuth.ts`** to model same-provider blank-key retention. Test both unconfigured `hasApiKey:false` -> Save disabled and configured `hasApiKey:true` -> model-change Save enabled without key; assert updated choice persisted after query reload.

**End-to-end acceptance matrix (automated/observable; no human sign-off):**

| Platform | End-to-end acceptance |
| --- | --- |
| **macOS browser** | Authenticated Settings model/voice selection, same-provider blank-key save and reload, Japanese pronunciation playback and model-aware cache miss when the model changes. Capture Settings screenshot for visual checks. |
| **Windows browser** | Same model/save/reload path; applicable MP3/WAV playback and desktop screenshot without overflow or misleading labels. |
| **iOS** | Existing Capacitor **WKWebView audio path must play 24 kHz mono WAV** produced by OpenAI/Gemini and preserve interruption/completion behavior. iOS Safari narrow Settings dropdowns can save/reload/play as applicable. Capture a narrow-layout screenshot. |

**Visual check:** HPA-757 had no attached Linear UI mockup at plan creation. Compare captured screenshots to a mockup if attached later, otherwise verify provider/model labels, voice options, key-retention hint, Save state and responsive layout. Android/Linux: CI only.

**Critical assertions:** each provider passes real Japanese playback/quality smoke checks; repeated effective settings use S3 cached audio; model change generates a new object; model-only save retains the same-provider key; Realtime obviously non-verbatim transcript fails **before** caching; no secrets leak into logs. Mock tests are not a substitute for real-provider evaluation.


## Risk controls and scope discipline

- **OpenAI literal reading + permanent cache:** the early gate evaluates quality once; the per-request transcript heuristic rejects obvious non-read-back responses before S3 upload. It cannot guarantee semantic equivalence (e.g. kanji-to-kana readings or short paraphrases), so document that limit and avoid a new LLM verifier.
- **Single source:** null/legacy model/voice selection uses the pure common resolver; adapters cannot override defaults or create cache mismatches. No migration.
- **Deadline:** reuse the existing 25s API-side timeout for all three providers. Named `TimeoutError` maps to existing 504; no CDK change unless measured evidence demands it.
- **Gemini format:** vendor documents unary WAV, but validate RIFF/WAVE structure, use PCM/L16 MIME metadata when available, and allow no-metadata raw PCM only if the Step 0 live response confirms that path; never wrap arbitrary even-length compressed data.
- **Bundle:** Node 20 deployed Lambda is esbuild/CJS, not Bun; validate SDK Realtime and `ws` peer through `packages/cdk` build. Node runtime modernization is a separate maintenance task.
- **Cost and architecture:** OpenAI is about $0.60 / 1M text input tokens and $20 / 1M audio output tokens at planning time. Record small-sample latency/cost. No queue, streaming-to-browser, plugin framework, new key storage or second PR.

## Delivery and definition of done

- All feature code, unit tests, focused E2E tests and reviewer fixes land in **this one HPA-757 PR**, not follow-up PRs for the same ticket.
- PR description records completed test commands, screenshots/visual comparison, representative live Japanese provider results, and OpenAI cost/latency findings.
- Mark ready for review only when the real Japanese audio gate and applicable end-to-end checks pass; do not claim these have run at the documentation stage.
