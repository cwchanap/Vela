# HPA-1323 — Server-side BYOK credentials

**Date:** 2026-11-24

**Status:** Design and implementation plan, revised after [review](https://github.com/cwchanap/Vela/pull/106#pullrequestreview-6067727709). Product implementation and acceptance are pending.

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
  | { userId: string; purpose: 'tts'; provider: TtsProvider };

encryptApiKey(context: CredentialContext, apiKey: string): Promise<Uint8Array>;
decryptApiKey(context: CredentialContext, ciphertext: Uint8Array): Promise<string>;
resolveLlmApiKey(userId: string, provider: LlmProvider): Promise<string | null>;
```

Implementation rules:

- Trim the submitted string, then validate **1–4,096 UTF-8 bytes**, using byte length rather than JavaScript character count. Direct symmetric KMS Encrypt has this limit; see the [Encrypt API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html).
- Use `EncryptionContext: { app: 'vela', userId, purpose, provider }` for both Encrypt and Decrypt. Derive user identity from verified Cognito authentication, never request data. Context is logged by AWS, so it must contain no API key or email; see [KMS encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html).
- Store the SDK ciphertext bytes directly. Do not add a custom encryption envelope, application master key or client-side encryption layer.
- Use the backend AWS identity and lazy KMS client; read `CREDENTIALS_KMS_KEY_ARN` at call time and fail safely if absent. Add the LLM table to existing `TABLE_NAMES`, defaulting to `vela-llm-credentials` (same CDK name). Export nondefault resource names/region/endpoint before importing local Hono, because static imports precede its manual dotenv loading. Do not rely on development-only `c.env` in Lambda.
- Keep raw keys transient in credential submission handling and the outbound provider invocation. Do not put them in logs, normal API responses, profile objects, query caches or a process-wide decrypted-key cache.
- Metadata queries use strongly consistent reads without decryption. Explicit replace/remove operations use normal last-committed-write semantics; no new credential version protocol is needed.

Add the LLM repository alongside the existing repositories in `dynamodb.ts`: `listConfiguredProviders`, `get`, `put`, and `delete`, all scoped by user. Follow the existing table-name convention above. Preserve the existing TTS repository rather than adding a second persistence abstraction.

### Infrastructure

Add the on-demand LLM table and symmetric KMS key through the current CDK stacks. Follow existing table backup/removal conventions; set the KMS key to retain on stack removal so a routine stack change cannot schedule loss of decryption access. Pass `LLM_CREDENTIALS_TABLE_NAME` and `CREDENTIALS_KMS_KEY_ARN` to the API Lambda and grant only the table operations and KMS Encrypt/Decrypt it needs. The browser receives neither KMS permissions nor key material. Existing deployment/test operator access remains operational infrastructure.

Add `@aws-sdk/client-kms` using the existing AWS SDK dependency convention. Keep the Lambda build pattern and verify its runtime KMS import resolves. Remove obsolete provider-key environment wiring from the affected backend and frontend examples, including `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY` and the old `VITE_*_API_KEY` entries. Remove the unused `ELEVENLABS_API_KEY` Lambda environment entry as well as obsolete backend Env/buildEnv and config/example references. Google OAuth client configuration is unrelated and stays intact.

### Pre-merge resource bootstrap (implementation only)

Vela has one deployed environment: DatabaseStack uses fixed table names and the existing real local E2E uses the deployed tables with a dedicated test Cognito account. Before the live gate, provision **only DatabaseStack** from this branch using the existing authorized deployment identity, target account/region and deployment configuration. Build/provide Lambda and SPA assets required by CDK synthesis. From `packages/cdk`, run `bunx aws-cdk diff DatabaseStack`; proceed only if the diff adds the new LLM table, retained KMS key and expected additive outputs/policies, without modifying, replacing or deleting existing resources/exports. Serialize with main deployments. Run `bunx aws-cdk deploy DatabaseStack --exclusively`; never deploy the other stacks from the branch. Use the resulting table name/key ARN in local Hono and an authorized runner identity; the Lambda IAM grants and runtime changes go live through the normal post-merge deployment. These are permanent resources, not a disposable test KMS key. Missing permissions, unexpected diff or unavailable resources block live acceptance. No provisioning is performed while this is a docs-only PR.

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

Remove `apiKey` from the public chat and sentence-analysis schemas and client request types. Explicitly reject the retired request field rather than silently accepting it. Resolve the saved credential using `c.get('userId')` (Cognito sub) and selected provider before any upstream call or analysis SSE. The existing email-first `dictionaryUserId = authenticatedUserEmail || authenticatedUserId` is only for dictionary ownership; never use it for credentials or KMS context. Test `resolveLlmApiKey('test-user-id', ...)`, not `test@example.com`, using the existing distinct auth fixture. Keep the existing adapters' internal `apiKey` argument, normalization, model/thinking choices and streaming behavior.

Delete the server-key fallback, its Env fields and `/api/llm-chat/capabilities`; test missing credentials with no upstream call, not removed env branches. Extract existing TTS `sanitizeError`/allowlisted error names into a small `src/utils/sanitize-error.ts` helper and add relevant KMS names. Reuse it in credential, chat, analysis and TTS routes and changed credential-related repository catches (including raw DynamoDB errors). Keep existing adapter sanitization; use fixed safe validation/error messages and no raw SDK/provider exceptions or request bodies.

### TTS atomicity

1. **Nonblank key:** Validate and encrypt first, then perform one DynamoDB update of provider, ciphertext, model and voice. Remove legacy `api_key` in that write. KMS failure leaves the old credential and settings intact.
2. **Blank/omitted key:** Confirm the saved row is configured for the selected provider. Adapt `putRetainingKey` to condition on `#provider = :provider AND attribute_exists(encrypted_api_key)` and update only non-secret settings. No ciphertext equality or legacy no-provider/ElevenLabs condition. Concurrent removal or provider mismatch at write time returns `409`; a same-provider rotation succeeds while retaining the current new key. A metadata write never rewrites or decrypts the key.
3. **Provider switch:** Require a nonblank replacement key. Never borrow an LLM key or silently retain the previous TTS provider's key.
4. **Removal:** Remove `encrypted_api_key` and any residual legacy `api_key` while preserving other settings. Deleting an absent key is successful and must not create a placeholder settings row.
5. **Generation:** Require configured ciphertext, retain the existing S3 cache behavior, and decrypt just before an uncached upstream request using the provider from that same row. Existing `/tts/audio/:vocabularyId` retrieval remains independent of credential decryption. Removing a key blocks new provider requests without deleting cached audio. A request that already acquired a credential may finish; later credential reads must observe removal.

## 6. Client state and Settings

Keep the existing LLM cards and TTS section. Each saved credential has an empty replacement input, a configured/missing state, and explicit replace/remove actions. An eye toggle may reveal only the newly typed draft; it can never retrieve a stored key. Clear a successfully submitted draft unless a newer edit has replaced it in the meantime. Key Settings credential sections by authenticated user ID and unmount on sign-out to drop local drafts. Capture the initiating user, use the existing expected-user transport guard and a simple disposal guard for pending callbacks/notifications (including A→B→A); no new session-generation mechanism.

Repoint and rename the existing `useLlmCapabilitiesQuery` instead of adding a parallel query. Reuse the existing LLM service for status/save/remove with `httpJsonAuth(..., expectedUserId)` and export `llmKeys.credentials(userId)` from the shared query-key factory. Disable signed-out queries, derive expected user from the query key, and invalidate only the initiating user's status. Keep raw keys in local drafts and short-lived service calls, not retained TanStack mutation variables (also for TTS).

`llmSettings` retains only model and thinking preferences. Separate thinking saves from credential writes. Rename/repoint `useServerKeyProviders` and `confirmedServerKeyProviders` or simplify the existing helper. `buildLlmModelOptions(configuredProviders)` takes only provider IDs; remove raw-key parameter and server-key suffixes. Loading/error means unknown rather than confirmed empty. Preserve an unavailable saved default model with missing-key guidance; do not silently change it.

Apply the same expected-user guard, captured initiating-user invalidation and keyed remount to existing TTS settings. Key removal preserves provider/model/voice.

## 7. Profile boundary and breaking cutover

Remove `keys` from the shared `LlmPreferences` contract and all frontend persistent/profile-derived state. Keep `thinking`, `defaultModel`, non-secret reconciliation and current read/write contract metadata. Credential status is a separate response type in the existing common LLM contract, with no AWS dependency.

Reject retired fields before Zod strips them: remove `keys` from `LlmPreferencesSchema` and make it `.strict()`; add `llm_keys: z.never().optional()` to the write-only `PreferencesSchema`, not `PreferencesShape` or the read schema. Explicitly reject ordinary inference `apiKey` fields as well. Return fixed validation messages rather than echoing unknown property names. Reuse existing lenient `LlmPreferencesReadSchema` to project only thinking/defaultModel, including in `preserveStoredLlm()`. Delete `hasUnrecognizedLlmKey` and its obsolete tests; the marker now depends on successful safe sanitization. Keep preference CAS and read/write fence.

Profile reads and successful update responses must be secret-free before cleanup. If a committed update cannot be sanitized, return success with a safe projection omitting malformed preferences and the complete-read marker, never the raw record or a false failure. `auth.ts` already gates LLM replacements on the marker (around line 816) and invalidates/refetches after successful PUT (around line 914); test that path before adding more refetch code.

Add one bounded, idempotent cleanup script for explicitly named profile and TTS tables in the selected environment:

- Default to dry-run, require explicit apply mode, paginate all records and report counts only.
- Remove `preferences.llm.keys`, `preferences.llm_keys` and TTS `api_key` with targeted updates. Do not copy plaintext into the new encrypted store.
- Preserve all non-secret preferences, TTS selections, history, dictionaries and S3 objects. Conditionally REMOVE only existing retired attributes. Do not bump `preferences_version` or timestamps: the strict backend rejects retired secret-bearing writes and cannot preserve old keys; the cleanup changes no client-visible preference.
- Do not overwrite newly saved ciphertext or whole preference records. Re-running the script makes no further changes when legacy fields are absent.
- Before merge verify full-table cleanup only against fresh, uniquely named DynamoDB Local fixture tables, using `packages/cdk/docker-compose.yml`, explicit loopback endpoint and dummy credentials. Never run the cleanup against shared AWS tables before deployment (including as part of the live suite). The real AWS dry-run/apply/dry-run is post-deployment. Cleanup covers active records; historical backups retain their existing retention. Previously exposed keys may remain in old backups/client caches/logs; recommend rotation at re-entry.

**Cutover order:** Provision the new resources and deploy the strict backend, retire/drain the old writer, run cleanup, then verify the new client with re-entered test credentials. A short maintenance/reload window is acceptable. The existing deploy workflow deploys all stacks together, so its frontend may be available before cleanup; the strict backend must already return secret-free responses and ignore legacy plaintext for generation. Put cleanup and its zero-remaining-fields check after backend deployment and at least 60 seconds (the configured Lambda timeout) after stopping old writer traffic, using the existing serialized deployment flow or its documented equivalent. No dual-write or zero-downtime migration framework is needed.

Rollback must retain the ciphertext/KMS key and keep the strict secret boundary; fix forward or temporarily disable affected features. Do not restore a plaintext-reading/writing backend after cleanup. Deployment and cleanup are future implementation work, not actions performed by this documentation PR.

## 8. Validation and end-to-end acceptance

Focused backend, store/component and CDK regressions cover exact context passed to both Encrypt and Decrypt, UTF-8 limits, failed replacement preserving prior value, purpose separation, dictionary sub rather than email, TTS removal/provider mismatch and same-provider rotation, safe profile PUT fallback, missing-key no-upstream behavior, and unchanged profile CAS. Use two synthetic authenticated subjects for route-level list/save/remove/use isolation and mocked browser account switches for client isolation. No second live account or standalone wrong-context test of AWS itself.

### Real integration path

After §4's DatabaseStack-only bootstrap, add an opt-in one-worker Chromium suite (`playwright.byok.config.ts` / `e2e/byok-live.spec.ts`) with no retries. Reuse real Cognito fixture and local web/Hono servers, the actual deployed DynamoDB tables, new LLM table/KMS key, existing S3 and provider APIs. This environment is shared with production: only the dedicated disposable test account's rows and uniquely test-created artifacts may be touched. Verify target AWS account/region/resource names and authenticated test subject, and fail preflight if pre-existing non-test credential state would be overwritten. No shared-table scans/cleanup; test cleanup is scoped to test-created IDs. Verify the full-table script separately on DynamoDB Local. Local Hono proves the backend integration, not deployed Lambda IAM.

Use one test account and two distinct valid same-provider LLM/TTS keys (OpenAI is suitable); test a second LLM provider slot synthetically. Fail preflight with missing variable names only; skipped tests are not acceptance. Exclude the paid suite from normal/mocked discovery. Use Node `fetch` with real auth for key submission; keys remain in runner env and out of frontend build env and Playwright steps. Disable trace/video/HAR/automatic screenshots and request-body logging. Inspect only safe Boolean assertions and reports; take selected screenshots with empty/synthetic inputs.

Inspect actual reports and screenshots through MCP (GitHub MCP for CI or Browser MCP for sanitized local results). Mocked UI alone is insufficient. Missing resources, permissions, credentials or MCP evidence leave the live gate pending and PR draft. Deployed Lambda IAM smoke and real shared-table cleanup are after normal main deployment.

### Acceptance checklist

- [ ] **Save and use:** Save distinct same-provider LLM/TTS keys, reload with empty inputs and configured status, then complete real chat, sentence-analysis SSE and uncached TTS generation/playback. Verify a second LLM slot is independent.
- [ ] **Encryption:** Inspect test rows without printing their values; only ciphertext fields exist. Successful real feature calls prove decrypt/use. Focused tests assert the exact context passed to both KMS commands; no redundant standalone live wrong-context call.
- [ ] **Client boundary:** Profile GET/PUT, settings/status responses and normal chat/dictionary/TTS requests contain no saved key. Only explicit credential submissions carry a newly entered key.
- [ ] **Purpose separation:** Replace/remove each purpose independently. The other still works. Invalid/missing keys produce configuration/provider errors without fallback; removal stops new upstream work and retains cached audio.
- [ ] **Ownership:** Two-subject backend route tests prove B cannot see/use/change A's credentials; signed-out calls fail. Mocked browser account switches verify draft/metadata isolation; the live suite uses one actual authenticated test account.
- [ ] **Preferences:** Model/thinking/voice edits preserve credentials; an unrelated profile save cannot resurrect removed keys. Keep non-secret preference CAS and session regressions passing.
- [ ] **Cutover:** DynamoDB Local representative legacy records lose plaintext fields, require re-entry, preserve non-secret data, ciphertext and CAS version, and remain clean on rerun. Shared-table cleanup is post-deployment only.
- [ ] **Visuals:** MCP inspection of Settings and model-picker screenshots covers configured, missing, replacement, removal and error states, with no clipping or overflow at the existing desktop and narrow web layouts. No mockup is attached; if one is added, check visual parity with it. One web platform is sufficient; no native or human acceptance gate.
- [ ] **Implementation evidence:** Affected tests/build/lint/CDK checks, the actual E2E report and safe screenshots are recorded on this same PR before it becomes ready. Documentation alone does not complete HPA-1323.

After the existing main-branch deployment, verify the deployed Lambda's credential save/decrypt/use path and the completed plaintext cleanup. Record that release verification on the same PR/ticket; it is a post-deployment check, not a prerequisite for making the implementation PR ready.

## 9. Source references

Code observations above are from the pinned base, not assumptions about unmerged work:

- [Profile sanitization and preservation](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/profile-preferences.ts) and [profile routes](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/routes/profiles.ts).
- [DynamoDB repositories](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/dynamodb.ts), [TTS route](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/routes/tts.ts), [LLM route](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela-api/src/routes/llm-chat.ts) and [client LLM service](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela/src/services/llm/index.ts).
- [Real browser configuration](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela/playwright.config.ts), [Cognito fixture](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/apps/vela/e2e/fixtures/auth.ts) and [existing E2E workflow](https://github.com/cwchanap/Vela/blob/0fe3a4e0b9a8c404b5673490f88fcbfccadc5372/.github/workflows/e2e.yml).
