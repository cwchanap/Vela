# HPA-918 — Coordinated Quasar/Vite 8 Upgrade (Design Spec)

**Status:** Proposed; documentation-only draft. No dependency change is implemented by this document.  
**Linear:** https://linear.app/cwchanap/issue/HPA-918/maintenance-coordinate-ignored-quasar-and-env-dependency-majors  
**Plan:** [Single-PR implementation plan](../plans/2026-11-16-hpa918-quasar-vite8-upgrade.md)  
**Delivery rule:** One PR for HPA-918. Add implementation, tests, verification receipts, and review changes to this same draft PR; do not open a follow-up implementation PR.

## Problem and repository baseline (main, 2026-11-16)

Vela has a single Bun lockfile, two Quasar CLI apps (`apps/vela` web and `apps/vela-mobile` Capacitor), and an independent WXT extension. The Quasar apps currently use `@quasar/app-vite@2.4` with Vite 7, direct `@quasar/vite-plugin@1` in Vitest 3 configs, and Vue Router 4. An isolated plugin-v2 bump ([PR #76](https://github.com/cwchanap/Vela/pull/76)) failed at config load with Vite 7's missing `parseSync` export.

**Quasar CLI v3 changes the *environment source*, not just an API name.** It disables native Vite dotenv loading and uses its own loader, which by default reads only `.env` (plus `.env.local` outside CI) and exposes `QCLI_`-prefixed variables. Deployment's `packages/cdk/scripts/inject-env.ts` writes **`apps/vela/.env.production` and `apps/vela-mobile/.env.production`**, with `VITE_` variables. Without explicit Quasar v3 configuration, neither the production files nor these client values would reach the bundles. The web config's existing `build.env` key/value map is *not* valid v3 env-loader config. v3 also coerces `true`, `false`, and numbers into JavaScript literals: `import.meta.env.VITE_DEV_MODE === 'true'` needs an adjustment.

`apps/vela-mobile/scripts/sync-ios-version.mjs` and `apps/vela-mobile/build/validate-mobile-api-url.ts` both implement separate **Vite 7** dotenv parsing/expansion, currently using direct `dotenv` and `dotenv-expand@11`. The prior [PR #75](https://github.com/cwchanap/Vela/pull/75) bump to v1000 failed the empty-process-override contract. **Retaining v11 is not enough after v3**: Quasar's loader can resolve interpolated values differently from those two copies. Their replacement should consume resolved client definitions from the existing Vite config hook, not invent a third environment engine.

Other concrete migration surfaces: `#q-app/wrappers` in both configs, both routers and multiple boot files; `quasar/wrappers` in two web boot files; old `src/` and related aliases across source and test mocks; the two SPA history routers; an unused testing app extension; a dead web `manualChunks` block; unneeded Quasar mode scaffolding; mobile Capacitor aliases already supplied by v3; and Vitest `coverage.all` removed in newer versions.

The web/mobile Vitest 3 + coverage 3 setup must move together; the WXT extension's separate Vitest 3 can remain if verified. Open [PR #89](https://github.com/cwchanap/Vela/pull/89) upgrades only Vitest, **not its matching coverage provider**, so it cannot be treated as a migration prerequisite. The two previously closed dependency PRs remain closed.

Grounding: [Quasar CLI v3 upgrade guide](https://quasar.dev/quasar-cli-vite/upgrade-guide/), [Quasar env support](https://quasar.dev/quasar-cli-vite/handling-import-meta-env/), [Vitest migration](https://vitest.dev/guide/migration/), Vela's current configuration, `inject-env.ts`, and GitHub review of PR #93.

## Intended outcome

A single supported Vite 8 toolchain for web and mobile builds **and** their unit-test configuration. No change to user-facing behavior, application API contracts, persistence, or feature scope. Quasar CLI v3 is the target specified in HPA-918; do not silently substitute a partial `@quasar/vite-plugin@2` bump.

### Decision A — Upgrade as one compatible stack, with a runnable first step

Upgrade both Quasar apps to `@quasar/app-vite@3`, `@quasar/vite-plugin@2`, Vite 8, Vue Router 5, and compatible `@vitejs/plugin-vue@6`. Align each migrated Vitest 5 runner with **the same** `@vitest/coverage-v8` version. Leave the extension's independent Vitest 3/WXT graph alone unless resolution or tests prove it incompatible. Do not fold in unrelated jsdom/happy-dom majors.

Pin frontend Node **22.22.0** in a root `.node-version` file, tighten app engine ranges, and configure `actions/setup-node` via that file in build-lint, unit-test, e2e and deploy workflow paths that execute the Quasar CLI. This is separate from the API Lambda Node 20 target.

The first runnable migration step is **atomic**: dependency bump, `#q-app` config entrypoint, v3 env configuration and Node pin must land together, before `bun install` invokes `quasar prepare` postinstalls. An isolated dependency bump cannot pass its own install gate. Prove frozen install and Vitest config load *after* this atomic step.

For reviewable history, make the old-alias-to-`@/` rewrite a **purely mechanical first commit on this same PR**, while still on v2; add temporary `@` aliases to existing v2 Quasar/Vitest configs, and test it before the v3 commit. **Do not open a separate PR**, even though the migration touches many source files.

### Decision B — Minimal v3 config and alias migration

- Configure **both** `quasar.config.ts` files with `build.env: { clientPrefix: 'VITE_', file: ctx.prod ? '.env.production' : [] }`. This is Quasar v3's env-loader configuration; the `file` is *additional* to default `.env` / local files. Preserve the existing public `VITE_*` contract and `inject-env.ts` output, rather than renaming dozens of producers and consumers. Test live priority/typing semantics, including explicit empty process variables and env-variable interpolation.
- Replace old `#q-app/wrappers` and `quasar/wrappers` runtime imports with v3 `#q-app` exports; adjust test mock aliases and generated types. Migrate active old-style import aliases to `@/` in the initial mechanical commit.
- Both apps are SPA + history-mode; simplify both routers to `createWebHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE)` with the supported v3 generated router base. Preserve auth guards, navigation behavior and mobile deep links; no SSR/hash fallback branches.
- Replace the old web `build.env` key-value map, update `VITE_DEV_MODE` parsing for v3's boolean coercion, and prune obsolete env type declarations. Do not broadly expose process env or client-side secrets.
- Delete unused `@quasar/quasar-app-extension-testing` and web `test:` config, dead `manualChunks`, web's unused SSR/PWA/Cordova/Electron/BEX scaffolding, redundant mobile Quasar Capacitor dependency aliases, and `coverage.all`. Retain essential `@vela/common`/tokenizer and `path-browserify` aliases and existing mobile validator registration.
- Keep direct, supported Vitest configurations rather than adopting Quasar's extension-only `@quasar/app-vite/testing` helper for one-time alias deduplication. Trim the Vitest alias maps after the mechanical rewrite; keep native dependency aliases in test config only if needed for unit resolution. Do not add compatibility shims.

### Decision C — One resolved environment; delete duplicate dotenv loaders

**Agreed decision:** delete the mobile's direct `dotenv` and `dotenv-expand` dependencies and both Vite-compatible parsing copies. Neither pinning v11 nor upgrading to v1000 is justified. Quasar v3's resolved client definitions become the single source of truth.

Extend the existing `validateMobileApiUrlPlugin` (registered via `apps/vela-mobile/quasar.config.ts`) so `configResolved(config)` gets the **actual values being embedded** from `config.define['import.meta.env.VITE_*']`. Decode the relevant literal format exactly as v3 emits it (rather than assuming raw strings). Use those values for the existing production API/Cognito validation. In **Capacitor mode only**, also calculate and write `MARKETING_VERSION` into `src-capacitor/ios/App/App.xcodeproj/project.pbxproj`, preserving the existing three-segment semver metadata normalization and no-op write behavior. Pass the Quasar mode through the existing plugin factory; avoid introducing a new env-loading service. This hook must run for both development and production Capacitor builds and not touch iOS metadata in SPA mode.

Remove standalone `sync-ios-version.mjs`, its tests, `sync:ios-version`, and script prefixes in `dev:ios`/`build:ios*`. Replace their obsolete Vite-precedence assertions with small tests that pass a fake **resolved** config to the plugin, plus an integration test using the real Quasar v3 bundler. Update `CLAUDE.md` and affected mobile README/scripts.

**Required behavior:** nonempty process override wins for its direct key; an explicitly empty direct override remains empty; missing/empty version uses the app's package version; mode file and referenced-variable results agree with *the generated bundle* (do not assert Vite 7 interpolation precedence); malformed env fails production validation; native `MARKETING_VERSION` matches the displayed mobile version after metadata stripping. Avoid reimplementing Quasar's parser or its precedence rules.

**Dependabot resolution:** #75's v1000 upgrade stays rejected; HPA-918 records **removal of the direct dependency** after successful verification, not a retained v11 hold or a forced v1000 bump.

## Out of scope

- Updating `dotenv-expand` to v1000; adding command substitution/decryption; mass-unignoring dependencies or changing other Dependabot PRs.
- API/Lambda/database changes or new app features, visuals, user journeys, or authentication contracts.
- Building compatibility adapters for removed Quasar APIs, old aliases, multi-mode scaffolds, or a new shared env abstraction.
- A separate alias/refactor PR or a second implementation PR. Alias migration is the first self-contained commit on this PR.

## Risks and stop conditions

1. **Silent empty bundles (critical):** v3 may compile successfully while missing `VITE_*` values. CI must build both apps with synthetic **`.env.production` files**, then verify concrete public sentinel strings inside both generated SPA bundles. Do not trust the mobile validator alone.
2. **Version drift:** the native version must derive from Quasar's actual resolved bundled values, not a replica of the old Vite env loader. Test real interpolation and explicit empty process values.
3. **Install failures:** v3 removes `#q-app/wrappers`; apply its config updates, env settings, and Node pin before the first install/postinstall gate.
4. **Toolchain drift:** tests and the Quasar CLI must resolve compatible Vite versions; reject `parseSync`/peer errors and keep extension tests green.
5. **Migration scope:** old aliases need a large mechanical rewrite, kept in a separate commit **within this PR**. Delete unsupported unused config, do not refactor functional features.
6. **Documentation/runtime drift:** update deployment and mobile scripts and ensure the frontend Node pin is honored in CI and deploy. Record real runs; skipped draft checks do not count.

## Acceptance contract

- [ ] The same PR contains a mechanical alias commit that is verified against v2, then an atomic v3 migration; frozen install, supported Node 22.22.0 and peer graph, two Quasar builds, web/mobile Vitest+coverage, extension regression, typechecks/lint and native asset build all pass on their tested commits.
- [ ] `build-lint.yml` writes **real placeholder `.env.production` files** for both apps, rather than relying solely on process env values; CI checks the *web* bundle contains its web Cognito sentinel and the *mobile* bundle contains mobile API/Cognito sentinels (e.g. `example.invalid` and `us-east-1_ciPlaceholder`). Missing sentinel fails CI.
- [ ] Mobile production env validation and Capacitor-only native version sync read the actual Quasar-resolved defines. Unit tests use fake resolved configs, **one real build** checks file/interpolation/empty override parity between bundled UI and project.pbxproj. Direct `dotenv`/`dotenv-expand` loaders are absent.
- [ ] Existing mocked Playwright browser CI passes (including on draft PRs). An **MCP-driven** representative desktop/mobile end-to-end check additionally verifies navigation and visible UI on the tested commit. Capture **one screenshot per app and inspect visually** (no mockup attached), rather than building a brittle pre/post screenshot-diff framework. A native Simulator launch/version/screenshot is captured by MCP if available; label unavailable iOS evidence unverified.
- [ ] Node setup is pinned in build, unit, e2e, and deploy paths; `workflow_dispatch` is used for draft-only build/unit checks because their PR jobs are skipped. CI checks are ongoing automated regression gates, not a replacement for MCP E2E acceptance.
- [ ] GitHub PR and Linear record how #76 was superseded and why #75's direct dependency is removed; no new PR, no manual acceptance, no mass unignore. Tests and implementation are **not yet run** at design stage.

Source notes: [Quasar CLI v3 upgrade](https://quasar.dev/quasar-cli-vite/upgrade-guide/); [Quasar env configuration](https://quasar.dev/quasar-cli-vite/handling-import-meta-env/); [GitHub review](https://github.com/cwchanap/Vela/pull/93#pullrequestreview-5925171471).
