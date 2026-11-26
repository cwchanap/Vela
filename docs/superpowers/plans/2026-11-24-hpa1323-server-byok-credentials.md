# HPA-1323 — Server-side BYOK Credentials Implementation Plan

> Use the existing executing-plans workflow. Track checkboxes; keep all work in PR #106.

**Goal:** Store users' LLM and TTS API keys as server-side ciphertext, with no saved-key readback. **Spec:** [Design](../specs/2026-11-24-hpa1323-server-byok-credentials-design.md) · [Linear](https://linear.app/cwchanap/issue/HPA-1323) · [Design review](https://github.com/cwchanap/Vela/pull/106#pullrequestreview-6067727709)

**Base:** `0fe3a4e0b9a8c404b5673490f88fcbfccadc5372`. Revised November 25, 2026. Docs only; all implementation/provisioning/acceptance remains pending.

## Constraints

- One PR. Direct KMS, one key per environment; one LLM table keyed user/provider and one independent TTS ciphertext in the existing settings row. No new service, envelope, plaintext cache, shared paid fallback, dual writes, extra version protocol or compatibility layer.
- Keep existing provider adapters, model/thinking/voice settings, preference CAS, SSE, history and cached audio. Recheck HPA-824 / PR #103; preserve non-secret reconciliation.
- Keep compiling commits: Task 1 additive, Task 2 complete TTS vertical path, Tasks 3–4 one coordinated breaking-contract commit. No partial app deployment.
- During implementation only, allow additive DatabaseStack-only provisioning before merge for live tests. No pre-merge running app/API deployment or shared-table cleanup. Full-table cleanup verification runs on DynamoDB Local only; live suite uses a dedicated test account against existing AWS resources.
- Actual authenticated web/Hono/KMS/DynamoDB/provider E2E and MCP inspection of screenshots/results on one web platform. No mockup attached; compare visual parity if added. No native or human acceptance gate, new art/SFX or provider/model expansion.

## Task 1 — Add status contracts and AWS infrastructure

**Files:** `packages/common/src/contracts/llm.ts`, `contracts/tts.ts`, `keys.ts`, `index.ts`; `packages/cdk/lib/database-stack.ts`, `api-stack.ts` and stack tests; `apps/vela-api/package.json`, `src/env.ts`, `src/types.ts`, env examples and `bun.lock`.

- [ ] Recheck main/ticket/related PR and shared-contract consumers (web/mobile/extension); rebase same branch as needed. Run `bun install --frozen-lockfile`.
- [ ] Add `LlmCredentialStatus`, `LlmCredentialMutationResult`, `llmKeys.credentials(userId)` to existing shared key factory/barrel and `tts_credential_service_unavailable`. Keep the existing `LlmPreferences.keys` and Env/request fields until their last consumers change.
- [ ] Add tests for new on-demand `vela-llm-credentials` table with `user_id`/`provider`, backup/removal conventions, one retained symmetric key, narrow table/Encrypt/Decrypt role permissions, and Lambda config `LLM_CREDENTIALS_TABLE_NAME` / `CREDENTIALS_KMS_KEY_ARN`. Update existing table count from ten to eleven without weakening other checks. Preserve existing resource IDs/exports.
- [ ] Implement additive resources in existing stacks; add `@aws-sdk/client-kms` matching existing SDK dependency convention. Keep existing externalized AWS SDK Lambda build. No browser KMS privileges or key config. Run common build/tests, API compile/tests, web build/tests, Lambda build and CDK unit tests; commit green.

### Pre-merge resource bootstrap (implementation only)

Vela has one deployed environment: DatabaseStack uses fixed table names and the existing real local E2E uses the deployed tables with a dedicated test Cognito account. Before the live gate, provision **only DatabaseStack** from this branch using the existing authorized deployment identity, target account/region and deployment configuration. Build/provide Lambda and SPA assets required by CDK synthesis. From `packages/cdk`, run `bunx aws-cdk diff DatabaseStack`; proceed only if the diff adds the new LLM table, retained KMS key and expected additive outputs/policies, without modifying, replacing or deleting existing resources/exports. Serialize with main deployments. Run `bunx aws-cdk deploy DatabaseStack --exclusively`; never deploy the other stacks from the branch. Use the resulting table name/key ARN in local Hono and an authorized runner identity; the Lambda IAM grants and runtime changes go live through the normal post-merge deployment. These are permanent resources, not a disposable test KMS key. Missing permissions, unexpected diff or unavailable resources block live acceptance. No provisioning is performed while this is a docs-only PR.

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

