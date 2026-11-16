# HPA-918 — Coordinated Quasar/Vite 8 Upgrade (Single-PR Implementation Plan)

**Status:** Proposed, not implemented. This is a design/plan-only draft until code and verification receipts are added.  
**Ticket:** https://linear.app/cwchanap/issue/HPA-918/maintenance-coordinate-ignored-quasar-and-env-dependency-majors  
**Design:** [HPA-918 design spec](../specs/2026-11-16-hpa918-quasar-vite8-upgrade-design.md)  
**Delivery:** **One PR for this entire ticket.** Continue implementation, tests, review replies, and acceptance evidence on this same draft PR. Never open a separate implementation PR for HPA-918.

## Current main findings (2026-11-16)

- `apps/vela/package.json`: `@quasar/app-vite@^2.1.0`, `@quasar/vite-plugin@^1.8.0`, `vue-router@^4.3.0`, `vitest@^3.2.4`, `@vitest/coverage-v8@^3.2.4`; web unit config imports the direct plugin.
- `apps/vela-mobile/package.json`: `@quasar/app-vite@^2.4.0`, plugin v1, Router 4, Vitest/coverage 3 and explicit `dotenv-expand@11.0.7`; its tests also import the plugin.
- `apps/vela-ext/package.json`: Vitest/coverage 3, independent WXT entrypoint. Preserve its behavior when changing the shared Bun lockfile.
- `apps/vela*/quasar.config.ts` use `#q-app/wrappers` and Node 20 build targets. Web config also has `build.env`, manual Rollup chunks and a Vite checker. Mobile build hooks validate production API/OAuth env.
- `apps/vela*/src/router/index.ts` use `process.env.SERVER` and `process.env.VUE_ROUTER_MODE`; both will need the Quasar v3 form.
- `apps/vela-mobile/scripts/sync-ios-version.mjs` and `build/validate-mobile-api-url.ts` use dotenv expansion. The former's `sync-ios-version.test.mjs` covers empty overrides; the latter's `validate-mobile-api-url.test.ts` covers production keys.
- `.github/workflows/unit-test.yml` **skips draft PRs**, so a green/skipped draft status is not test evidence. Use reproducible local/agent execution, or dispatch a CI run for the branch, and record outputs.
- Open Vitest [PR #89](https://github.com/cwchanap/Vela/pull/89) changes the runner without the matching coverage provider; open #90/#91 concern separate DOM dependency majors. The previous Quasar and dotenv PRs [#76](https://github.com/cwchanap/Vela/pull/76) and [#75](https://github.com/cwchanap/Vela/pull/75) are closed without merging.

## Task 0 — Rebase and establish baseline

1. Rebase this draft PR onto the latest main before editing code. Inspect whether PR #89 merged; do not cherry-pick a partially compatible runner upgrade or create a separate Vitest migration PR.
2. Record the installed Vite/Quasar plugin/CLI/Vitest/coverage graph from `bun.lock` or `bun pm why`; check the app's existing Node/tooling requirements and the GitHub Actions runner.
3. Run existing focused `sync-ios-version` and production-env validation tests; capture baseline behavior and current web/mobile screenshots via an MCP-controlled browser (there is no mockup in HPA-918).
4. Locate remaining `#q-app/wrappers`, obsolete import aliases, Quasar-specific `process.env`, `build.env`, and `rollupOptions` usages. Search real source and tests, not archived docs.

**Gate:** Document current dependency resolution and baseline screenshots in the PR. Do not claim test success if not executed.

## Task 1 — One compatible dependency graph

**Files:** `apps/vela/package.json`, `apps/vela-mobile/package.json`, `apps/vela-ext/package.json` only if necessary, `bun.lock`, app engine settings and affected CI tooling.

1. Move both apps to Quasar CLI `@quasar/app-vite@3.x`, `@quasar/vite-plugin@2.x`, Vite 8, and Vue Router 5. Keep a compatible `@vitejs/plugin-vue@6.x`. Use one Node 22.22+ runtime for affected frontend tooling; do not touch the API Lambda Node 20 deployment contract.
2. Upgrade the two Quasar apps' `vitest` **together with** `@vitest/coverage-v8` to compatible 5.x versions. Reconcile the extension workspace: keep its existing isolated Vite/Vitest/coverage graph only if resolution/tests remain valid, otherwise align its Vitest+coverage pair in this same PR.
3. Re-run Bun installation to commit one lockfile. Verify that the CLI build and the direct Quasar Vite plugin used by Vitest both resolve Vite 8; neither app may load Vite 7 when importing plugin v2.
4. Check whether the legacy `@quasar/quasar-app-extension-testing` dependency actually executes in the app; remove it if unused/incompatible, instead of adding a shim.
5. Leave unrelated jsdom/happy-dom Dependabot majors to their existing PRs. Address overlap with PR #89 in this PR description rather than introducing duplicate code PRs.

**Gate:** Clean frozen install, supported Node/peer versions, both unit-test configs load (no `parseSync` error).

## Task 2 — Upgrade the two Quasar configurations and runtime imports

**Files:** `apps/vela/quasar.config.ts`, `apps/vela-mobile/quasar.config.ts`, both routers/boot files, affected source aliases and `vitest.config.ts`, test mocks, env types.

1. Use the official [Quasar CLI v3 migration guide](https://quasar.dev/quasar-cli-vite/upgrade-guide/). Replace `#q-app/wrappers` with `#q-app`; update route/boot wrappers and their test doubles. Use Vue Router 5 APIs as required by the actual code.
2. Replace generated `process.env.SERVER`/`VUE_ROUTER_MODE` checks with the v3-supported `import.meta.env.QUASAR_*` values. Preserve history-mode URLs, back navigation, authentication gate, and mobile resume/deep-link routing.
3. Replace removed `src/`, `pages/`, `boot/`, etc. app aliases in active source with v3 `@/` imports. Preserve only legitimate workspace and Capacitor path aliases. Do not install a blanket old-alias compatibility map.
4. Rework web `build.env` to avoid leaking environment variables while preserving the intended `VITE_*` runtime contract. Check web auth/API client configuration and mobile production config checks after the new CLI env handling.
5. Remove unused legacy Rollup chunk customization if it is no longer valid under Vite 8/Rolldown; only adapt needed optimizations. Keep the `@vela/common`/tokenizer and `path-browserify` alias behavior, Vite checker if compatible, and mobile `validateMobileApiUrlPlugin` invocation.
6. Update browser build targets to those supported by the new Quasar tooling and generated types; do not attempt to support old versions by preserving duplicate config paths.

**Gate:** Web and mobile `quasar prepare`, typechecks, and production SPA builds pass; native Capacitor assets build; generated env and route behavior are unchanged at the feature level.

## Task 3 — Decide the dotenv-expand hold and prove mobile env parity

**Default decision:** Keep the direct mobile pin at `dotenv-expand@11.0.7`. Do **not** upgrade it to v1000 simply because Vite/Quasar is moving. No command substitution/decryption feature is needed.

1. Retain the current `sync-ios-version.mjs` / `validate-mobile-api-url.ts` behavior unless tests demonstrate Quasar v3 requires a focused adjustment.
2. Extend or adapt existing tests to cover: nonempty process override, **empty** process override + nonempty `.env.production`, absent override, mode-specific file, no file, referenced variable, and all production API/Cognito required keys including explicit empty values.
3. Compare `sync:ios-version`'s resolved `MARKETING_VERSION` with the actual compiled mobile UI's `import.meta.env.VITE_APP_VERSION || package version` under representative synthetic env combinations. Do not assume the old Vite 7 expansion implementation still describes v3.
4. If v3 semantics cannot be matched while retaining the direct parser, consider **removing** both direct dotenv expansion callsites in favor of the actual build tool's env loader (with tests); otherwise explicitly retain the v11 dependency and document the v1000 hold. Never introduce a second abstraction just for this migration.
5. Add the final retain/remove decision and regression evidence to HPA-918. Do not unignore v1000 or dismiss Dependabot alerts as a substitute for code validation.

**Gate:** The iOS marketing version equals the Home page's displayed version for every supported precedence case. Production build validation rejects explicit empty required values.

## Task 4 — Automated integration, E2E, and visual acceptance

Run the following on the implementation commit (not merely the docs commit). Capture command, commit SHA, exit status, and pertinent logs in this PR.

### Build/unit gates

- [ ] `bun install --frozen-lockfile`; verify Quasar CLI/plugin/Vite/Vitest/coverage versions and no unsupported peer mix.
- [ ] `bun --cwd packages/common run build` before dependent app typecheck/test builds.
- [ ] `bun --cwd apps/vela run test:unit --coverage` and `bun --cwd apps/vela-mobile run test:unit --coverage`; existing coverage thresholds remain enforced.
- [ ] `bun --cwd apps/vela-ext run test:unit --coverage` (and extension compile) to catch lockfile regressions.
- [ ] App lint/typechecks and production web/mobile builds succeed with synthetic **valid** configuration, not a permanent `MOBILE_SKIP_ENV_VALIDATION` bypass.
- [ ] `bun --cwd apps/vela-mobile run sync:ios-version` plus mobile `build:ios:assets` succeed with a valid mode/version; compare `project.pbxproj` and generated client version.
- [ ] Focused version/env test matrix passes, including empty override and variable interpolation; no `parseSync` config-load error.

### MCP-only E2E acceptance

- [ ] From an **MCP-controlled browser**, launch the built/mocked web application and exercise a representative authenticated route (e.g. Home and Learn navigation). Confirm loaded content and browser-back navigation, no console/runtime errors.
- [ ] From an **MCP-controlled browser** in a 390 × 844 viewport, exercise the mobile web shell with mocked auth: Home -> Learn -> back, tab navigation, no clipping of key navigation controls.
- [ ] Store baseline and post-upgrade screenshots at 1440 × 900 (web) and 390 × 844 (mobile). Perform an automated/agent visual comparison; there is **no Linear UI mockup** for this maintenance task. Any meaningful unexplained difference fails acceptance.
- [ ] Where an iOS Simulator with MCP automation is available, launch the Capacitor build, navigate the mobile shell, verify displayed version and capture an iOS screenshot. If unavailable, explicitly mark this gate unverified rather than requesting manual acceptance.
- [ ] Exercise the existing mocked browser E2E suite as an additional regression gate; the **acceptance evidence must come from MCP execution**, not just a standalone CLI exit code.

This task changes frontend build tooling but no backend behavior, so no new backend API E2E flow is introduced. Each changed platform's build and representative UI must nevertheless be checked.

## Task 5 — Review and traceability

1. Add an evidence table to this same PR: tested commit, resolved versions, web/mobile builds, extension tests, env matrix, MCP/browser screenshots, and iOS Simulator status.
2. Fix actual review findings on the same branch and rerun affected checks. The existing unit-test CI skips **draft** PRs; never interpret skipped checks as green. Trigger a branch workflow if supported or provide direct MCP/runner evidence before marking ready.
3. Link this PR to Linear HPA-918 and the closed upstream PRs:
   - [#76](https://github.com/cwchanap/Vela/pull/76): superseded only after coordinated v3/Vite 8 success.
   - [#75](https://github.com/cwchanap/Vela/pull/75): retained v11 hold unless a separately validated remove/replace decision is documented on this PR.
4. Leave other Dependabot ignore rules and unrelated upgrades untouched. Only mark HPA-918 complete after the upgrade and the explicit env decision satisfy this acceptance checklist.

## End-to-end definition of done

HPA-918 is done when the **same PR** implements a coherent Vite 8 / Quasar v3 toolchain for both apps; unit+coverage, typecheck, build, and extension regression checks pass; the production API/env guard and native version parity pass; the MCP browser paths and screenshot comparisons pass; any iOS-only verification limitations are clearly identified; and Linear records the validated #76 supersession plus the #75 retain/remove rationale.

**No manual/human acceptance criterion. No second implementation PR. No mass dependency unignore.**
