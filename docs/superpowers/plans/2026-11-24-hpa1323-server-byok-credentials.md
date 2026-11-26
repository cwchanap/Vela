# HPA-1323 — Server-side BYOK Credentials Implementation Plan

> Use the existing executing-plans workflow. Track checkboxes; keep all work in PR #106.

**Goal:** Store users' LLM and TTS API keys as server-side ciphertext, with no saved-key readback. **Spec:** [Design](../specs/2026-11-24-hpa1323-server-byok-credentials-design.md) · [Linear](https://linear.app/cwchanap/issue/HPA-1323) · [Review 1](https://github.com/cwchanap/Vela/pull/106#pullrequestreview-6067727709) · [Review 2](https://github.com/cwchanap/Vela/pull/106#pullrequestreview-6068231886)

**Base:** `0fe3a4e0b9a8c404b5673490f88fcbfccadc5372`. Revised November 25, 2026 (review pass 2). Docs only; all implementation/provisioning/acceptance remains pending.

## Constraints

- One PR. Direct KMS, one key per environment; one LLM table keyed user/provider and one independent TTS ciphertext in the existing settings row. No new service, envelope, plaintext cache, shared paid fallback, dual writes, extra version protocol or compatibility layer.
- Keep existing provider adapters, model/thinking/voice settings, preference CAS, SSE, history and cached audio. Recheck HPA-824 / PR #103; preserve non-secret reconciliation.
- Keep compiling commits: Task 1 additive, Task 2 complete TTS vertical path, Tasks 3–4 one coordinated breaking-contract commit. No partial app deployment.
- During implementation only, allow additive DatabaseStack-only provisioning before merge for live tests. No pre-merge running app/API deployment or shared-table cleanup. Full-table cleanup verification runs on DynamoDB Local only; live suite uses a dedicated test account against existing AWS resources.
- Actual authenticated web/Hono/KMS/DynamoDB/provider E2E and MCP inspection of screenshots/results on one web platform. No mockup attached; compare visual parity if added. No native or human acceptance gate, new art/SFX or provider/model expansion.

## Task 1 — Add status contracts and AWS infrastructure

**Files:** `packages/common/src/contracts/llm.ts`, `contracts/tts.ts`, `keys.ts`, `index.ts`; `packages/cdk/lib/database-stack.ts`, `api-stack.ts` and stack tests; `apps/vela-api/package.json`, `src/env.ts`, `src/types.ts`, env examples and `bun.lock`; `apps/vela-mobile/src/services/mobile-tts.ts`, `mobile-tts.test.ts` (shared error-code mapping only).

- [ ] Recheck main/ticket/related PR and shared-contract consumers (web/mobile/extension); rebase same branch as needed. Run `bun install --frozen-lockfile`.
- [ ] Add `LlmCredentialStatus`, `LlmCredentialMutationResult`, `llmKeys.credentials(userId)` to existing shared key factory/barrel and `tts_credential_service_unavailable`. In the same commit as the new TTS error code, extend mobile's exhaustive `STABLE_ERROR_CODE_MAP: Record<TtsApiErrorCode, MobileTtsErrorCode>` with `tts_credential_service_unavailable: 'service_unavailable'` and its `it.each` mapping case. Keep the existing `LlmPreferences.keys` and Env/request fields until their last consumers change.
- [ ] Add tests for new on-demand `vela-llm-credentials` table with `user_id`/`provider`, backup/removal conventions, one retained symmetric key, narrow table/Encrypt/Decrypt role permissions, and Lambda config `LLM_CREDENTIALS_TABLE_NAME` / `CREDENTIALS_KMS_KEY_ARN`. Update existing table count from ten to eleven without weakening other checks. Add and assert explicit non-secret DatabaseStack outputs `CredentialsKmsKeyArn` and `DynamoDBLlmCredentialsTableName` in `database-stack.test.ts`. Preserve existing resource IDs/exports.
- [ ] Implement additive resources in existing stacks; add `@aws-sdk/client-kms` matching existing SDK dependency convention. Keep existing externalized AWS SDK Lambda build. No browser KMS privileges or key config. Run common build/tests, API compile/tests, web build/tests, Lambda build, CDK unit tests, root `bun run typecheck` and `bun --cwd=apps/vela-mobile run test:unit`; commit green. No native-device acceptance is needed.

