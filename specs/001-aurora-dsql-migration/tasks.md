---
description: 'Task list for Aurora DSQL migration feature implementation'
---

# Tasks: Aurora DSQL Migration

**Input**: Design documents from `specs/001-aurora-dsql-migration/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: No new test files are strictly required for this feature, but we will reuse and rerun the existing automated tests as part of validation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions where applicable

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure the repository, dependencies, and baseline environment are ready for Aurora DSQL work.

- [x] T001 Confirm feature branch `001-aurora-dsql-migration` is checked out in repository root `./`
- [x] T002 [P] Install monorepo dependencies with `pnpm install` in repository root `./`
- [x] T003 [P] Verify CDK commands are available by running `pnpm cdk:synth` once in `packages/cdk/`

**Checkpoint**: Repository is on the correct branch, dependencies installed, and CDK commands are verified.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Resolve remaining research questions and ensure design decisions are recorded before code changes.

**⚠️ CRITICAL**: No user story work should begin until this phase is complete.

- [x] T004 Document chosen Aurora DSQL engine family and version for the target region in `specs/001-aurora-dsql-migration/research.md`
- [x] T005 Document the Lambda-to-DSQL access mechanism (for example, RDS Data API or equivalent) and any required IAM actions in `specs/001-aurora-dsql-migration/research.md`

**Checkpoint**: Aurora DSQL engine/version and access method are decided and documented.

---

## Phase 3: User Story 1 - Platform uses Aurora DSQL (Priority: P1) 🎯 MVP

**Goal**: Replace the unused Aurora PostgreSQL cluster with Aurora DSQL and expose a basic connectivity health-check from the API.

**Independent Test**:

- Deploy `DatabaseStack` and `ApiStack` to a non-production environment.
- Confirm only an Aurora DSQL cluster exists for Vela (no Aurora PostgreSQL cluster).
- Call the DSQL health-check endpoint and verify it successfully executes a trivial query.

### Implementation for User Story 1

- [x] T006 [P] [US1] Update Aurora cluster definition to use Aurora DSQL engine/version in `packages/cdk/lib/database-stack.ts`
- [x] T007 [P] [US1] Verify and adjust, if needed, the database credentials secret configuration and naming for Aurora DSQL in `packages/cdk/lib/database-stack.ts`
- [x] T008 [P] [US1] Ensure API Lambda environment variables for database access (`AURORA_DB_CLUSTER_ARN`, `AURORA_DB_SECRET_ARN`, `AURORA_DB_NAME`) remain correctly wired to the new DSQL cluster in `packages/cdk/lib/api-stack.ts`
- [x] T009 [US1] Confirm IAM policy for database access uses the correct actions and scopes for the chosen Aurora DSQL access mechanism in `packages/cdk/lib/api-stack.ts`
- [x] T010 [US1] Run `pnpm cdk:diff DatabaseStack ApiStack` from `packages/cdk/` and verify that only the Aurora cluster definition is changing from PostgreSQL to DSQL
- [x] T011 [US1] Deploy updated `DatabaseStack` and `ApiStack` with `pnpm cdk:deploy DatabaseStack ApiStack` from `packages/cdk/` and verify an Aurora DSQL cluster is created and no Aurora PostgreSQL cluster remains
- [x] T012 [P] [US1] Implement Aurora DSQL helper module to execute a trivial query (for example, `SELECT 1`) using env configuration in `apps/vela-api/src/dsql.ts`
- [x] T013 [P] [US1] Implement internal DSQL health-check route based on `contracts/dsql-health.openapi.yaml` (for example, `GET /internal/dsql-health`) in `apps/vela-api/src/routes/dsql-health.ts`
- [x] T014 [US1] Wire the DSQL health-check route into the main Hono app by routing it under the appropriate prefix in `apps/vela-api/src/index.ts`
- [x] T015 [US1] Manually exercise the DSQL health-check endpoint against the deployed environment and confirm logs show a successful test query against Aurora DSQL

- [ ] T029 [US1] Implement an automated health-check loop test that calls `/internal/dsql-health` repeatedly (for example, 100 times) against a non-production environment and record the observed success rate in `specs/001-aurora-dsql-migration/research.md`

**Checkpoint**: Aurora DSQL cluster is provisioned instead of Aurora PostgreSQL, the API can run a trivial query via the health-check endpoint, and infrastructure changes are confined to CDK + API.

---

## Phase 4: User Story 2 - Low-risk migration for existing workloads (Priority: P2)

**Goal**: Ensure the migration does not change behavior of existing DynamoDB-backed features and that infra lifecycle remains clean.

**Independent Test**:

- Run the existing automated test suites before and after the migration and compare results.
- Destroy and re-create the infrastructure without manual cleanup.

### Implementation for User Story 2

- [ ] T016 [US2] Run the existing API tests with `pnpm test` in `apps/vela-api/` and capture baseline results before applying DSQL-related code changes (or from main branch if needed)
- [ ] T017 [US2] After DSQL infrastructure and API changes are applied, rerun `pnpm test` in `apps/vela-api/` and confirm all previously passing tests still pass unchanged
- [ ] T018 [US2] Optionally run additional application-wide tests (for example, `pnpm test` in `apps/vela/` if relevant) to confirm no regressions outside the API
- [ ] T019 [US2] Verify that `pnpm cdk:destroy DatabaseStack ApiStack` from `packages/cdk/` cleanly removes the Aurora DSQL cluster and related resources in non-production, with no orphaned security groups or secrets
- [ ] T020 [US2] Document any unexpected test or deployment issues and their resolutions in `specs/001-aurora-dsql-migration/research.md`

- [ ] T030 [US2] Perform a code and configuration review across `packages/cdk/` and `apps/vela-api/` (for example, using grep for Aurora PostgreSQL-specific engine/version identifiers or resource names) to confirm no legacy Aurora RDS references remain, and document findings in `specs/001-aurora-dsql-migration/research.md`
- [ ] T031 [US2] In a non-production environment, intentionally misconfigure Aurora DSQL environment variables (for example, invalid secret ARN or cluster ARN), call `/internal/dsql-health`, and verify that logs clearly describe the configuration error; restore the correct configuration afterward
- [ ] T032 [US2] (Optional) In a throwaway environment, attempt a CDK deploy of `DatabaseStack` with an intentionally invalid Aurora DSQL engine/version configuration to verify that deployment failures surface clear error messages, and capture the outcome in `specs/001-aurora-dsql-migration/research.md`

**Checkpoint**: All existing DynamoDB-backed functionality continues to behave identically, and infrastructure lifecycle (deploy/destroy) is fully automated via CDK.

---

## Phase 5: User Story 3 - Clear configuration and observability (Priority: P3)

**Goal**: Make Aurora DSQL configuration explicit in types and logging so future engineers can quickly understand and debug DSQL connectivity.

**Independent Test**:

- Inspect configuration types and logs to confirm DSQL-related env vars are modeled and reflected in runtime behavior.
- Intentionally misconfigure DSQL and verify that health-check logs a clear error.

### Implementation for User Story 3

- [ ] T021 [P] [US3] Extend the `Env` interface with Aurora DSQL configuration fields (cluster ARN, secret ARN, database name) in `apps/vela-api/src/types.ts`
- [ ] T022 [P] [US3] Update development `mockEnv` and production `prodEnv` objects to include Aurora DSQL configuration values where available in `apps/vela-api/src/index.ts`
- [ ] T023 [P] [US3] Add structured logging around DSQL health-check success and failure, including clear error messages when configuration is invalid, in `apps/vela-api/src/dsql.ts`
- [ ] T024 [US3] Update the quickstart documentation to explicitly list required Aurora DSQL environment variables and how to use the health-check for debugging in `specs/001-aurora-dsql-migration/quickstart.md`

**Checkpoint**: DSQL configuration is visible in type definitions and runtime logs, and engineers have clear documentation on how to debug DSQL connectivity.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final clean-up, documentation, and validation across all user stories.

- [ ] T025 [P] Run `pnpm cdk:diff` and `pnpm cdk:deploy DatabaseStack ApiStack` one final time from `packages/cdk/` to ensure no unintended infra drift remains
- [ ] T026 [P] Run the quickstart checklist end-to-end from `specs/001-aurora-dsql-migration/quickstart.md` and confirm all steps succeed without manual workarounds
- [ ] T027 Review `specs/001-aurora-dsql-migration/spec.md`, `plan.md`, and `research.md` to ensure they reflect the final implementation and remove any stale notes
- [ ] T028 [P] Perform light code cleanup (naming consistency, comments, and minor refactors) limited to `packages/cdk/lib/database-stack.ts`, `packages/cdk/lib/api-stack.ts`, and `apps/vela-api/src/dsql.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion. Blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion. Can start once engine/version and access method decisions are captured.
- **User Story 2 (Phase 4)**: Depends on User Story 1 (needs DSQL migration in place to validate low-risk behavior).
- **User Story 3 (Phase 5)**: Depends on User Story 1 (requires DSQL connectivity to exist) but can proceed in parallel with late steps from User Story 2.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Core infra migration and health-check; must be completed first (MVP).
- **User Story 2 (P2)**: Relies on User Story 1 to be in place so before/after comparisons are meaningful.
- **User Story 3 (P3)**: Relies on User Story 1, but is otherwise orthogonal and can be scheduled flexibly after US1.

