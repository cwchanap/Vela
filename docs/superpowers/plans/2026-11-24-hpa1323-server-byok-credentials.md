# HPA-1323 — Server-side BYOK Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save users' LLM and TTS API keys as server-side ciphertext and use them through the authenticated backend without returning saved keys to clients.

**Architecture:** Add one DynamoDB LLM credential table and replace plaintext in the existing TTS settings row with direct AWS KMS ciphertext. A small backend helper shares encryption code while purpose-bound records remain independent. Existing Vue Settings and model pickers consume user-scoped status; model/thinking/voice preferences retain their existing home.

**Tech Stack:** Bun/Turborepo, TypeScript, Hono, AWS SDK v3, Cognito, DynamoDB, KMS, AWS CDK, Vue 3/Quasar, Pinia, TanStack Query, Bun Test, Vitest and Playwright Chromium.

**Spec:** [Server-side BYOK design](../specs/2026-11-24-hpa1323-server-byok-credentials-design.md)

**Date:** 2026-11-24

**Linear:** [HPA-1323](https://linear.app/cwchanap/issue/HPA-1323)

**Base inspected:** `main` at `0fe3a4e0b9a8c404b5673490f88fcbfccadc5372`

**Status:** Documentation only. Every implementation and acceptance checkbox below remains pending.

## Global Constraints

- **One PR:** Continue on this draft PR for implementation, infrastructure, tests and evidence. Do not merge the docs separately or open a second implementation PR.
- **Separate purposes:** One LLM key per supported provider; one selected TTS provider/key per user. Never reuse a credential across purposes, including for the same provider.
- **Small architecture:** One KMS key per environment, direct Encrypt/Decrypt, no custom envelope, plaintext cache, new service, per-user secrets resources or second credential-version protocol.
- **Public boundary:** Saved keys are never returned. Only explicit credential submissions carry a new key; ordinary profile/chat/analysis/TTS-generation requests do not.
- **Breaking cutover:** Remove active legacy plaintext and require re-entry. No compatibility layer, shared paid fallback, dual writes or plaintext fallback.
- **Preserve behavior:** Keep non-secret preferences, profile CAS/read-write contract, provider registries, SSE, chat/dictionary data and cached audio.
- **Verification:** Actual backend/DynamoDB/KMS/provider E2E and screenshot inspection through MCP on one web platform. No native or human acceptance gate; no mockup is currently attached.
- **Scope:** No provider expansion, layout redesign, billing, art or SFX. Do not provision, deploy or remove live data while this PR is documentation only.

## Review Focus

1. Malformed stored preferences after a successful PUT must never make the response fall back to raw secrets, nor turn a committed write into a reported failure — Task 3.
2. A TTS metadata save racing key replacement/removal must not resurrect or pair the wrong key with a provider — Task 2.
3. An account switch or a newer typed replacement during an asynchronous save must not expose a previous draft or clear the new one — Task 4.
4. Multibyte/oversized input and KMS failure must reject safely before replacing any existing credential/settings — Task 2.
5. Cleanup running after deployment, then running again, must preserve non-secret settings and newly saved ciphertext and leave zero active legacy fields — Task 5.

## File Map and Interfaces

Paths are relative to the repository root. Reuse the current large repository files; this task does not need a general persistence refactor.

| Boundary | New files | Existing files to change |
| --- | --- | --- |
| Shared contracts/infrastructure | None | `packages/common/src/contracts/llm.ts`, `packages/common/src/contracts/tts.ts`, `packages/common/src/index.ts`; `packages/cdk/lib/database-stack.ts`, `packages/cdk/lib/api-stack.ts`; API `package.json`, `bun.lock`, environment examples |
| Credential storage/API | `apps/vela-api/src/credentials.ts`, `apps/vela-api/src/routes/credentials.ts` | `apps/vela-api/src/dynamodb.ts`, `src/env.ts`, `src/types.ts`, `src/index.ts`, `src/routes/tts.ts` |
| Existing consumers/profile boundary | None | `apps/vela-api/src/validation.ts`, `src/routes/llm-chat.ts`, `src/routes/my-dictionaries.ts`, `src/profile-preferences.ts`, `src/routes/profiles.ts` |
| Client credential state | `apps/vela/src/services/credentialsService.ts`, `src/composables/queries/useLlmCredentialsQuery.ts` | Existing LLM/TTS services, queries, Settings components, `llmSettings`, `auth`, model options, Chat and Dictionary pages |
| Cleanup | `apps/vela-api/scripts/remove-legacy-api-keys.ts` | Deployment runbook in this spec/plan; `.github/workflows/deploy.yml` only if automating the existing post-deploy sequence |
| Live acceptance | `apps/vela/playwright.byok.config.ts`, `apps/vela/e2e/byok-live.spec.ts` | Existing real auth fixture, normal Playwright exclusion, app package script and mocked Settings fixtures/specs |

Public contracts are fixed by the spec: `GET/PUT/DELETE /api/credentials/llm[/provider]`, existing `GET/POST /api/tts/settings`, and `DELETE /api/tts/settings/key`. Use `['llm-credentials', userId]` for the LLM status query. Keep provider IDs unchanged (`google` for LLM, `gemini` for TTS).

## Task 1 — Add the shared status contract and AWS resource wiring

**Files:** Modify `packages/common/src/contracts/llm.ts`, `packages/common/src/contracts/tts.ts`, `packages/common/src/index.ts`, `packages/cdk/lib/database-stack.ts`, `packages/cdk/lib/api-stack.ts`, `apps/vela-api/package.json`, `apps/vela-api/src/env.ts`, `apps/vela-api/src/types.ts`, `.env.example`, `apps/vela-api/.env.example`, and `bun.lock`. Tests: `packages/common/src/contracts/llm.test.ts`, `packages/cdk/test/database-stack.test.ts`, `packages/cdk/test/api-stack.test.ts`, `apps/vela-api/test/env.test.ts`.

**Produces:** `LlmCredentialStatus = { configuredProviders: LlmProvider[] }`; `LlmCredentialMutationResult = { provider: LlmProvider; configured: boolean }`; Lambda configuration `LLM_CREDENTIALS_TABLE_NAME` and `CREDENTIALS_KMS_KEY_ARN`. `LlmPreferences` retains `thinking` and `defaultModel`, with no `keys` member. Keep shared contracts free of AWS imports.

- [ ] Recheck current `main`, HPA-1323 and [HPA-824 / PR #103](https://github.com/cwchanap/Vela/pull/103). Rebase this same branch if needed, preserve unrelated changes, and update the inspected SHA in these documents. Install with `bun install --frozen-lockfile` before implementation; do not turn this task into dependency upgrades.
- [ ] Add focused resource assertions: the new table has `user_id`/`provider` keys, on-demand billing and the established backup/removal convention; exactly one new symmetric KMS key exists with retention; the API receives both configuration values and scoped Encrypt/Decrypt plus necessary table access. Update the existing table count from ten to eleven without weakening its other assertions. Confirm these new assertions fail before changing infrastructure.
- [ ] Add the new table and key to the existing DatabaseStack and connect them to ApiStack. Do not inject AWS permissions or KMS settings into frontend build values. Follow the current stack dependency pattern; preserve all existing logical resource IDs.
- [ ] Add `@aws-sdk/client-kms` consistent with the existing AWS SDK versions and update `bun.lock`. Define/re-export the small status types and remove profile key typing. Add `tts_credential_service_unavailable` to the existing TTS error union for sanitized 503 responses. Remove shared provider-key fields from backend Env/buildEnv and examples; remove obsolete `VITE_*_API_KEY` examples. Keep Google OAuth variables intact.
- [ ] Run `bun --cwd=packages/common run build`, `bun --cwd=packages/common run test:unit`, `bun --cwd=packages/cdk run lambda:build`, and `bun --cwd=packages/cdk run test:unit`. The resource assertions must pass. Shared-type removals intentionally require the following tasks before the full application build; do not deploy a partial branch.
- [ ] Commit this foundation on the same branch after reviewing only its intended file changes.

**Gate:** Resource and contract tests establish the chosen storage layout and permissions. No AWS deployment has been performed by this task.

## Task 2 — Implement encryption, persistence and credential management

**Files:** Create `apps/vela-api/src/credentials.ts`, `apps/vela-api/src/routes/credentials.ts`, `apps/vela-api/test/credentials.test.ts`, and `apps/vela-api/test/routes/credentials.test.ts`. Modify `apps/vela-api/src/dynamodb.ts`, `src/routes/tts.ts`, `src/index.ts`, `test/dynamodb.test.ts`, and `test/routes/tts.test.ts`.

**Consumes:** Task 1's configuration/types and the existing `requireAuth` middleware.

**Produces:** The spec's `CredentialContext`, `encryptApiKey(context, apiKey): Promise<Uint8Array>`, `decryptApiKey(context, ciphertext): Promise<string>`, and `resolveLlmApiKey(userId, provider): Promise<string | null>`. Add `llmCredentials.listConfiguredProviders/get/put/delete` to `dynamodb.ts`; retain `ttsSettings` with optional Binary `encrypted_api_key`, ciphertext-based `putRetainingKey`, and `removeKey(userId): Promise<void>`.

- [ ] Write failing focused tests for trimmed 1–4,096 UTF-8 bytes, including multibyte boundaries; exact encryption context `{ app: 'vela', userId, purpose, provider }`; no database mutation when Encrypt fails; metadata reads with zero Decrypt calls; signed-out credential routes returning 401; and user-derived record keys. Include the exact contract assertions:

  ```ts
  expect(statusBody).toEqual({ configuredProviders: ['openai'] });
  expect(saveBody).toEqual({ provider: 'openai', configured: true });
  expect(removeBody).toEqual({ provider: 'openai', configured: false });
  expect(kmsDecryptCallsForStatus).toBe(0);
  expect(writesAfterFailedEncrypt).toBe(0);
  ```

- [ ] Run the new tests from `apps/vela-api` with `bun test test/credentials.test.ts test/routes/credentials.test.ts`; verify the failure represents missing behavior, then implement the small helper using KMS Encrypt/Decrypt commands. Resolve KMS and the new table configuration after environment initialization; do not capture missing local dotenv values at module import or depend on development-only Hono bindings.
- [ ] Implement user/provider-scoped LLM Query/Get/Update/Delete operations with strongly consistent status/read paths. Store only ciphertext bytes and timestamps. Encrypt before writing replacements. Mount the authenticated routes with the spec's exact success responses. Reject blank/oversized/unsupported inputs and sanitize errors without echoing request values or SDK exceptions. Idempotent delete must succeed for an absent record.
- [ ] Change TTS save to encrypt before its single provider/key/model/voice update and remove legacy `api_key` in that write. Change retained-key conditions from observed plaintext to observed ciphertext. Add `DELETE /api/tts/settings/key`, removing only key fields; an absent row must remain absent. GET status ignores legacy plaintext. Do not decrypt for status or a voice/model-only edit.
- [ ] Extend existing TTS/repository tests for same-provider retention, provider switch requiring a replacement, independent LLM/TTS keys, atomic replacement failure, and a controlled stale retention write after replace/remove. Assert `409` and unchanged current ciphertext/selection for the race. Assert deletion preserves provider/model/voice and an absent-row delete creates no row.
- [ ] Run from `apps/vela-api`: `bun test test/credentials.test.ts test/routes/credentials.test.ts test/dynamodb.test.ts test/routes/tts.test.ts`. Confirm all targeted cases pass, then commit this coherent task on the same branch.

**Gate:** Credential management never returns a saved key; storage metadata requires no decryption; TTS keeps atomic provider/key settings without a new transaction or version system.

## Task 3 — Resolve credentials in existing features and close profile secret paths

**Files:** Modify `apps/vela-api/src/routes/llm-chat.ts`, `src/routes/my-dictionaries.ts`, `src/routes/tts.ts`, `src/validation.ts`, `src/profile-preferences.ts`, and `src/routes/profiles.ts`. Tests: `test/routes/llm-chat.test.ts`, `test/routes/my-dictionaries.test.ts`, `test/routes/my-dictionaries-lambda.test.ts`, `test/routes/tts.test.ts`, `test/routes/profiles.test.ts`, `test/validation.test.ts`, and `test/env.test.ts`.

**Consumes:** Task 2's resolver/decrypt helper and ciphertext repositories. Existing provider adapters continue receiving internal `apiKey` arguments.

**Produces:** Secret-free public inference/profile contracts; chat/analysis use saved LLM keys; uncached TTS uses its saved TTS key; no `/api/llm-chat/capabilities` or shared-key fallback.

- [ ] Add failing consumer tests: both LLM routes resolve the authenticated user's selected provider; no credential returns `400` / `llm_not_configured` even with old fallback env vars set; wrong-purpose credentials are never tried. Reject retired public `apiKey` fields with 400. For sentence analysis, assert missing key is rejected before SSE starts. For TTS, assert Decrypt occurs only on the uncached upstream path, and cached-audio retrieval still works after key removal.
- [ ] Add profile regressions with synthetic secret sentinels in current and legacy paths. GET and successful PUT must omit both paths, including malformed-preferences/throwing-sanitizer fallback. A PUT containing either retired path must fail before `PreferencesSchema`/`.strip()` inside `zValidator` can discard it; a check only before `normalizePreferences` in the route handler is too late. A successful unrelated preference update must not copy legacy keys or recreate a deleted credential. Keep existing CAS/428/read-contract tests, rewriting key-edit fixtures as non-secret thinking/default-model edits.
- [ ] Run those targeted tests to establish the failures, then remove raw-key public request fields and fallback/capabilities code. Resolve LLM credentials before calling adapters or opening analysis SSE. In TTS, decrypt using the provider from the same row immediately before an uncached call. Map KMS/storage failures to the sanitized 503 contract; keep existing provider and cache behavior.
- [ ] Remove key schemas and credential-specific preservation checks from profile preferences. Make `preserveStoredLlm` retain only sanitized non-secret fields. In profile PUT's post-commit sanitization failure path, return success with a safe profile projection omitting malformed preferences/read marker; never send the committed raw object or turn a committed write into an error. Keep `preferences_version` and the remaining read/write fence; do not implement HPA-824's separate reconciliation redesign.
- [ ] Check the affected validation/log/error paths with synthetic values: neither success/error response serialization nor log arguments may contain the sentinel. Replace raw exception logging in these changed paths with fixed safe categories as needed; do not start a repository-wide logging refactor.
- [ ] Run from `apps/vela-api`: `bun test test/routes/llm-chat.test.ts test/routes/my-dictionaries.test.ts test/routes/my-dictionaries-lambda.test.ts test/routes/tts.test.ts test/routes/profiles.test.ts test/validation.test.ts test/env.test.ts`, then `bun run compile` and `bun run test:unit`. Commit after the targeted regressions and API gates pass.

**Gate:** Existing backend features use only purpose-matched stored ciphertext, and no profile response/write-preservation branch can expose or restore the retired secret fields.

## Task 4 — Move Settings and model availability to user-scoped metadata

**Files:** Create `apps/vela/src/services/credentialsService.ts`, `src/services/credentialsService.test.ts`, `src/composables/queries/useLlmCredentialsQuery.ts`, and `src/composables/queries/useLlmCredentialsQuery.test.ts`. Modify `src/stores/llmSettings.ts`, `src/stores/auth.ts`, `src/services/llm/index.ts`, `src/services/ttsService.ts`, `src/composables/queries/useTTSQueries.ts`, `src/utils/llmModelOptions.ts`, `src/pages/chat/AIChatPage.vue`, `src/pages/dictionary/MyDictionariesPage.vue`, and Settings components `LlmProviderCard.vue`, `LlmProvidersSection.vue`, `TtsSection.vue`. Remove `useLlmCapabilitiesQuery.ts` / its obsolete test and `useServerKeyProviders.ts` after migrating their callers.

**Tests to adapt:** Adjacent store/service/component tests, including `llmSettings.account.test.ts`, `profileHydration.test.ts`, `auth.test.ts`, `useTTSQueries.test.ts`, and `LlmProvidersSection.capabilities.test.ts` (rename it to describe credential status).

**Consumes:** Task 1's metadata types and Task 2's endpoints. **Produces:** `listLlmCredentials(expectedUserId): Promise<LlmCredentialStatus>`, `saveLlmCredential(provider, apiKey, expectedUserId): Promise<LlmCredentialMutationResult>`, `removeLlmCredential(provider, expectedUserId): Promise<LlmCredentialMutationResult>`, and `removeTTSKey(expectedUserId): Promise<{ success: true }>`; `buildLlmModelOptions(configuredProviders)` uses metadata only.

- [ ] Add failing tests for metadata-scoped availability, empty saved-key inputs, separate credential/thinking saves, explicit remove, and missing/unknown status preserving the saved model selection. Test an account switch while a secret save is pending and a user typing a new replacement before the old save completes. Assert that the wrong user's cache/draft is never touched and a newer draft remains intact.
- [ ] Implement the service/query using `httpJsonAuth(..., expectedUserId)` and query key `['llm-credentials', userId]`. Disable signed-out queries; invalidate the initiating user after save/remove. Capture identity/session generation for callbacks. Keep secret strings in short-lived local drafts/service calls, not persisted Pinia state or retained mutation variables.
- [ ] Remove `LlmSelection.apiKey`, profile-key cloning/mutations and all inference payload keys. Keep default/thinking preferences in `llmSettings`, with a separate thinking-save operation. Adapt `auth` only where the changed profile shape or safe PUT projection requires it; a response without a complete snapshot must refetch safely. Preserve generic reconciliation/session behavior and convert its raw-key examples into non-secret edits.
- [ ] Update LLM cards to show configured/missing status, blank replacement fields and explicit save/replace/remove. Blank replacement performs no credential write. Keep existing thinking controls independent. Clear a submitted draft only on success and only if unchanged; clear all secret drafts on session change. Replace shared-fallback copy/availability in Settings and Chat, with loading/error/retry handling. Keep the saved model selected when its credential is removed.
- [ ] Apply expected-user guards to existing TTS reads/saves and new removal. Capture initiating identity in `useTTSQueries`; do not invalidate the account active at settlement. Add remove to `TtsSection`, retain model/voice selection, and apply the same draft reset/stale callback protections. Keep current provider-switch and blank-key retention UX.
- [ ] Run focused Vitest coverage with `bun --cwd=apps/vela run test:unit -- src/pages/settings/components src/stores/llmSettings src/services/credentialsService.test.ts src/composables/queries/useLlmCredentialsQuery.test.ts src/composables/queries/useTTSQueries.test.ts`, then `bun --cwd=apps/vela run test:unit`, `bun --cwd=apps/vela run lint`, and `bun --cwd=apps/vela run build`. The web build performs its configured Vue/TypeScript checks; there is no separate app `typecheck` script. Commit the client integration on this branch.

**Gate:** Reload shows only status and empty key inputs; normal client requests contain no API key; one user's save/status cannot affect another account; non-secret preference behavior remains covered.

## Task 5 — Add and verify the bounded plaintext cleanup

**Files:** Create `apps/vela-api/scripts/remove-legacy-api-keys.ts` and `apps/vela-api/test/scripts/remove-legacy-api-keys.test.ts`. Update this spec/plan's cutover runbook with exact final commands; change `.github/workflows/deploy.yml` only if choosing an automated post-deploy invocation rather than executing the documented sequence with the existing deploy role.

**Interface:** A small script with required `--region`, `--profiles-table` and `--tts-table`, default dry-run, and explicit `--apply`. It uses the AWS SDK credential chain, paginates Scan, updates only the three known legacy paths, and prints counts/operation categories without record values. Missing/ambiguous targets fail before mutation. No secret migration or new service is introduced.

- [ ] Add fixtures covering current `preferences.llm.keys`, legacy `preferences.llm_keys`, plaintext TTS `api_key`, an already-encrypted TTS row, and clean records. Test dry-run performs no writes; apply preserves all unrelated values; a modified profile receives a new existing `preferences_version` and timestamp; pagination is consumed; and a second apply makes zero changes. Capture logs and assert synthetic key values are absent.
- [ ] Run `bun --cwd=apps/vela-api test test/scripts/remove-legacy-api-keys.test.ts` to observe the expected failure, then implement targeted REMOVE operations. Never replace an entire preference/TTS object or overwrite `encrypted_api_key`. Skip clean records; advance the existing profile CAS version atomically only when removing fields. Keep non-map/missing parent paths safe without inventing a generic migration framework.
- [ ] Run the focused test to green. Exercise dry-run/apply/dry-run against representative isolated test rows during Task 6; final remaining-field counts must be zero. Preserve test history/audio sentinels and new ciphertext; do not print their contents.
- [ ] Document the future production order: deploy strict backend/resources through the existing serialized workflow; ensure the old Lambda writer has drained (wait at least its configured maximum invocation timeout after the code update and retire any old traffic target); then run the explicitly targeted cleanup and zero-remaining-fields verification. Updated frontend may already be published by `cdk deploy --all`; its backend must be secret-free before cleanup. A short reload/maintenance window is acceptable.
- [ ] Keep ciphertext/KMS resources on failure and fix forward; do not restore plaintext-reading/writing code. Record that historical backups retain their existing retention. Commit the script, tests and bounded runbook in this PR; do not run production cleanup while implementing the draft.

Example invocation, with explicit test resource names supplied through the environment:

```bash
bun apps/vela-api/scripts/remove-legacy-api-keys.ts --region "$AWS_REGION" --profiles-table "$PROFILES_TABLE_NAME" --tts-table "$TTS_SETTINGS_TABLE_NAME"
bun apps/vela-api/scripts/remove-legacy-api-keys.ts --region "$AWS_REGION" --profiles-table "$PROFILES_TABLE_NAME" --tts-table "$TTS_SETTINGS_TABLE_NAME" --apply
```

**Gate:** The cleanup is idempotent, preserves non-secret data and cannot erase a new encrypted credential. Actual release cleanup remains a post-deployment action, distinct from pre-merge test-fixture verification.

## Task 6 — Prove UI behavior and the real backend integration through MCP

**Files:** Modify `apps/vela/e2e/fixtures/syntheticAuth.ts`, `e2e/llm-settings.spec.ts`, `e2e/chat-sidebar.spec.ts`, `e2e/fixtures/auth.ts`, `playwright.config.ts`, and `package.json`. Create `playwright.byok.config.ts` and `e2e/byok-live.spec.ts`. Keep evidence under ignored `.artifacts/`; never commit credentials, auth state or raw rows.

**Interfaces:** Add `test:e2e:byok` → `playwright test --config playwright.byok.config.ts`. Reuse/parameterize the existing real `seedAuthSession` helper for the two test identities rather than creating a second auth implementation. Reuse the raw authenticated API pattern in `e2e/api.spec.ts`; secret writes use native Node `fetch`, not Playwright request/step arguments. Add `@aws-sdk/client-kms` and `@aws-sdk/client-s3` as app dev dependencies, matching existing AWS SDK versions, for runner-only context checks and test-object cleanup; update `bun.lock`. They must not enter browser imports.

- [ ] Update synthetic auth fixtures to keep credential metadata separate from profile preferences and mock only the dedicated credential endpoints. Adapt existing Settings/two-tab preference scenarios to the new contract and non-secret conflict examples. Add save/replace/remove, failed save, account switch and distinct same-provider LLM/TTS cases. Assert the synthetic key appears only in its explicit credential write; profile/chat/analysis requests omit it. Run `bun --cwd=apps/vela run test:e2e:mocked -- e2e/llm-settings.spec.ts e2e/chat-sidebar.spec.ts`.
- [ ] Add the opt-in live config with Chromium, one worker, no retries, and trace/video/automatic screenshots off. Inherit the real config's local web/API servers and test-client environment overrides; use actual isolated Cognito/DynamoDB/KMS/S3 resources and provider APIs, without HTTP interception. Exclude `byok-live.spec.ts` from the normal config; mocked config already has an explicit test list. Keep reports sanitized and capture only deliberate safe screenshots.
- [ ] Add a fail-fast preflight for the variables below. Missing values report variable names only and cause failure when this explicit suite is invoked; do not inherit the fixture's local missing-credentials skip as a passing acceptance result. Check the two account identities and two provider keys differ without printing values.

| Input | Environment names |
| --- | --- |
| Existing Cognito fixture | `TEST_EMAIL`, `TEST_PASSWORD`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_TEST_CLIENT_ID`, `VITE_AWS_REGION` |
| Second isolated account, new suite variables | `TEST_EMAIL_B`, `TEST_PASSWORD_B` |
| Distinct same-provider secrets, new suite variables | `E2E_LLM_OPENAI_KEY`, `E2E_TTS_OPENAI_KEY` |
| Real AWS backend resources | `AWS_REGION`, `LLM_CREDENTIALS_TABLE_NAME`, `CREDENTIALS_KMS_KEY_ARN`, `PROFILES_TABLE_NAME`, `TTS_SETTINGS_TABLE_NAME`, `TTS_AUDIO_BUCKET_NAME`, and existing chat/dictionary table configuration for the isolated test environment |
| AWS authorization | The existing SDK credential chain with permission for Cognito test authentication, the named test tables/bucket and KMS. Do not require or print literal access-key variables when using a role/SSO session. |

- [ ] Implement the live acceptance sequence below, using the provider registries' existing supported model/voice choices. Keep live secrets out of `locator.fill`, Playwright step parameters, assertion diffs and request logging. Use Node `fetch` to save keys, then reload and exercise the actual browser. The synthetic suite proves UI key-entry behavior; the live suite proves authenticated storage/decrypt/use.

| Order | Live assertion |
| --- | --- |
| 1 | Save two distinct OpenAI keys for LLM/TTS through their authenticated endpoints; inspect test rows in memory and assert ciphertext exists and plaintext is absent using Boolean assertions only. Configure a second LLM provider with a synthetic key to prove independent slots without a paid call. |
| 2 | Reload Settings; configured status is visible and replacement inputs are empty. Perform a short chat in the browser, sentence analysis through the real SSE endpoint/UI flow, and uncached TTS with a unique vocabulary ID. Verify completed responses and browser audio playback. |
| 3 | Replace the LLM key with an invalid synthetic value; LLM fails without fallback while uncached TTS still works. Restore LLM. Remove/replace TTS independently; LLM still works, TTS errors when missing/invalid, and its selections/cached audio remain. Remove LLM and verify model availability changes without changing the saved default preference. |
| 4 | Restore A's valid credentials, then authenticate B in a separate context. B initially sees no configured key and cannot use A's LLM key: its own chat request returns `llm_not_configured` while A remains configured. B's save/delete must leave A's stored credential unchanged. Signed-out calls fail, and adding a caller-supplied identity never gives access to A. Compare in-memory predicates, not values in test output. |
| 5 | Save non-secret preferences and verify keys are unchanged/removed keys stay absent. Exercise the cleanup against known legacy rows in the isolated test tables and rerun to prove zero remaining fields. A fixture ciphertext decrypted with the wrong user/purpose/provider context must be rejected by actual KMS. |
| 6 | In `finally`, remove test credentials and only the test-created chat/dictionary/audio records. Retain no actual key or auth token in output/attachments. |

- [ ] Run `bun --cwd=apps/vela run test:e2e:byok`. Record the tested SHA, command, safe pass/fail counts, resource environment label and screenshot paths. Local Hono against real AWS proves the backend integration; it does not prove the deployed Lambda identity. Task 7 separates that release check.
- [ ] Capture configured, missing, replacement, removal and error states with **synthetic values or empty secret fields** at desktop and narrow web sizes. Inspect the actual screenshots and completed reports via MCP: GitHub MCP for existing mocked CI runs/artifacts, or Browser MCP for a locally served sanitized live report and Settings. Verify readable status/actions, no clipping/overflow, and preservation of the existing layout. If a mockup is later attached, additionally compare visual parity. Do not claim acceptance from mocked CI alone or substitute human/native sign-off.
- [ ] Commit the suite/fixtures and record sanitized evidence on this same PR. If required live resources/credentials or MCP evidence access are unavailable, leave this gate pending and the PR draft; do not mark skipped tests as passed.

**Gate:** One web platform provides both UI regression evidence and an actual authenticated backend/KMS/provider round trip, reviewed through MCP with safe screenshots.

## Task 7 — Finish verification and record the release handoff

- [ ] Run the affected final gates from the repository root, in order. Use configured test/build environment values, never provider keys in frontend variables:

  ```bash
  bun --cwd=packages/common run build
  bun --cwd=packages/common run test:unit
  bun --cwd=apps/vela-api run compile
  bun --cwd=apps/vela-api run test:unit
  bun --cwd=apps/vela run test:unit
  bun --cwd=apps/vela run lint
  bun --cwd=apps/vela run build
  bun --cwd=packages/cdk run lambda:build
  bun --cwd=packages/cdk run test:unit
  bun --cwd=packages/cdk run lint
  bun --cwd=packages/cdk run cdk:synth
  ```

  `cdk:synth` needs a built web asset directory (the preceding build supplies it) or explicit `CDK_SPA_DIST_PATH`; the script supplies its local OAuth placeholder flag. Fix failures caused by this work. Keep the existing Lambda SSE regression and verify the KMS import resolves under the current externalized-AWS-SDK build pattern; no broad bundler rewrite.
- [ ] Review the full branch once for remaining `preferences.llm.keys` / `preferences.llm_keys`, client `apiKey` payloads and shared-key fallback. Remaining references must be intentional rejection/cleanup fixtures, transient credential submission, internal provider adapters or historical docs. Do not blindly rename every `apiKey` occurrence. Confirm only the intended schemas/routes/configuration changed.
- [ ] Re-run only failed or newly affected tests, then inspect the actual CI state and Task 6 artifacts through MCP. Record exact results and any pending gate in the PR; address valid review findings on this same branch. Keep implementation checkboxes honest.
- [ ] Mark the PR ready only after the pre-merge gates below pass. Do not require a new staging platform or a pre-merge production deployment. Preserve the separately listed release steps for the existing deployment after merge.

### Pre-merge acceptance checklist

- [ ] Direct KMS storage, purpose/user/provider binding and scoped CDK wiring are covered by passing tests.
- [ ] Profile/settings responses and normal feature requests are secret-free, including profile PUT fallback and stale client writes.
- [ ] LLM/TTS replacement/removal are independent; no shared fallback; TTS atomic retention, cached audio and non-secret settings are preserved.
- [ ] Session-scoped metadata/drafts and existing non-secret preference reconciliation regressions pass.
- [ ] Representative legacy cleanup succeeds against isolated test data, preserves ciphertext/non-secret data and makes zero changes on rerun.
- [ ] Actual local Hono/web/Cognito/test DynamoDB/KMS/S3/provider E2E passes and its report/screenshots are inspected through MCP. Frontend mocks alone are insufficient.
- [ ] The final test/build/lint/CDK gates pass, and this single PR contains the reviewed implementation plus safe evidence.

### Post-deployment release verification

After the implementation PR is merged and the existing deploy workflow updates the target environment, execute the documented old-writer drain and explicitly targeted cleanup. Verify zero active legacy fields. Then smoke-test the **deployed** authenticated credential save/read/use path with an authorized account and safe evidence, including Lambda's ability to import the KMS client and Encrypt/Decrypt with its actual IAM role. A deployed app does not automatically accept the local fixture's test-client tokens: use the deployment's supported authentication configuration, without broadening production JWT trust for this smoke test. Confirm cached audio and non-secret preferences remain intact. Record this release outcome separately; it is not already proved by the local integration suite or the documentation PR.