### Pre-merge resource bootstrap (implementation only)

Vela has one deployed environment with fixed table names; local live E2E uses the deployed resources under a dedicated test Cognito account. Provision **only DatabaseStack** during implementation. Use the authorized deploy identity, explicit intended account/region, and deployment configuration (including existing DSQL protection settings). Build the Lambda asset and use a real built SPA directory (or an explicit existing local synth-only asset directory); `app.ts` constructs AuthStack and StaticWebStack even for a database-only selection. `AuthStack` requires `GOOGLE_OAUTH_CLIENT_ID` or `ALLOW_LOCAL_OAUTH_PLACEHOLDERS=true`. The placeholder is safe only because these commands select DatabaseStack exclusively and do not deploy AuthStack. From the repository root, build Lambda first with `bun --cwd=packages/cdk run lambda:build`; from `packages/cdk` run:

```bash
# Set SPA_DIST_PATH to an existing absolute SPA/synth asset directory.
ALLOW_LOCAL_OAUTH_PLACEHOLDERS=true CDK_SPA_DIST_PATH="$SPA_DIST_PATH" bunx aws-cdk diff DatabaseStack --exclusively
# Proceed only after inspecting the additive-only diff and serializing with main deploys.
ALLOW_LOCAL_OAUTH_PLACEHOLDERS=true CDK_SPA_DIST_PATH="$SPA_DIST_PATH" bunx aws-cdk deploy DatabaseStack --exclusively
```

Proceed only if the diff adds the new LLM table, retained KMS key and expected additive outputs/policies, with no modification, replacement or deletion of existing resources/exports. Never use the placeholder for an AuthStack or full-app deployment. Add explicit non-secret `CfnOutput`s named `CredentialsKmsKeyArn` and `DynamoDBLlmCredentialsTableName` to DatabaseStack and assert them in `database-stack.test.ts`. Read the values from the deployed stack outputs (e.g. `aws cloudformation describe-stacks --stack-name DatabaseStack --region "$AWS_REGION" --query 'Stacks[0].Outputs'`); map them to `CREDENTIALS_KMS_KEY_ARN` and `LLM_CREDENTIALS_TABLE_NAME` for the local runner. The Lambda IAM grants/runtime changes go live only in the normal main deployment. These resources are permanent, not disposable test resources. Missing permissions, unexpected diff or unavailable resources block live acceptance. No provisioning is performed during the docs-only revision.

- [ ] Record completed stack deployment, target region and new resource identifiers; verify no running app/auth/storage code changed. Runner needs authorized AWS access; do not relax production JWT trust. This stage is not part of the current documentation change.

## Task 2 — Implement credential management and complete TTS vertical path

**Files:** new `apps/vela-api/src/credentials.ts`, `src/routes/credentials.ts`, `src/utils/sanitize-error.ts`; modify `src/dynamodb.ts`, `src/index.ts`, `src/routes/tts.ts`; `test/credentials.test.ts`, `test/routes/credentials.test.ts`, `test/dynamodb.test.ts`, `test/routes/tts.test.ts`.

