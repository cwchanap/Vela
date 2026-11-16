# HPA-918 — Coordinated Quasar/Vite 8 Upgrade (Design Spec)

**Status:** Proposed; documentation-only draft. No dependency change is implemented by this document.  
**Linear:** https://linear.app/cwchanap/issue/HPA-918/maintenance-coordinate-ignored-quasar-and-env-dependency-majors  
**Plan:** [Single-PR implementation plan](../plans/2026-11-16-hpa918-quasar-vite8-upgrade.md)  
**Delivery rule:** One PR for HPA-918. Add implementation, tests, verification receipts, and review changes to this same draft PR; do not open a follow-up implementation PR.

## Problem and repository baseline (main, 2026-11-16)

The repository has one Bun lockfile and two Quasar CLI apps: `apps/vela` (web) and `apps/vela-mobile` (Capacitor). Both use `@quasar/app-vite@2.x` and directly load `@quasar/vite-plugin@1.x` in their Vitest configurations. The lockfile resolves the CLI to v2.4 / Vite 7, while `@quasar/vite-plugin@2` requires Vite 8. The failed independent upgrade in [PR #76](https://github.com/cwchanap/Vela/pull/76) threw `SyntaxError: The requested module 'vite' does not provide an export named 'parseSync'`. Updating only the plugin is invalid.

Other visible constraints:
- Both apps use Vue Router `^4.3.0`, `#q-app/wrappers` imports, and historic Quasar router env constants. Quasar CLI v3 requires Vue Router v5 and has breaking changes to imports, aliases, environment injection, and config.
- Both apps use `vitest@3.2.x` with `@vitest/coverage-v8@3.2.x`. `apps/vela-ext` also uses Vitest 3. Existing open [Dependabot PR #89](https://github.com/cwchanap/Vela/pull/89) proposes Vitest 5 **without matching coverage-provider changes**; it is not a ready-to-merge prerequisite.
- Web `quasar.config.ts` uses `build.env`, `build.rollupOptions` manual chunking, aliases, and `vite-plugin-checker`. Mobile injects the `validateMobileApiUrlPlugin` through `extendViteConf`.
- The mobile `sync-ios-version.mjs` and `build/validate-mobile-api-url.ts` directly import `dotenv-expand@11.0.7` and follow explicit process-env precedence. The existing test for an **empty** `VITE_APP_VERSION` overriding `.env.production` protects native/iOS UI parity. [PR #75](https://github.com/cwchanap/Vela/pull/75) upgraded to v1000 and violated that invariant. The repository does not need the new command-substitution/decryption features.

Sources: [Quasar CLI v3 upgrade guide](https://quasar.dev/quasar-cli-vite/upgrade-guide/), [Quasar Vite plugin requirements](https://quasar.dev/start/vite-plugin/), [Quasar environment handling](https://quasar.dev/quasar-cli-vite/handling-import-meta-env/), [Vitest 5 migration](https://vitest.dev/guide/migration/), [Vite env precedence](https://vite.dev/guide/env-and-mode.html), and the two closed Dependabot PRs.

## Intended outcome

A single supported Vite 8 toolchain for web and mobile builds **and** their unit-test configuration. No change to user-facing behavior, application API contracts, persistence, or feature scope. Quasar CLI v3 is the target specified in HPA-918; do not silently substitute a partial `@quasar/vite-plugin@2` bump.

### Decision A — Upgrade the stack as a unit

Upgrade both Quasar apps from `@quasar/app-vite@2` to `@quasar/app-vite@3`, direct `@quasar/vite-plugin@1` to v2, Vite to v8, and Vue Router to v5. Keep `@vitejs/plugin-vue@6` if peer-compatible. Adopt a supported Node 22.22+ runtime for frontend tooling (without changing the API's Node 20 Lambda runtime). Update Bun lockfile and ensure a **single compatible Vite resolution** is used by the Quasar plugin and Vitest for each app.

Upgrade web/mobile Vitest plus matching `@vitest/coverage-v8` to the compatible v5 release; account for extension workspace's tests and coverage separately. If PR #89 lands first, rebase and repair its incomplete coverage alignment; otherwise include only the Vitest changes necessary for this migration in HPA-918, not a second implementation PR. Do not fold in unrelated jsdom/happy-dom major PRs.

### Decision B — Migrate actual v3 breaking surfaces, not compatibility shims

- Replace `#q-app/wrappers` with the v3 `#q-app` entrypoint in the Quasar apps, their boot/router files, and unit-test mocks. Remove obsolete alias mocks after migration.
- Replace legacy `process.env.SERVER` / `process.env.VUE_ROUTER_MODE` usage with v3 `import.meta.env.QUASAR_*` equivalents as established by a generated v3 route scaffold; keep history-mode navigation and existing route guards.
- Migrate code imports using obsolete `src/`, `pages/`, `boot/`, etc. aliases to `@/` rather than rebuilding all legacy alias compatibility. Keep explicit workspace/Capacitor aliases needed by the apps.
- Replace removed `build.env` configuration with the v3-supported env convention. Preserve only intended `VITE_*` variables in the client bundle; do not broadly expose the process environment.
- Reconcile the web's `extendViteConf` and `rollupOptions` with Vite 8/Rolldown. Prefer removing unnecessary manual chunk hints over carrying forward old bundler internals. Keep required `@vela/common` and `path-browserify` resolutions and preserve mobile's API-URL validation plugin.
- Check whether `@quasar/quasar-app-extension-testing` is actually used. If incompatible and unused, remove it rather than writing a compatibility layer. Use existing direct Vitest configs as the supported unit-test entrypoint.

Do not add an abstraction layer, new tooling framework, feature redesign, backward-compatibility switch, or a second set of environment loaders.

### Decision C — Retain the dotenv-expand hold unless the current contract can be proved

**Default decision for HPA-918: retain `dotenv-expand@11.0.7`, do not install v1000.** The new command substitution/decryption behavior is not required. A Quasar upgrade is not itself a reason to alter the mobile native version resolver. If Quasar v3's environment behavior makes the current resolver inconsistent, change only the necessary resolution code, then prove parity against the actual bundled UI env; only consider removing the direct dependency if both callsites can demonstrably use the same Vite/Quasar source of truth. Do not retain two independent env engines merely for symmetry.

The required invariant is:

| Source | Expected effective mobile version |
| --- | --- |
| Nonempty explicit process override | Override wins |
| Explicit empty process override + nonempty mode file | Package version fallback (not file value) |
| No process override + mode file | Mode file wins |
| No override or file | Package version |
| Referenced env variable | Follows the app bundler's precedence |
| Development vs production mode | Respective mode-specific file |

In every case, `MARKETING_VERSION` (after semver metadata stripping) must equal what the mobile UI displays. For API/Cognito config keys, an existing empty override must be treated as *missing* by production validation rather than replaced silently by a file value.

## Out of scope

- Updating `dotenv-expand` to v1000 solely to clear a Dependabot ignore; enabling command substitution/decryption; mass-unignoring dependencies.
- Backend/Lambda API changes, schema migrations, mobile review/SRS functionality, or new UI.
- Fixing unrelated `jsdom`, `happy-dom`, and general Dependabot updates.
- Old Vite/Router/Quasar compatibility paths once the coordinated migration is accepted.

## Risks and stop conditions

1. **Toolchain drift:** If `quasar build` and `vitest run` load different Vite majors, stop and fix the dependency graph; the original `parseSync` failure must not recur.
2. **Quasar v3 runtime changes:** Vue Router/aliases/client env are breaking changes. A successful `bun install` alone is not acceptance; both app builds and browser smoke tests must pass.
3. **iOS version drift:** A passed unit test is insufficient if the actual compiled mobile UI and `MARKETING_VERSION` disagree. Preserve the empty-override regression.
4. **Node version assumptions:** Frontend build/test runners must use a compatible supported Node runtime. Keep the backend deployment runtime separate.
5. **Overlarge migration:** If a v3 incompatibility cannot be fixed with a focused change inside this ticket, record the specific blocker and evidence on this PR and update Linear; do not merge a half-migrated stack.

## Acceptance contract

- Two app builds, their unit/coverage suites, the extension regression suite, typechecks, and native iOS asset build pass on an aligned Vite 8 dependency graph without `parseSync` or incompatible-peer errors.
- Mobile environment/version regression matrix passes, including the explicit empty override and end-to-end native-vs-bundled version check.
- An MCP-driven browser end-to-end smoke run exercises representative web and mobile flows. Because this maintenance ticket has no UI mockup, capture and visually compare pre/post screenshots for a representative desktop route and an iPhone-sized mobile route. Acceptance is automated/agent-verified, **not human sign-off**.
- If an iOS Simulator build/run is available, use MCP automation for the native packaging/navigation smoke and screenshot. Any unavailable platform gate must be explicitly recorded as unverified, not marked passed.
- The same HPA-918 draft PR contains implementation and verification receipts. Record that #76 is superseded by the validated coordinated upgrade and that #75's v1000 hold remains an intentional retain decision.
