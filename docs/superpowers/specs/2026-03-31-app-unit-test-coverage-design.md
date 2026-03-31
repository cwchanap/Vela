# App Unit Test Coverage Improvement Design

## Problem

The frontend app in `apps/vela` needs a meaningful unit test coverage increase, targeting roughly a `+10` percentage-point gain in line coverage. The current app suite is not fully green: `src/config/index.test.ts` has environment-dependent expectations that fail in the current local setup, so coverage work must begin by restoring a reliable baseline.

The goal is not to maximize coverage with low-value assertions. The work should prioritize high-ROI tests that improve confidence in real app behavior while still producing a measurable coverage increase.

## Proposed Approach

Use a staged coverage-improvement pass:

1. Stabilize the current app unit baseline by fixing the failing config test expectations or isolating env-dependent fallback assertions.
2. Add focused tests around currently untested or under-tested high-value frontend behavior.
3. Use a small second pass on low-risk targets only if needed to close the remaining coverage gap.

This approach balances confidence and efficiency. It avoids padding coverage with mostly trivial assertions while still leaving room for a few low-risk tests if the target is not yet met after the primary pass.

## Scope

### In Scope

- `apps/vela` unit tests only
- Restoring a green `bun vitest run` baseline for the app
- Measuring improvement with `bun vitest run --coverage`
- Small, behavior-preserving refactors only when required to make code cleanly testable
- New tests for the highest-value uncovered frontend areas

### Out of Scope

- E2E or Playwright coverage work
- Backend or monorepo-wide coverage goals
- Broad production refactors unrelated to testability
- Coverage padding through large numbers of trivial tests with little product value

## Baseline Findings

### Current Test Setup

- Test runner: Vitest with `jsdom`
- Config: `apps/vela/vitest.config.ts`
- Setup file: `apps/vela/src/test/setup.ts`
- Coverage provider: V8
- Coverage configured with `all: true` over `src/**/*.{ts,vue}`

### Current Baseline Issue

`cd apps/vela && bun vitest run` currently exits non-zero because:

- `src/config/index.test.ts` expects `config.api.url` to default to `/api/`
- `src/config/index.test.ts` expects `config.app.name` to default to `Japanese Learning App`

In the current environment, `apps/vela/.env` provides:

- `VITE_API_URL=http://localhost:9005/api/`
- `VITE_APP_NAME=Vela`

That means the failing tests currently assert fallback behavior in an environment where explicit env values are present. Baseline stabilization should correct that mismatch before coverage expansion begins.

## Recommended Test Targets

### 1. `src/components/games/listening/ListeningSetup.vue`

This is the highest-value uncovered component target.

Add tests for:

- initial loading state while TTS settings are being fetched
- `ready` state when `getTTSSettings()` reports an available provider
- `missing` state when TTS is not configured
- `error` state when TTS settings fetch fails
- retry behavior from the error banner
- mode selection changes between multiple choice and dictation
- source selection changes between vocabulary and sentences
- JLPT selection wiring into emitted start config
- emitted `start` payload correctness
- start button loading behavior through the existing `isStarting` prop

### 2. Boot Files

#### `src/boot/main.ts`

Add tests that verify:

- theme store initialization runs on boot
- auth store subscription is registered
- theme sync runs when user preferences include `darkMode`
- theme sync does not run when preference data is absent

If needed, introduce only minimal testability refactors such as extracting tiny helper functions while preserving runtime behavior.

#### `src/boot/query.ts`

Add tests that verify:

- Vue Query plugin installation occurs with the shared `queryClient`
- exported constants remain wired to `@vela/common`
- `queryClient` is created once and exported consistently

### 3. `src/components/NavigationLink.vue`

Add focused component tests for:

- enabled navigation rendering
- disabled styling/state
- “Soon” chip rendering for disabled items
- disabled click behavior triggering Quasar notify
- enabled click behavior emitting `click`

### 4. `src/stores/index.ts`

Add lightweight tests for:

- default export returning a Pinia instance
- expected store exports remaining available

This is lower business value than the items above, but it is a safe coverage win and helps protect app bootstrap wiring.

## Optional Second-Pass Targets

Use these only if the primary targets do not reach the `+10` percentage-point goal:

- additional low-risk barrel/export coverage
- targeted error-path tests in already-tested services where missing branches are obvious
- small untested components with straightforward behavior

The second pass should remain selective. It should close the gap without turning the change into a broad testing sweep across unrelated features.

## Test Design Guidelines

- Follow existing `apps/vela` Vitest conventions and mocking patterns
- Reuse current Quasar stubbing patterns already present in component tests
- Keep test names behavior-oriented and scenario-specific
- Prefer deterministic module mocks over broad integration-like setup
- Avoid changing production behavior just to make tests easier
- If refactors are required for testability, keep them narrow and behavior-safe

## Verification Plan

Run the existing app commands only:

1. `cd apps/vela && bun vitest run`
2. `cd apps/vela && bun vitest run --coverage`

Success criteria:

- the app unit test suite is green
- the coverage baseline is measured cleanly
- line coverage improves by about `+10` percentage points for `apps/vela`

## Risks and Mitigations

### Risk: Coverage work starts from a failing baseline

Mitigation:

- fix the env-dependent config test mismatch first

### Risk: Boot files are awkward to test directly

Mitigation:

- use small, behavior-preserving refactors only if necessary to expose testable seams

### Risk: Coverage target is missed after high-value tests

Mitigation:

- use the optional second-pass targets to close the remaining gap without broadening scope too far

## Implementation Notes for Planning

- The first implementation step should be baseline stabilization, not new test authoring
- Coverage progress should be checked after each logical batch of tests
- If the coverage increase is already sufficient after the primary targets, skip the optional second pass