- [ ] Add focused failing tests for trimmed 1–4,096 UTF-8 bytes, exact `{ app: 'vela', userId, purpose, provider }` context passed to both KMS commands, failed Encrypt leaving old credential intact, metadata zero decrypt, two-subject ownership and signed-out denial. Implement `encryptApiKey`, `decryptApiKey`, `resolveLlmApiKey`; lazy KMS config, fail safely if missing ARN. Use `TABLE_NAMES.LLM_CREDENTIALS` with CDK-matching default; export overrides before Hono imports.
- [ ] Add strongly consistent LLM Query/Get and scoped put/delete; binary ciphertext, timestamps. Mount authenticated `GET /api/credentials/llm`, `PUT /api/credentials/llm/:provider`, `DELETE /api/credentials/llm/:provider` with spec's metadata-only responses. No caller identity override; encrypt first, delete idempotently. Two-subject route tests show B cannot list/change/remove A's credentials. Reject invalid inputs with fixed safe errors; 503 for storage/KMS failure.
- [ ] Extract existing TTS allowlisted `sanitizeError` and `extractErrorName` into shared utility, add KMS names; preserve TTS categories/timeout behavior and sanitize changed credential repository catches too, including existing raw DynamoDB error path. Test synthetic secret-bearing error name/message redaction. No general logging rewrite.
- [ ] TTS replacement performs one provider/ciphertext/model/voice update, removing `api_key`. GET status from ciphertext, `DELETE /api/tts/settings/key` removes key only, no absent-row creation. Adapt `putRetainingKey` to condition `#provider = :provider AND attribute_exists(encrypted_api_key)`, no ciphertext equality or legacy-provider clause. Missing/mismatched provider after initial read returns 409; same-provider rotation retains new ciphertext without conflict. Blank key preserves current same-provider key, provider switch needs replacement. KMS failure leaves old row intact.
- [ ] Switch TTS generation in this same task to resolve from the same row; decrypt only for an uncached upstream call, keep `/tts/audio/:vocabularyId` independent of decryption. Test metadata/cache zero decrypt, removal/mismatch race, same-provider rotation, independence and cached audio after removal. No new upstream requests that read after removal. Keep existing provider/cache behavior.
- [ ] Run `bun --cwd=apps/vela-api test test/credentials.test.ts test/routes/credentials.test.ts test/dynamodb.test.ts test/routes/tts.test.ts`, API compile/full tests and web/common build and tests. Commit only when green; no app/API deploy.

## Tasks 3–4 — Coordinated backend + frontend cutover (one green commit)

### Task 3 — LLM consumers and profile boundary

**Files:** API `src/routes/llm-chat.ts`, `src/routes/my-dictionaries.ts`, `src/validation.ts`, `src/profile-preferences.ts`, `src/routes/profiles.ts`, `src/env.ts`, `src/types.ts`; CDK `api-stack.ts`; existing route/profile/validation/env tests.

- [ ] Remove client `apiKey` fields; in both public server inference schemas replace `apiKey` with rejection-only `apiKey: z.never({ error: 'API keys must be configured in Settings' }).optional()`. Do not make the surrounding schemas strict or echo untrusted field names/provider input in validation errors. Resolve the verified `c.get('userId')` with normalized provider before upstream/SSE. In dictionary analysis keep email-first `dictionaryUserId` for dictionary ownership only; assert resolver receives `test-user-id`, not `test@example.com`. Two-subject route tests show generation uses current authenticated subject. Missing key 400 `llm_not_configured` with no upstream call; KMS/storage 503; preserve adapter/effort/SSE behavior. Reuse shared sanitizer; eliminate raw analysis catches.
- [ ] Delete fallback, `/capabilities`, obsolete Env/buildEnv, unused `ELEVENLABS_API_KEY` Lambda env entry and related examples/config references. Keep unrelated Google OAuth configuration. Test missing-key behavior, not removed fallback env fields.
- [ ] Remove keys from `LlmPreferencesSchema`, make `.strict()`, add write-only `llm_keys: z.never().optional()` to `PreferencesSchema` only. Reuse existing lenient LLM read schema for `preserveStoredLlm`; delete `hasUnrecognizedLlmKey` and key-only tests. Add fixed `400 { error: 'Invalid profile update' }` via `zValidator` failure callback on PUT; stop logging raw `parsedPreferences.error` and sanitize affected profile GET/PUT exceptions and malformed-preference logs. Keep successful sanitization marker, CAS and read/write fence for non-secret preferences.
- [ ] Test secret-free profile GET/PUT (legacy synthetic sentinels, malformed stored data, successful commit with failed sanitizer), rejection before stripping, no resurrection on unrelated save. Safe incomplete PUT projection omits malformed preferences/read marker, never raw record or false failure. Assert retired secret-bearing payloads (including sentinel in an unknown strict-schema property name) produce fixed 400 without echoing input or logging raw ZodError, including both inference schemas. Keep safe fixed error messages/logs and non-secret CAS tests. The incomplete PUT projection needs the explicit recovery below, not just the existing marker guard.

### Task 4 — User-scoped Settings and model metadata

