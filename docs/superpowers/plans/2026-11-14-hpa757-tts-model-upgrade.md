# HPA-757 — TTS Model Upgrade (Implementation Plan)

**Plan status:** Proposed — not implemented or tested.  
**Ticket:** https://linear.app/cwchanap/issue/HPA-757/update-tts-models-and-move-openai-tts-to-the-realtime-api  
**Design:** [HPA-757 design spec](../specs/2026-11-14-hpa757-tts-model-upgrade-design.md)  
**Delivery rule:** **One PR per ticket:** implement, test and address review comments on this same HPA-757 draft PR. Do not create separate implementation or refactor PRs.


## Ground truth on current main (2026-11-14)

- `packages/common/src/contracts/tts.ts` defines existing client settings/audio contracts, but not a TTS registry. `contracts/llm.ts` already has a provider registry; follow its simple shape. `packages/common/package.json` has an `./contracts/llm` subpath, but no `./contracts/tts`; using the common root barrel in Lambda at runtime can import frontend query-client code.
- `apps/vela-api/src/tts/providers/{elevenlabs,openai,gemini}.ts` contain their **own** default models/voices and take nullable requests. Remove duplicate defaults so the route uses one effective selection throughout.
- `apps/vela-api/src/routes/tts.ts` already hashes **provider, voice and model** into its S3 key. `apps/vela/src/services/ttsService.ts` already includes those dimensions in its client URL cache. Pass resolved selection and test separation; no new cache infrastructure.
- `apps/vela/src/pages/settings/components/TtsSection.vue` currently supports only free-form ElevenLabs model input; saving requires a new API key every time.
- `apps/vela-api/src/llm/types.ts` already contains `REQUEST_TIMEOUT_MS = 25_000` and `withRequestTimeout()`. Current TTS adapters use 30s and the route infers timeouts by searching upstream-derived error messages.
- The already-installed `openai@7.53.0` SDK provides `openai/realtime/ws` and typed events. Add a compatible direct `ws` peer (`^8.21.0`) for Node 20; don't hand-roll Realtime events.
- API's Bun-target build is **not** the deployed artifact. Production is `packages/cdk` `bun run lambda:build` via esbuild Node 20/CJS; add this gate.
- Existing mocked browser Settings regression is `apps/vela/e2e/llm-settings.spec.ts` around line 816, with TTS mock state in `e2e/fixtures/syntheticAuth.ts`. Extend it; don't invent a new suite.

## Implementation sequence


### 0. First: OpenAI **and Gemini** live contract/quality gate

Before implementing every downstream OpenAI change, run a minimal server-side sample with an authorized test API key; never commit keys, generated audio or full upstream messages. Test OpenAI Realtime with kana, kanji, vocabulary, a number and a short Japanese sentence. Confirm (a) accepted typed session/text events, (b) nonempty 24k PCM, (c) usable output transcript (from `response.output_audio_transcript.done` or `response.done`), (d) literal Japanese reading without commentary, and (e) completion within the shared 25s deadline with S3/gateway headroom.

Also run **at least one Gemini 3.8 unary `/v1beta/interactions`** sample and inspect the actual `output_audio.data` payload/header, correct request schema and playback. Vendor-document-based mocks alone cannot establish that a new transport works.

**Stop condition:** If OpenAI changes the text, adds commentary, has unacceptable Japanese pronunciation or consistently exceeds the deadline, record the finding in this PR/Linear and stop the OpenAI migration pending a product decision. Do not silently swap models or delete the provider. The per-request transcript guard in Step 2 does *not* replace this gate.


### 1. Add one shared provider registry and pure effective-selection helper

**Files:** `packages/common/src/contracts/tts.ts`, `packages/common/src/contracts/tts.test.ts`, `packages/common/package.json`, barrel exports; minimal API import updates.

- Export `TTS_PROVIDERS`, `TTS_PROVIDER_REGISTRY` and `resolveTtsSelection(provider, model, voiceId)`. Match `LLM_PROVIDER_REGISTRY`'s small shape: `{label, defaultModel, models:[{id,label}], defaultVoice, voices:string[] | null}`. `voices:null` means ElevenLabs' free-form ID. No new registry framework.
- ElevenLabs defaults to `eleven_v4` with `eleven_multilingual_v2` selectable; OpenAI has `gpt-realtime-2.1-mini`; Gemini defaults to `gemini-3.8-flash-tts` with Flash-Lite selectable. Copy the official 30 Gemini voices and listed ten OpenAI voices, removing `Iocaste`.
- Resolve null/old/unknown **stored** model and voice to provider defaults consistently. Reject unsupported **new writes**. For the API's `TTSGenerateRequest`, make `voiceId`/`model` non-nullable, delete adapters' duplicated `DEFAULT_MODEL`/`DEFAULT_VOICE_ID`/`VOICES` constants and their outdated pinning tests, and derive `TTSProviderName`/`z.enum` from shared `TtsProvider`/`TTS_PROVIDERS`.
- Add a runtime `@vela/common/contracts/tts` subpath export to avoid importing root-barrel QueryClient/Vue code into Lambda; frontend may keep root-barrel re-exports.

