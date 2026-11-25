# HPA-1323 — Server-side BYOK credentials

**Date:** 2026-11-24

**Status:** Design and implementation plan; product implementation and acceptance are pending.

**Linear:** [HPA-1323](https://linear.app/cwchanap/issue/HPA-1323)

**Implementation plan:** [Single-PR plan](../plans/2026-11-24-hpa1323-server-byok-credentials.md)

**Base inspected:** `main` at `0fe3a4e0b9a8c404b5673490f88fcbfccadc5372`

**Delivery:** Keep this design, implementation, infrastructure, tests and acceptance evidence in the same draft PR. Do not merge the documentation separately or open another implementation PR for this ticket.

## 1. Goal and scope

Store each user's provider API keys encrypted on the server, then resolve them inside the existing authenticated backend when a feature needs them. After submission, the browser receives configuration status instead of the saved key. LLM and TTS credentials stay independent even when both use the same provider.

The product shape stays small:

- LLM has one saved key per supported provider. Chat and sentence analysis use that provider's LLM key.
- TTS has one selected provider and one saved TTS key per user. A provider switch requires a replacement TTS key.
- Model, thinking and voice preferences remain non-secret settings. Credential operations do not participate in profile-preference reconciliation.
- A saved key is persisted, not provider-validated. Provider authentication or permission failures appear when a feature is used.
- This is BYOK throughout the affected paths. A missing or rejected user key must never select an app-funded credential.

This ticket includes the server storage/API, existing feature integrations, Settings controls, infrastructure, removal of active legacy plaintext fields, and automated/MCP acceptance. It does not add providers, billing, a standalone secrets service, a per-provider TTS key library, a new Settings layout, or native-specific work. It introduces no art or SFX.

## 2. Current behavior and related work

The inspected code has three different credential paths:

| Area | Current behavior | Change |
| --- | --- | --- |
| LLM preferences | `preferences.llm.keys` is stored in profiles, returned to the client and loaded into Pinia. | Remove keys from preferences and all profile responses; keep thinking/default-model choices. |
| Chat and dictionary analysis | The client sends `apiKey` with inference requests. Chat also has shared Google/OpenRouter key fallback and `/capabilities`. | Resolve the authenticated user's saved LLM credential on the server; replace fallback capabilities with user-scoped status. |
| TTS | The server already loads the user's saved key and returns `hasApiKey`, but stores plaintext `api_key` alongside its provider/model/voice. | Replace the plaintext field with KMS ciphertext in the same row; add explicit key removal. |

The existing profile path also has two traps: `preserveStoredLlm()` copies raw stored LLM data, and successful profile PUT can return the raw committed record when sanitization fails. Both paths must become secret-free before the cleanup runs. Removing a TypeScript field alone does not fix them.

[HPA-755](https://linear.app/cwchanap/issue/HPA-755) established the current provider cards and separate TTS settings. [HPA-824](https://linear.app/cwchanap/issue/HPA-824) / [draft PR #103](https://github.com/cwchanap/Vela/pull/103) covers remaining profile reconciliation work. Preserve `preferences_version` CAS, the complete-read/write contract and current session protections for non-secret preferences. Adapt key-based fixtures to thinking/default-model changes. Recheck that PR before implementation; this ticket neither depends on its documentation merging nor implements its unrelated reconciliation changes.

## 3. Major decisions

| Decision | Chosen approach | Reason |
| --- | --- | --- |
| Storage layout | Add an LLM credentials table; keep TTS ciphertext in the existing TTS settings row. | LLM secrets leave profiles, while TTS provider/key/model/voice remain one atomic record. No cross-table transaction or TTS settings migration is needed. |
| Encryption | Direct symmetric AWS KMS encryption with one customer-managed KMS key per environment. | Fits short provider keys and avoids managing an application master secret or a custom envelope format. |
| Purpose separation | Separate LLM/TTS records plus KMS encryption context containing application, user, purpose and provider. | The same provider can have different credentials for each purpose. |
| Runtime | One small backend helper module plus the existing DynamoDB repositories and provider adapters. | No extra service, queue, cache or generic credential framework. |
| Client reads | LLM configured-provider IDs and existing TTS `hasApiKey` metadata. | Settings/model pickers need availability, not a key value or fingerprint. |
| Replacement/removal | Nonblank explicit replacement; explicit deletion. | A blank field cannot accidentally erase a saved key. |
| Cutover | Remove legacy plaintext and require key re-entry. | There are no production-user compatibility requirements; dual reads/writes and secret migration add unnecessary work. |
| Delivery | One draft PR for design, implementation and evidence. | Keeps the cross-layer change reviewable as one task. |

The physical layout refines the ticket's original “dedicated credential store” wording: both purposes are outside profile preferences, but they need not share a table. Putting every credential in a new table would require either moving TTS settings or coordinating two writes; neither helps this feature. Per-user KMS/Secrets Manager resources and application-managed AES keys are also unnecessary for the agreed scope.

### Protection boundary and cost

Application-level ciphertext protects keys in database reads/exports that do not also have KMS decryption access. DynamoDB's own at-rest encryption is transparent to an authorized table read, so it does not provide this boundary by itself. The running backend must be able to recover keys for outbound provider calls; compromise of that runtime or its permitted identity remains outside this protection. See [DynamoDB encryption at rest](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html).

Direct KMS adds one Encrypt call per nonblank save and one Decrypt call per uncached provider invocation. Status reads and ordinary settings edits do not call KMS. There is a fixed customer-managed-key charge plus request charges; use [current AWS KMS pricing](https://aws.amazon.com/kms/pricing/) when provisioning. Do not add a plaintext cache to save requests. Automatic key rotation, a credential audit product and additional hardening are deferred.

## 4. Data and encryption contract

| Store | Primary key | Stored fields |
| --- | --- | --- |
| New LLM credentials table | Partition `user_id`; sort `provider` | `encrypted_api_key` as DynamoDB Binary, `created_at`, `updated_at` |
| Existing TTS settings table | Partition `user_id` | Existing `provider`, `model`, `voice_id`, timestamps; optional Binary `encrypted_api_key` |

Only supported provider enums may be written. LLM provider `google` and TTS provider `gemini` retain their existing identifiers; do not create a new shared provider registry. Metadata reports a configured credential when the relevant ciphertext exists. It makes no claim about provider validity or current KMS availability.

The helper in `apps/vela-api/src/credentials.ts` exposes a small server-only interface:

```ts
type CredentialContext =
  | { userId: string; purpose: 'llm'; provider: LlmProvider }
  | { userId: string; purpose: 'tts'; provider: TTSProvider };

encryptApiKey(context: CredentialContext, apiKey: string): Promise<Uint8Array>;
decryptApiKey(context: CredentialContext, ciphertext: Uint8Array): Promise<string>;
resolveLlmApiKey(userId: string, provider: LlmProvider): Promise<string | null>;
```

Implementation rules:

- Trim the submitted string, then validate **1–4,096 UTF-8 bytes**, using byte length rather than JavaScript character count. Direct symmetric KMS Encrypt has this limit; see the [Encrypt API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html).
- Use `EncryptionContext: { app: 'vela', userId, purpose, provider }` for both Encrypt and Decrypt. Derive user identity from verified Cognito authentication, never request data. Context is logged by AWS, so it must contain no API key or email; see [KMS encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html).
- Store the SDK ciphertext bytes directly. Do not add a custom encryption envelope, application master key or client-side encryption layer.
- Use the backend AWS identity and `CREDENTIALS_KMS_KEY_ARN`. Resolve new configuration after the existing environment initialization; lazily create the KMS client. Static route imports happen before local dotenv loading, and Hono's development-only `c.env` injection is not a production configuration source.
- Keep raw keys transient in credential submission handling and the outbound provider invocation. Do not put them in logs, normal API responses, profile objects, query caches or a process-wide decrypted-key cache.
- Metadata queries use strongly consistent reads without decryption. Explicit replace/remove operations use normal last-committed-write semantics; no new credential version protocol is needed.

Add the LLM repository alongside the existing repositories in `dynamodb.ts`: `listConfiguredProviders`, `get`, `put`, and `delete`, all scoped by user. Resolve the new table name after environment initialization as well. Preserve the existing TTS repository rather than adding a second persistence abstraction.

### Infrastructure

Add the on-demand LLM table and symmetric KMS key through the current CDK stacks. Follow existing table backup/removal conventions; set the KMS key to retain on stack removal so a routine stack change cannot schedule loss of decryption access. Pass `LLM_CREDENTIALS_TABLE_NAME` and `CREDENTIALS_KMS_KEY_ARN` to the API Lambda and grant only the table operations and KMS Encrypt/Decrypt it needs. The browser receives neither KMS permissions nor key material. Existing deployment/test operator access remains operational infrastructure.

Add `@aws-sdk/client-kms` using the existing AWS SDK dependency convention. Keep the Lambda build pattern and verify its runtime KMS import resolves. Remove obsolete provider-key environment wiring from the affected backend and frontend examples, including `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY` and the old `VITE_*_API_KEY` entries. Google OAuth client configuration is unrelated and stays intact.

## 5. Public API and feature behavior

All credential routes require authentication and use `c.get('userId')`. No credential endpoint accepts a user ID or offers raw-key retrieval.

| Route | Input | Success response/behavior |
| --- | --- | --- |
| `GET /api/credentials/llm` | None | `200 { configuredProviders: LlmProvider[] }` |
| `PUT /api/credentials/llm/:provider` | `{ apiKey: string }` | `200 { provider, configured: true }`; encrypt before replacing the record |
| `DELETE /api/credentials/llm/:provider` | None | `200 { provider, configured: false }`; idempotent removal |
| `GET /api/tts/settings` | None | Preserve `{ hasApiKey, provider, model, voiceId }`, with status derived only from ciphertext |
| `POST /api/tts/settings` | Existing provider/model/voice fields plus optional replacement `apiKey` | Preserve the existing success response; apply the atomic rules below |
| `DELETE /api/tts/settings/key` | None | `200 { success: true }`; remove the credential while retaining provider/model/voice |

Blank LLM PUT is invalid (`400`); the UI makes no credential request for an empty replacement field. Blank/omitted TTS key retains its current same-provider key under the existing save contract. Unsupported providers or oversized keys return `400`, signed-out access `401`, stale TTS retention `409`, and KMS/storage unavailability a sanitized `503`. Missing LLM configuration returns `400` with `code: 'llm_not_configured'`; retain the existing `tts_not_configured` behavior for TTS. Extend the existing TTS error union with a credential-service-unavailable code if required. Errors and validation output must never echo submitted keys or raw SDK/provider exceptions.

### LLM consumers

Remove `apiKey` from the public chat and sentence-analysis schemas and client request types. Explicitly reject the retired request field rather than silently accepting it. Resolve the saved credential for the authenticated user and selected provider before making an upstream call; sentence analysis must do this before starting its SSE stream. Keep the existing adapters' internal `apiKey` argument, normalization, model/thinking choices and streaming behavior.

Remove the server-key fallback and `/api/llm-chat/capabilities` path. Tests must establish that a missing user credential still fails when old provider-key environment variables happen to be present. Existing provider-error handling stays in place, with any raw-key-bearing exception/log path in these affected flows sanitized.

### TTS atomicity

1. **Nonblank key:** Validate and encrypt first, then perform one DynamoDB update of provider, ciphertext, model and voice. Remove legacy `api_key` in that write. KMS failure leaves the old credential and settings intact.
2. **Blank/omitted key:** Read the saved row. Retain only a configured key for the same provider. Adapt `putRetainingKey` to condition on the observed provider and ciphertext, without rewriting or decrypting the key. A concurrent replace/remove/provider switch causes `409`; it cannot be overwritten by a stale settings edit.
3. **Provider switch:** Require a nonblank replacement key. Never borrow an LLM key or silently retain the previous TTS provider's key.
4. **Removal:** Remove `encrypted_api_key` and any residual legacy `api_key` while preserving other settings. Deleting an absent key is successful and must not create a placeholder settings row.
5. **Generation:** Require configured ciphertext, retain the existing S3 cache behavior, and decrypt just before an uncached upstream request using the provider from that same row. Existing `/tts/audio/:vocabularyId` retrieval remains independent of credential decryption. Removing a key blocks new provider requests without deleting cached audio. An already-started provider call is not canceled by removal.

## 6. Client state and Settings

Keep the existing LLM cards and TTS section. Each saved credential has an empty replacement input, a configured/missing state, and explicit replace/remove actions. An eye toggle may reveal only the newly typed draft; it can never retrieve a stored key. Clear a successfully submitted draft unless a newer edit has replaced it in the meantime. Clear secret drafts on account/session changes.

Introduce `services/credentialsService.ts` and `useLlmCredentialsQuery.ts` with query key `['llm-credentials', userId]`, disabled while signed out. Use the existing `httpJsonAuth(..., expectedUserId)` guard. Invalidate only the initiating user's status after mutations and suppress stale completion callbacks after an account/session change. Avoid long-lived mutation variables containing a raw key; direct service calls with query invalidation fit the existing scale.

`llmSettings` retains only model and thinking preferences. Separate thinking saves from credential writes. Replace `useLlmCapabilitiesQuery`, `useServerKeyProviders` and raw-key model availability with configured-provider metadata in Settings and Chat. Loading/error states must not masquerade as “no key” or a shared fallback. Preserve an unavailable saved default model and explain that its key is missing; do not silently choose another model.

Apply the same session discipline to TTS: its current service ignores the supplied user ID, and its mutation invalidates the user active at settlement. Capture the initiating identity, use the expected-user guard, and reset secret drafts on session changes. Key removal preserves the selected provider/model/voice.

## 7. Profile boundary and breaking cutover

Remove `keys` from the shared `LlmPreferences` contract and all frontend persistent/profile-derived state. Keep `thinking`, `defaultModel`, non-secret reconciliation and current read/write contract metadata. Credential status is a separate response type in the existing common LLM contract, with no AWS dependency.

Before any ordinary profile write schema strips unknown fields, reject known retired secret paths: `preferences.llm.keys` and legacy `preferences.llm_keys`. This check belongs before `PreferencesSchema` parsing in `zValidator`, for example in a raw-input schema preprocessor; a handler-only check before `normalizePreferences()` is too late. `preserveStoredLlm()` may preserve only sanitized non-secret LLM fields. Profile reads and successful update responses must strip legacy secret fields even before cleanup. If a committed update cannot be sanitized, return success with a safe projection that omits malformed preferences and the complete-read marker; never return raw stored data or report an already-committed write as failed. Ensure the client refetches when that projection cannot hydrate its snapshot.

Add one bounded, idempotent cleanup script for explicitly named profile and TTS tables in the selected environment:

- Default to dry-run, require explicit apply mode, paginate all records and report counts only.
- Remove `preferences.llm.keys`, `preferences.llm_keys` and TTS `api_key` with targeted updates. Do not copy plaintext into the new encrypted store.
- Preserve all non-secret preferences, TTS selections, history, dictionaries and S3 objects. If a profile's preferences change, advance its existing `preferences_version` and timestamp atomically so cached writers get the normal CAS conflict. Do not introduce a second version field.
- Do not overwrite newly saved ciphertext or whole preference records. Re-running the script makes no further changes when legacy fields are absent.
- Cleanup covers active records. Pre-existing backup retention is unchanged; no claim is made that historical backups have been purged.

**Cutover order:** Provision the new resources and deploy the strict backend, retire/drain the old writer, run cleanup, then verify the new client with re-entered test credentials. A short maintenance/reload window is acceptable. The existing deploy workflow deploys all stacks together, so its frontend may be available before cleanup; the strict backend must already return secret-free responses and ignore legacy plaintext for generation. Put cleanup and its zero-remaining-fields check after the backend deployment and old-invocation drain, using the existing serialized deployment flow or its documented equivalent. No dual-write or zero-downtime migration framework is needed.

Rollback must retain the ciphertext/KMS key and keep the strict secret boundary; fix forward or temporarily disable affected features. Do not restore a plaintext-reading/writing backend after cleanup. Deployment and cleanup are future implementation work, not actions performed by this documentation PR.

## 8. Validation and end-to-end acceptance

Use focused backend, store/component and CDK tests for deterministic failure cases. Required regressions include encryption-context binding, UTF-8 byte limits, failed replacement preserving the old value, separate LLM/TTS resolution, TTS retention races, secret-free profile PUT fallback, missing-key behavior without fallback, and unchanged non-secret preference CAS.

### Real integration path

Add an explicitly invoked Chromium suite, `playwright.byok.config.ts` / `e2e/byok-live.spec.ts`, with one worker and no retries. Reuse the current real Cognito fixture and local web/Hono servers, connected to **actual isolated test DynamoDB, KMS, S3 and provider APIs**. This is an actual backend integration; it does not establish deployed Lambda IAM behavior by itself. CDK/runtime build checks run before the PR is ready; deployed Lambda smoke verification runs after the existing main-branch deployment. Do not introduce a pre-merge production deployment, new hosting platform or broad CI-secret project for this task.

Preflight must fail with missing environment **names only** when explicitly invoked without required test accounts, AWS configuration or provider credentials; do not count skipped tests as acceptance. Exclude this paid live suite from normal/mocked test discovery. Use two isolated Cognito users and two distinct valid keys for the same provider supporting both purposes (OpenAI is suitable). A second LLM-provider slot can be tested with a synthetic value without making an upstream call.

Live keys stay in runner environment variables. Submit them with native Node `fetch` and a real Cognito token, avoiding Playwright action/step arguments containing actual secrets. The synthetic suite covers entering and saving keys through the UI. Turn off trace, video, automatic failure screenshots, HAR and request-body logging for the live suite. Assert safe codes/booleans instead of dumping keys, rows or raw responses. Capture selected screenshots only after secret inputs are empty.

Run and inspect the actual E2E results and screenshots through MCP. GitHub MCP can inspect CI results/artifacts; Browser MCP can inspect a local sanitized report and live Settings. Existing mocked CI is useful for UI regressions but cannot satisfy live DynamoDB/KMS/provider acceptance. If required credentials or test resources are unavailable, record that gate as pending and keep the PR draft; there is no human sign-off substitute.

### Acceptance checklist

- [ ] **Save and use:** Save distinct same-provider LLM/TTS keys, reload with empty inputs and configured status, then complete real chat, sentence-analysis SSE and uncached TTS generation/playback. Verify a second LLM slot is independent.
- [ ] **Encryption:** Inspect test rows without printing their values; only ciphertext fields exist. Successful real feature calls prove decrypt/use. A focused test with the wrong user/purpose/provider context must fail decryption.
- [ ] **Client boundary:** Profile GET/PUT, settings/status responses and normal chat/dictionary/TTS requests contain no saved key. Only explicit credential submissions carry a newly entered key.
- [ ] **Purpose separation:** Replace/remove each purpose independently. The other still works. Invalid/missing keys produce configuration/provider errors without fallback; removal stops new upstream work and retains cached audio.
- [ ] **Ownership:** Account B cannot see/use/change A's credentials. Signed-out calls fail; user/session switches clear drafts and isolate metadata. Use actual authenticated API paths, not just mocked browser state.
- [ ] **Preferences:** Model/thinking/voice edits preserve credentials; an unrelated profile save cannot resurrect removed keys. Keep non-secret preference CAS and session regressions passing.
- [ ] **Cutover:** Representative legacy test records lose active plaintext fields, require re-entry, preserve non-secret data, and remain clean on rerun.
- [ ] **Visuals:** MCP inspection of Settings and model-picker screenshots covers configured, missing, replacement, removal and error states, with no clipping or overflow at the existing desktop and narrow web layouts. No mockup is attached; if one is added, check visual parity with it. One web platform is sufficient; no native or human acceptance gate.
- [ ] **Implementation evidence:** Affected tests/build/lint/CDK checks, the actual E2E report and safe screenshots are recorded on this same PR before it becomes ready. Documentation alone does not complete HPA-1323.

After the existing main-branch deployment, verify the deployed Lambda's credential save/decrypt/use path and the completed plaintext cleanup. Record that release verification on the same PR/ticket; it is a post-deployment check, not a prerequisite for making the implementation PR ready.

## 9. Source references

Code observations above are from the pinned base, not assumptions about unmerged work:

- [Profile sanitization and preservation](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/profile-preferences.ts) and [profile routes](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/routes/profiles.ts).
- [DynamoDB repositories](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/dynamodb.ts), [TTS route](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/routes/tts.ts), [LLM route](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/routes/llm-chat.ts) and [client LLM service](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela/src/services/llm/index.ts).
- [Real browser configuration](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela/playwright.config.ts), [Cognito fixture](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela/e2e/fixtures/auth.ts) and [existing E2E workflow](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/.github/workflows/e2e.yml).