**Files:** existing `apps/vela/src/services/llm/index.ts`, `services/ttsService.ts`, `services/authService.ts` (+ tests), `utils/httpClient.ts` (+ tests), `composables/queries/useLlmCapabilitiesQuery.ts` and `useServerKeyProviders` (rename/repoint, including tests), `useTTSQueries.ts`, `stores/llmSettings.ts`, `stores/auth.ts`, `utils/llmModelOptions.ts`, `pages/chat/AIChatPage.vue`, `pages/chat/components/ChatModelPicker.vue`, Dictionary page, `pages/settings/SettingsPage.vue` and existing provider/TTS sections. Shared `contracts/llm.ts`.

- [ ] Reuse existing LLM service/query/helper: status/save/remove on new endpoints, shared `llmKeys.credentials(userId)`, derive expected user from query key and use `httpJsonAuth(..., expectedUserId)`. Signed-out disabled, invalidate initiating user. Expose pending/error/ready + refetch from the existing renamed query. `buildLlmModelOptions(configuredProviders)` has no raw-key parameter or server-key suffix; keep saved selection visible. Pass status to AIChatPage and ChatModelPicker as well as Settings/Dictionary. While pending/error, disable/send-block with checking/retry guidance (before persistence and before upstream); no false missing-key warning. Only confirmed status can show no-key; distinguish retired model when provider is configured.
- [ ] Remove `LlmPreferences.keys`, `LlmSelection.apiKey` and raw-key cloning/saves/inference payloads in the same commit as Task 3 and final consumers. Retain non-secret preference reconciliation, separate thinking saves, no new store/version mechanism. Check shared contract consumers and affected sibling builds.
- [ ] In `authService.ts` detect omitted `preferences` on successful PUT before `normalizeProfileRecord` can default it to `{}`; carry explicit `preferencesOmitted` (or equivalent discriminant) to `auth.ts`. Preserve current non-secret preferences for display, acknowledge committed metadata/version with `preferences_read_contract: null`, skip new preference fingerprints and discard stale tracked preference fingerprint for that incomplete acknowledgment (no synthetic REMOVED_VALUE). Keep old/superseded version and session guards. Use existing post-PUT invalidation/refetch; accept authoritative same-version/same-timestamp GET and restore complete marker. Block further preference saves based on the display-only snapshot until it refreshes; failed GET leaves prior display, reload guidance and no unsafe save. Test omitted vs genuinely empty preferences, fresh equal-time GET, failure/retry, account change in `authService.test.ts` and `auth.test.ts`. Keep this targeted; no generic reconciliation rewrite.
- [ ] Settings shows saved/missing/unknown, empty replacement, explicit remove/save. Blank LLM replacement no request; TTS blank retains matching key. Key both Settings sections by `${authStore.user?.id ?? 'signed-out'}:${authStore.sessionGeneration}`, without v-if hiding signed-out guidance. Reuse existing session-generation guard and captured user ID for pending callbacks/notifications; no custom disposal mechanism. Clear submitted draft only if unchanged. Preserve signed-out cards and test A→B→A/sign-out.
- [ ] Use `httpJsonAuth(url, init, expectedUserId)` for TTS get/save/delete settings; retain parse/cache behavior. Derive query request identity from `ttsKeys.settings(userId)`; pass the existing userId to `getTTSSettings` from generation/audio retrieval. Delete `useUpdateTTSSettingsMutation` and its mocks/exports; call save/delete directly in TtsSection and invalidate only initiating user's query. Avoid retained raw-key mutation variables. Delete duplicate `getAuthHeader()`; remaining raw audio fetches reuse shared `getAuthHeaders` with optional expected-user guard (same check as `httpJsonAuth`) so existing generation timeout and audio 404 behavior do not change. Test identity mismatches and unchanged cache/404 behavior. Removal retains provider/model/voice.
- [ ] Adapt existing store, query, model-option and component tests (`llmSettings.account.test.ts`, `profileHydration.test.ts`, `auth.test.ts`, `useTTSQueries.test.ts`, renamed capability tests, `SettingsPage.test.ts`, `TtsSection.test.ts`, `AIChatPage.test.ts` and ChatModelPicker tests). Cover save/remove, Chat checking/error/retry vs confirmed-missing, missing/retired-model default, signed-out sections, A→B→A or sign-out while save pending, newer draft surviving older completion, initiating-user invalidation, independent thinking/voice edits. Replace removed mutation mocks with direct service and query-client spies.
- [ ] Finish Tasks 3–4 together; run focused API chat/analysis/Lambda SSE/profile/validation/env/TTS tests, API compile/full tests, common build/tests, web unit/lint/build, root `bun run typecheck`, affected sibling compile/build and CDK assertions. Commit green, not partially removed shared types.