**Tests:** one common resolver test suite covering each provider's defaults, old/null stored values and optional custom ElevenLabs voice, plus strict write-validation tests at the route. Typechecking rejects adapters that reintroduce nullable/internal defaults.


### 2. Update adapters with shared deadline, verified audio and cheap transcript guard

**ElevenLabs:** route passes resolved non-null `voiceId`/`model` (default `eleven_v4`); retain existing REST endpoint and MP3, use `withRequestTimeout()`'s 25s signal. Replace tests of adapter-owned defaults with tests of the resolved request body and content type.

**Gemini:** use the 3.8 **`/v1beta/interactions`** API-key endpoint with `model`, `input`, `response_format:{type:'audio'}` and `generation_config.speech_config`; decode `output_audio.data`. For a complete RIFF/WAVE return bytes unchanged. For a confirmed raw 16-bit mono PCM result, call the small shared `pcm16ToWav(data, 24_000)` utility and return `audio/wav`. Reject empty/odd-byte/malformed or unknown compressed data. Remove unused `outputFormat` and the ~50-line old MIME map/tests. Test Flash and Flash-Lite requests, RIFF/pass-through, PCM/wrapping, errors and timeouts.

**OpenAI:** import `OpenAIRealtimeWS` from `openai/realtime/ws`; use its typed events and an injected SDK-client factory/test seam analogous to `src/llm/providers/openai.ts`. Add direct `ws@^8.21.0` and needed typings for Node 20; keep one short-lived **server-side socket per request**. Send `session.update` with 24k mono PCM, selected voice and verbatim-Japanese instructions; after `session.updated` send one `conversation.item.create` `input_text` and `response.create`. Collect `response.output_audio.delta` PCM bytes and the output transcript (`response.output_audio_transcript.done` or `response.done` output item). At `response.done`, require completed status, nonempty PCM, nonempty transcript, and a **plausible** read-back. Use a deliberately small normalized length-guard calibrated by Step 0 (e.g. transcript >2× input length + slight slack fails); not strict Japanese text equality, since kanji can be transcribed as kana. Add a `ponytail:` comment explaining the heuristic's limited ability to detect short paraphrases. Rejected transcripts **must not be uploaded to S3**. Wrap PCM in the shared WAV helper, return `audio/wav`, and close/terminate the socket on all outcomes.

**Timeout integration for all three:** reuse `REQUEST_TIMEOUT_MS = 25_000` / `withRequestTimeout()` from `apps/vela-api/src/llm/types.ts` rather than adding another timer policy. For WebSocket, connect the abort signal to explicit socket cleanup and named `TimeoutError`. REST fetch uses the signal directly. Change `routes/tts.ts` to recognize `error.name === 'TimeoutError'`, **not** `error.message.includes('timeout')`; avoid re-wrapping timeout errors as a generic `Error`. Keep existing sanitized logging.

**Tests:** SDK-mocked completed/error/close/timeout/partial-response/empty-audio streams; output transcript missing, valid Japanese kana transcription, obvious commentary/paraphrase rejected; WAV header chunk-size/sample-rate; Gemini RIFF/PCM; abort behavior for ElevenLabs and Gemini. No generic realtime abstraction or new background worker.


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
- Enable Save for same-provider model/voice-only edits if `hasApiKey` is true; provider switch requires a freshly entered key. Keep mutation success/error UI and query invalidation as-is.

**Tests:** model/voice options from registry; switching resets incompatible selections; reload shows saved model; same-provider model edit with blank key submits omission; provider-switch without key stays disabled; no false success on save failure. Avoid extra settings framework.


### 5. Focused regression, production build and end-to-end verification

Run common Bun tests, API Bun provider/route tests, API compile, Vitest Settings/service tests, lint and web build. Crucially run **`bun run lambda:build` in `packages/cdk`**, using the actual Node 20/CJS esbuild packaging path: new OpenAI Realtime `ws` imports must work in production, not just Bun-target builds.

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
- **Gemini format:** vendor documents unary WAV, but sniff actual bytes; wrap only confirmed raw PCM16, not arbitrary unsupported formats. Include live 3.8 smoke testing.
- **Bundle:** Node 20 deployed Lambda is esbuild/CJS, not Bun; validate SDK Realtime and `ws` peer through `packages/cdk` build. Node runtime modernization is a separate maintenance task.
- **Cost and architecture:** OpenAI is about $0.60 / 1M text input tokens and $20 / 1M audio output tokens at planning time. Record small-sample latency/cost. No queue, streaming-to-browser, plugin framework, new key storage or second PR.

## Delivery and definition of done

- All feature code, unit tests, focused E2E tests and reviewer fixes land in **this one HPA-757 PR**, not follow-up PRs for the same ticket.
- PR description records completed test commands, screenshots/visual comparison, representative live Japanese provider results, and OpenAI cost/latency findings.
- Mark ready for review only when the real Japanese audio gate and applicable end-to-end checks pass; do not claim these have run at the documentation stage.