- [ ] Remove public `apiKey` fields, explicitly reject retired request inputs before stripping, resolve the verified `c.get('userId')` with normalized provider before upstream/SSE. In dictionary analysis keep email-first `dictionaryUserId` for dictionary ownership only; assert resolver receives `test-user-id`, not `test@example.com`. Two-subject route tests show generation uses current authenticated subject. Missing key 400 `llm_not_configured` with no upstream call; KMS/storage 503; preserve adapter/effort/SSE behavior. Reuse shared sanitizer; eliminate raw analysis catches.
- [ ] Delete fallback, `/capabilities`, obsolete Env/buildEnv, unused `ELEVENLABS_API_KEY` Lambda env entry and related examples/config references. Keep unrelated Google OAuth configuration. Test missing-key behavior, not removed fallback env fields.
- [ ] Remove keys from `LlmPreferencesSchema`, make `.strict()`, add write-only `llm_keys: z.never().optional()` to `PreferencesSchema` only. Reuse existing lenient LLM read schema for `preserveStoredLlm`; delete `hasUnrecognizedLlmKey` and key-only tests. Keep successful sanitization marker, CAS and read/write fence for non-secret preferences.
- [ ] Test secret-free profile GET/PUT (legacy synthetic sentinels, malformed stored data, successful commit with failed sanitizer), rejection before stripping, no resurrection on unrelated save. Safe incomplete PUT projection omits malformed preferences/read marker, never raw record or false failure. Confirm existing client marker guard and post-PUT refetch suffice before adding new behavior. Keep safe fixed error messages/logs and non-secret CAS tests.

### Task 4 — User-scoped Settings and model metadata

**Files:** existing `apps/vela/src/services/llm/index.ts`, `services/ttsService.ts`, `composables/queries/useLlmCapabilitiesQuery.ts` and `useServerKeyProviders` (rename/repoint, including tests), `useTTSQueries.ts`, `stores/llmSettings.ts`, `stores/auth.ts`, `utils/llmModelOptions.ts`, Chat/Dictionary pages, `pages/settings/SettingsPage.vue` and existing provider/TTS sections. Shared `contracts/llm.ts`.

- [ ] Reuse existing LLM service/query/helper: status/save/remove on new endpoints, shared `llmKeys.credentials(userId)`, derive expected user from query key and use `httpJsonAuth(..., expectedUserId)`. Signed-out disabled, invalidate initiating user. Unknown/error is not confirmed empty. `buildLlmModelOptions(configuredProviders)` has no raw-key parameter or server-key suffix; keep unavailable saved default visible with guidance.
- [ ] Remove `LlmPreferences.keys`, `LlmSelection.apiKey` and raw-key cloning/saves/inference payloads in the same commit as Task 3 and final consumers. Retain non-secret preference reconciliation, separate thinking saves, no new store/version mechanism. Check shared contract consumers and affected sibling builds.
- [ ] Settings shows saved/missing/unknown, empty replacement, explicit remove/save. Blank LLM replacement no request; TTS blank retains a matching key. Key credential sections by authenticated user ID, unmount on sign-out; capture initiating identity, use expected-user guard and small disposal guard for stale callbacks. Clear submitted draft only if unchanged. Avoid retained mutation variables containing raw keys in both purposes; reuse short-lived service calls. TTS removal retains selected provider/model/voice.
- [ ] Adapt existing store, query, model-option and component tests (`llmSettings.account.test.ts`, `profileHydration.test.ts`, `auth.test.ts`, `useTTSQueries.test.ts`, renamed capability tests). Cover save/remove, unknown/loading/error, missing-key default, A→B→A or sign-out while save pending, newer draft surviving older completion, initiating-user invalidation, independent thinking/voice edits.
- [ ] Finish Tasks 3–4 together; run focused API chat/analysis/Lambda SSE/profile/validation/env/TTS tests, API compile/full tests, common build/tests, web unit/lint/build, affected sibling compile/build and CDK assertions. Commit green, not partially removed shared types.

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
bun --cwd=packages/cdk run lambda:build
bun --cwd=packages/cdk run test:unit
bun --cwd=packages/cdk run lint
bun --cwd=packages/cdk run cdk:synth
```

- [ ] Verify remaining `apiKey`/legacy references are only intentional rejection/cleanup fixtures, explicit submissions, internal adapters or history. Confirm KMS runtime import under existing externalized SDK Node 20 Lambda build; retain SSE regression. Inspect real CI and E2E evidence through MCP; address valid findings on same branch.
- [ ] Before marking ready, verify exact KMS context, no saved-key response/normal request fields, independent purposes, two-subject backend isolation and account switch, TTS retention/rotation and cached audio, non-secret CAS, actual DynamoDB Local cleanup round trip, real one-user AWS/provider E2E and visual evidence. Docs or mocks alone do not pass.

### After normal main deployment

- [ ] Verify strict backend is serving and old writer traffic stopped. Wait at least **60 seconds** (configured maximum Lambda invocation time) after old traffic ends. Then verify explicit target AWS account/region and real profile/TTS table names, no local endpoint override. Run script with `--region "$AWS_REGION" --profiles-table "$PROFILES_TABLE_NAME" --tts-table "$TTS_SETTINGS_TABLE_NAME"`, dry-run → `--apply` → dry-run; zero remaining legacy fields. Record counts only. Retain KMS/ciphertext and fix forward; never restore plaintext-writing backend. Historical backup retention unchanged; recommend rotating old provider keys on re-entry.
- [ ] Smoke-test deployed Lambda save/status/decrypt/use using supported auth configuration (do not widen production JWT trust for fixture tokens), verify non-secret settings and cached audio. Record actual post-deploy evidence on PR #106 and HPA-1323. No production cleanup, AWS provisioning or acceptance is claimed by this docs-only revision.