## Task 5 — Bounded legacy cleanup (DynamoDB Local only before merge)

**Files:** `apps/vela-api/scripts/remove-legacy-api-keys.ts`, `test/scripts/remove-legacy-api-keys.test.ts`, cutover runbook. Reuse `packages/cdk/docker-compose.yml`.

- [ ] Script requires `--region`, `--profiles-table`, `--tts-table`; default dry-run, explicit `--apply`. Paginate Scan and conditionally REMOVE only `preferences.llm.keys`, `preferences.llm_keys`, TTS `api_key` when present. Preserve other data and new ciphertext; tolerate missing/malformed parent maps. No CAS/timestamp bump (strict writer rejects old fields and cannot restore them); no whole-row writes. Log counts/categories only.
- [ ] Test dry-run no write, pagination, apply preserving non-secret fields/versions/new ciphertext, second run zero changes, safe logs. Run `bun --cwd=apps/vela-api test test/scripts/remove-legacy-api-keys.test.ts`.
- [ ] Start `docker compose -f packages/cdk/docker-compose.yml up -d dynamodb`. Create fresh uniquely named local fixture tables, seed representative legacy and clean rows, invoke script with explicit loopback `--endpoint` and dummy credentials. Fixture runner must assert local endpoint and fixture table names; never inherit a cloud endpoint or use deployed names. Run dry-run/apply/dry-run, verify zero remaining legacy fields and unchanged non-secret data/version/ciphertext; delete only created local tables. No pre-merge cloud full-table cleanup, even dry-run. Commit script/tests/runbook.

```bash
bun apps/vela-api/scripts/remove-legacy-api-keys.ts --region us-east-1 --profiles-table "$LOCAL_PROFILES_TABLE" --tts-table "$LOCAL_TTS_TABLE" --endpoint http://127.0.0.1:8000
# Repeat with --apply, then without it against the same local fixture tables.
```

## Task 6 — Real integration and UI acceptance via MCP

**Files:** existing `apps/vela/e2e/fixtures/syntheticAuth.ts`, `e2e/llm-settings.spec.ts`, `e2e/chat-sidebar.spec.ts`, real auth fixture as needed, `playwright.config.ts`, package script; new `playwright.byok.config.ts`, `e2e/byok-live.spec.ts`. Runner-only S3 SDK dev dependency if needed for test-created audio cleanup; no separate web KMS SDK/test.