### Within Each User Story

- Infra and configuration changes (CDK, types) before health-check endpoint wiring.
- Health-check helper implementation (`dsql.ts`) before route wiring and manual tests.
- Test and validation tasks (rerunning existing tests, manual checks) after implementation tasks.

### Parallel Opportunities

- **Phase 1**: T002 and T003 can be done in parallel.
- **Phase 3**: T006–T008 (CDK updates) can be done in parallel with careful coordination, and T012–T013 (API helper + route) can be done in parallel once the access method is chosen.
- **Phase 4**: Test runs (T017, T018) can be executed in parallel on different packages.
- **Phase 5**: T021–T023 can proceed in parallel since they touch different files (`types.ts`, `index.ts`, `dsql.ts`).
- **Phase 6**: T025, T026, and T028 are parallelizable as they operate on different commands or files.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Implement Phase 3: User Story 1 (CDK DSQL migration + API health-check).
4. Deploy to non-production and validate that Aurora DSQL is the only relational cluster and that the health-check works.

### Incremental Delivery

1. Deliver **US1 (P1)** as the MVP: DSQL infra + health-check.
2. Deliver **US2 (P2)**: Low-risk validation and lifecycle checks (tests + destroy/redeploy).
3. Deliver **US3 (P3)**: Configuration clarity and observability improvements.
4. Run Phase 6 (Polish) to finalize docs and quickstart validation.

### Parallel Team Strategy

With multiple developers:

- Developer A focuses on CDK changes for DSQL (T006–T011).
- Developer B focuses on API DSQL helper and health endpoint (T012–T015, T021–T023).
- Developer C focuses on validation and lifecycle tasks (T016–T020, T025–T026).

Each developer can work mostly independently once Phase 2 is complete, with coordination at deployment and validation checkpoints.