- [ ] Update mocked Settings/chat fixtures to use credential metadata endpoints. Test UI save/replace/remove, error/draft/account switch, no raw ordinary request, independent same-provider keys and non-secret two-tab settings. Run `bun --cwd=apps/vela run test:e2e:mocked -- e2e/llm-settings.spec.ts e2e/chat-sidebar.spec.ts`.
- [ ] Add opt-in `test:e2e:byok` → `playwright test --config playwright.byok.config.ts`; one Chromium worker, no retries/trace/video/HAR/automatic screenshot/request-body logging; exclude from ordinary/mocked discovery. Reuse actual auth/local web+Hono servers with existing test-client overrides; no HTTP interception or unrelated server reuse. Supply AWS config before imports.
- [ ] Preflight Task 1 resource existence, intended AWS account/region and target resource names, dedicated disposable authenticated test account, and clean/test-owned credential slots/TTS row; fail rather than overwrite preexisting non-test state. Required existing auth env: `TEST_EMAIL`, `TEST_PASSWORD`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_TEST_CLIENT_ID`, `VITE_AWS_REGION`. Two distinct valid keys: `E2E_LLM_OPENAI_KEY`, `E2E_TTS_OPENAI_KEY`. Real AWS config: `AWS_REGION`, `LLM_CREDENTIALS_TABLE_NAME`, `CREDENTIALS_KMS_KEY_ARN`, `PROFILES_TABLE_NAME`, `TTS_SETTINGS_TABLE_NAME`, `TTS_AUDIO_BUCKET_NAME`, existing chat/dictionary config, authorized SDK chain. Missing variable names only; fail, not skip. Keys in runner env only, not frontend build or Playwright step args.

| Step | Live assertion (one test account, shared AWS resources) |
| --- | --- |
| 1 | Save distinct same-provider keys through authenticated native Node fetch, assert only ciphertext in this user's credential records with safe Boolean checks. Configure synthetic second LLM slot. |
| 2 | Reload and see configured status/empty inputs; complete real chat, sentence-analysis SSE and uncached TTS generation/playback with a unique test vocabulary ID. Check ordinary network requests and responses contain no saved key without printing payloads. |
| 3 | Replace LLM with invalid synthetic key; LLM fails with no fallback while TTS still works, restore LLM. Remove/replace TTS independently, confirm LLM works and TTS missing/invalid cannot generate new audio; cached audio/settings remain. Remove LLM, retain saved default as unavailable. Non-secret preferences cannot alter/resurrect keys. |
| 4 | Signed-out access rejected. In finally remove only test-created credentials/rows and uniquely created chat/dictionary/audio artifacts. No shared-table scan, no cleanup script invocation or unrelated data deletion. |

- [ ] Run `bun --cwd=apps/vela run test:e2e:byok`; record SHA, safe counts, environment label. Focused two-subject route tests and mocked client switching cover account isolation; exact KMS command context assertions cover binding (no second live account or redundant live wrong-context KMS test). Local cleanup has its own gate in Task 5. No missing-credential/resource/MCP waiver.
- [ ] Inspect actual completed reports and screenshots through MCP (GitHub MCP CI or Browser MCP sanitized local report). Capture configured, missing, replacement/removal, error and model-picker states with synthetic/empty secret fields at desktop/narrow widths. Existing layout, no clipping/overflow, visual parity if mockup added. Store safe evidence under ignored `.artifacts/` or CI artifacts and link in same PR; never commit auth state, credentials or raw rows.

## Task 7 — Final checks and release verification

- [ ] Run affected final gates, plus sibling compile/build if shared contracts affect them:

```bash
bun --cwd=packages/common run build
bun --cwd=packages/common run test:unit
bun --cwd=apps/vela-api run compile
bun --cwd=apps/vela-api run test:unit
bun --cwd=apps/vela run test:unit
bun --cwd=apps/vela run lint
bun --cwd=apps/vela run build
bun run typecheck
bun --cwd=apps/vela-mobile run test:unit
bun --cwd=packages/cdk run lambda:build
bun --cwd=packages/cdk run test:unit
bun --cwd=packages/cdk run lint
bun --cwd=packages/cdk run cdk:synth
```

- [ ] Verify remaining `apiKey`/legacy references are only intentional rejection/cleanup fixtures, explicit submissions, internal adapters or history. Confirm KMS runtime import under existing externalized SDK Node 20 Lambda build; retain SSE regression. Inspect real CI and E2E evidence through MCP; address valid findings on same branch.
- [ ] Before marking ready, verify exact KMS context, no saved-key response/normal request fields, independent purposes, two-subject backend isolation and account switch, TTS retention/rotation and cached audio, mobile error-map/typecheck, fixed validation redaction, omitted-preferences equal-timestamp recovery, Chat status and signed-out Settings regressions, non-secret CAS, actual DynamoDB Local cleanup round trip, real one-user AWS/provider E2E and visual evidence. Docs or mocks alone do not pass.

### After normal main deployment

- [ ] Verify strict backend is serving and old writer traffic stopped. Wait at least **60 seconds** (configured maximum Lambda invocation time) after old traffic ends. Then verify explicit target AWS account/region and real profile/TTS table names, no local endpoint override. Run script with `--region "$AWS_REGION" --profiles-table "$PROFILES_TABLE_NAME" --tts-table "$TTS_SETTINGS_TABLE_NAME"`, dry-run → `--apply` → dry-run; zero remaining legacy fields. Record counts only. Retain KMS/ciphertext and fix forward; never restore plaintext-writing backend. Historical backup retention unchanged; recommend rotating old provider keys on re-entry.
- [ ] Smoke-test deployed Lambda save/status/decrypt/use using supported auth configuration (do not widen production JWT trust for fixture tokens), verify non-secret settings and cached audio. Record actual post-deploy evidence on PR #106 and HPA-1323. No production cleanup, AWS provisioning or acceptance is claimed by this docs-only revision.
