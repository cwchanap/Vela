# iOS interaction baseline: safe-area ownership

## Selected policy

- Native `ios.contentInset`: `"never"`
- Headerless top owner: app CSS
- Policy literal: `{ contentInset: 'never', headerlessTopOwner: 'css' }`

The `"always"` candidate failed the load-bearing headerless-top requirement:
in portrait, `env(safe-area-inset-top)` computed to `62px`, but the headerless
`.q-page` remained at `top: 0`. The native scroll view therefore did not give
the headerless page its required single top inset. The `"never"` candidate,
with the CSS probe class on `.q-page-container`, placed the same page at
`top: 62` exactly once.

## Measurement environment

- Source commit before task changes:
  `8559155d90eeb08cded62ee8a1f3ba242861475e`
- Simulator: iPhone 17 Pro, UDID redacted (raw identifier
  removed from source per the mobile secret policy)
- Simulator runtime: iOS 26.5
- Xcode: 26.6 (build 17F113)
- Build configuration: Debug, Quasar Capacitor development mode
- App bundle: `com.vela.app`
- App route: `/` (the M1 scaffold home page)
- Orientations measured independently: portrait, landscape left, landscape
  right
- Inspector method: the task's exact JavaScript helpers were evaluated in the
  running Capacitor `WKWebView`; each result below was read fresh before its
  screenshot.

The current M1 scaffold page has no product control. For the selected
`"never"` preflight only, the live inspector injected a temporary
`button#safe-area-preflight-page-control` as the first `.q-page` child. It used
normal flex layout with `margin-right: auto`, so its measured left edge came
from the page's real padded content edge rather than duplicating the safe-area
formula on the control. The probe was removed after every header pair and no
harness-only product code was committed.

## Exact computed results

Bounds use CSS pixels in `{ top, right, bottom, left, width, height }` order.
The `"never"` landscape directions produced the same numeric bounds. In the
native-inset `"always"` run, landscape right exposed a `394px` layout bottom
instead of landscape left's `402px`; the values are therefore recorded
separately rather than normalized. Distinct screenshots verify the sensor
housing on each physical side.

### `contentInset: "always"` with native-scroll-view headerless ownership

| Orientation / probe          | Insets `{top,right,bottom,left}` | Page                                | Page first control | Header toolbar          | Header back                          | Footer tabs              | Footer first tab                      | Footer last tab                               |
| ---------------------------- | -------------------------------- | ----------------------------------- | ------------------ | ----------------------- | ------------------------------------ | ------------------------ | ------------------------------------- | --------------------------------------------- |
| Portrait / headerless        | `{62px,0px,34px,0px}`            | `{0,402,750,0,402,750}`             | `null`             | `null`                  | `null`                               | `{750,402,840,0,402,90}` | `{750,78.546875,806,0,78.546875,56}`  | `{750,402.015625,806,323.46875,78.546875,56}` |
| Portrait / header            | `{62px,0px,34px,0px}`            | `{0,402,750,0,402,750}`             | `null`             | `{0,402,112,0,402,112}` | `{65,115.34375,109,12,103.34375,44}` | `{750,402,840,0,402,90}` | `{750,78.546875,806,0,78.546875,56}`  | `{750,402.015625,806,323.46875,78.546875,56}` |
| Landscape left / headerless  | `{0px,62px,20px,62px}`           | `{0,750,326,0,750,326}`             | `null`             | `null`                  | `null`                               | `{326,750,402,0,750,76}` | `{326,185.34375,382,62,123.34375,56}` | `{326,688,382,564.65625,123.34375,56}`        |
| Landscape left / header      | `{0px,62px,20px,62px}`           | `{0,750,326,0,750,326}`             | `null`             | `{0,750,50,0,750,50}`   | `{3,165.34375,47,62,103.34375,44}`   | `{326,750,402,0,750,76}` | `{326,185.34375,382,62,123.34375,56}` | `{326,688,382,564.65625,123.34375,56}`        |
| Landscape right / headerless | `{0px,62px,20px,62px}`           | `{0,750,318.15625,0,750,318.15625}` | `null`             | `null`                  | `null`                               | `{318,750,394,0,750,76}` | `{318,185.34375,374,62,123.34375,56}` | `{318,688,374,564.65625,123.34375,56}`        |
| Landscape right / header     | `{0px,62px,20px,62px}`           | `{0,750,318.15625,0,750,318.15625}` | `null`             | `{0,750,50,0,750,50}`   | `{3,165.34375,47,62,103.34375,44}`   | `{318,750,394,0,750,76}` | `{318,185.34375,374,62,123.34375,56}` | `{318,688,374,564.65625,123.34375,56}`        |

### `contentInset: "never"` with CSS headerless ownership

| Orientation / probe          | Insets `{top,right,bottom,left}` | Page                     | Page first control                      | Header toolbar          | Header back                          | Footer tabs              | Footer first tab                        | Footer last tab                                |
| ---------------------------- | -------------------------------- | ------------------------ | --------------------------------------- | ----------------------- | ------------------------------------ | ------------------------ | --------------------------------------- | ---------------------------------------------- |
| Portrait / headerless        | `{62px,0px,34px,0px}`            | `{62,402,846,0,402,784}` | `{432,119.859375,476,16,103.859375,44}` | `null`                  | `null`                               | `{784,402,874,0,402,90}` | `{784,78.546875,840,0,78.546875,56}`    | `{784,402.015625,840,323.46875,78.546875,56}`  |
| Portrait / header            | `{62px,0px,34px,0px}`            | `{62,402,846,0,402,784}` | `{432,119.859375,476,16,103.859375,44}` | `{0,402,112,0,402,112}` | `{65,115.34375,109,12,103.34375,44}` | `{784,402,874,0,402,90}` | `{784,78.546875,840,0,78.546875,56}`    | `{784,402.015625,840,323.46875,78.546875,56}`  |
| Landscape left / headerless  | `{0px,62px,20px,62px}`           | `{0,874,326,0,874,326}`  | `{141,165.859375,185,62,103.859375,44}` | `null`                  | `null`                               | `{326,874,402,0,874,76}` | `{326,210.140625,382,62,148.140625,56}` | `{326,811.984375,382,663.84375,148.140625,56}` |
| Landscape left / header      | `{0px,62px,20px,62px}`           | `{0,874,326,0,874,326}`  | `{141,165.859375,185,62,103.859375,44}` | `{0,874,50,0,874,50}`   | `{3,165.34375,47,62,103.34375,44}`   | `{326,874,402,0,874,76}` | `{326,210.140625,382,62,148.140625,56}` | `{326,811.984375,382,663.84375,148.140625,56}` |
| Landscape right / headerless | `{0px,62px,20px,62px}`           | `{0,874,326,0,874,326}`  | `{141,165.859375,185,62,103.859375,44}` | `null`                  | `null`                               | `{326,874,402,0,874,76}` | `{326,210.140625,382,62,148.140625,56}` | `{326,811.984375,382,663.84375,148.140625,56}` |
| Landscape right / header     | `{0px,62px,20px,62px}`           | `{0,874,326,0,874,326}`  | `{141,165.859375,185,62,103.859375,44}` | `{0,874,50,0,874,50}`   | `{3,165.34375,47,62,103.34375,44}`   | `{326,874,402,0,874,76}` | `{326,210.140625,382,62,148.140625,56}` | `{326,811.984375,382,663.84375,148.140625,56}` |

## Decision rules

| Rule                                                                           | `"always"`                                                                                                                               | `"never"`                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headerless content has exactly one top inset                                   | **FAIL.** Portrait page top was `0` while the computed top inset was `62px`.                                                             | **PASS.** CSS moved the portrait page top to exactly `62`; landscape top inset and page top were both `0`.                                                                                                           |
| Fixed toolbar and footer have exactly one top/bottom inset                     | **PASS.** Portrait back button began at `65`; footer controls ended at `806` inside the native-inset layout bottom of `840`.             | **PASS.** Portrait back button began at `65`; footer controls ended at `840`, leaving the computed `34px` bottom inset inside the `874px` viewport.                                                                  |
| All four CSS `env()` values are usable                                         | **PASS.** Portrait produced top/bottom `62/34`; both landscapes produced left/right/bottom `62/62/20`, with the irrelevant edges at `0`. | **PASS.** The same four computed values remained available after native inset ownership was disabled.                                                                                                                |
| Page, toolbar, and footer horizontal rules avoid both landscape sensor regions | **NOT ESTABLISHED.** The rejected run had no page control, and it already failed the mandatory headerless-top rule.                      | **PASS.** In both directions, the page probe and back control began at `x=62`; the first tab began at `x=62`; and the last tab ended at `x=811.984375`, inside the right safe bound `x=812` in the `874px` viewport. |
| No top or bottom inset is visibly doubled                                      | **PASS where present, but not sufficient.** The required headerless top inset was absent rather than doubled.                            | **PASS.** Screenshots show one toolbar/status region and one footer/home-indicator region; the numeric bounds match one inset.                                                                                       |
| Overall deterministic result                                                   | **FAIL**                                                                                                                                 | **PASS — selected**                                                                                                                                                                                                  |

## Failure reproduction

To reproduce the rejected `"always"` result:

1. Set `ios.contentInset` to `"always"`, synchronize the iOS project, and
   launch the Debug build on the iPhone 17 Pro simulator in portrait.
2. Evaluate the documented task helpers.
3. Run:
   `removeSafeAreaHeaderProbe();`,
   `installSafeAreaStyleProbe('native-scroll-view');`, then
   `readSafeAreaPreflight();`.
4. Observe `insets.top === "62px"` and `page.top === 0`.

This is a missing native headerless-top inset, so `"always"` cannot own the
headerless top edge under the task contract.

## Evidence

- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-always-headerless-portrait.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-always-header-portrait.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-always-headerless-landscape-left.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-always-header-landscape-left.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-always-headerless-landscape-right.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-always-header-landscape-right.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-never-headerless-portrait.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-never-header-portrait.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-never-headerless-landscape-left.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-never-header-landscape-left.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-never-headerless-landscape-right.png`
- `apps/vela-mobile/docs/evidence/hpa-209/safe-area-never-header-landscape-right.png`

Selected-mode replacement hashes after the page-control fix:

- `a1855e5a6a82608b88be75a8a7430c5bebbff5dd`
  — `safe-area-never-headerless-portrait.png`
- `44b974484d2a45fc85321b06a5a9ad5d568079ad`
  — `safe-area-never-header-portrait.png`
- `08713b2d6ce20d316fc0f9f6941d08730321e35f`
  — `safe-area-never-headerless-landscape-left.png`
- `ec187f7f903a0cbe1e22cd98894ea6d9df4d1d5f`
  — `safe-area-never-header-landscape-left.png`
- `2898a2d35484503560f77df072e267e71451d3d0`
  — `safe-area-never-headerless-landscape-right.png`
- `b1a55d5420699af4874d154a72127105d850c128`
  — `safe-area-never-header-landscape-right.png`

## Result policy

- Record a row only after running that environment.
- Put the exact tested commit SHA in every environment row.
- Record whether the row used Debug development, Release smoke, or production
  Capacitor assets.
- Record whether the WebView loaded from the LAN development server or
  packaged assets.
- A failure includes reproduction steps and a linked follow-up issue.
- Physical Japanese IME and WKWebView swipe results are release-blocking.

## HPA-210 linkage

HPA-210 selected passing automated machine manifest for
`24ad58104f54d375b9e619aec5be719811106c71`, the current behavior revision
containing the verification-tooling fixes. The iOS Simulator manifest on
`de276f372c7973e2fb49c81e9a78e50df95266c0` is stale: it predates
verification-tooling changes that create a new behavior commit under the
design's rerun policy, so it is retained as historical evidence only and must
be regenerated on the final PR head before it can be selected. The earlier
physical preflight on `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65` is historical
only: its physical preflight is `prerequisite_missing`, physical-device testing
was deferred, and it has no physical acceptance result. This baseline therefore
remains historical evidence with no HPA-210 physical acceptance result. See
[M1 iOS Foundation Verification](m1-ios-foundation-verification.md).

## Environment matrix

| Environment                                     | Commit                                     | Build configuration | Asset source                                 | Model         | OS       | Xcode         | Japanese keyboard                  | Orientation                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------ | ------------------- | -------------------------------------------- | ------------- | -------- | ------------- | ---------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS Simulator, small-screen keyboard/layout run | `d261de358a54d8ffd41a02e0107c84e5e3d90c2d` | Debug development   | LAN development server (`192.168.1.66:9100`) | iPhone 17e    | iOS 26.5 | 26.6 (17F113) | English (US); Japanese IME not run | Portrait, then landscape left while keyboard remained open        | **PASS for the observed simulator layout checks.** The focused native input remained focused. In landscape, the keyboard-reduced viewport was `844×182`; scrolling placed the 44-point Submit control at `top=138.078125`, `bottom=182.078125`. After blur, the viewport returned to `844×390`, keyboard readout changed to `no`, and one footer returned at `top=314`, `bottom=390`, `height=76`. |
| iOS Simulator, Dynamic Island development run   | `d261de358a54d8ffd41a02e0107c84e5e3d90c2d` | Debug development   | LAN development server (`192.168.1.66:9100`) | iPhone 17 Pro | iOS 26.5 | 26.6 (17F113) | English (US); not opened           | Portrait; an earlier launch also observed one landscape direction | **PARTIAL.** Home, More, Diagnostics, Detail, and visible back were observed with the Dynamic Island clear of content. Visible back returned to the exact diagnostic root. Two injected native left-edge gesture attempts completed as no-ops on Detail, so native swipe behavior is not marked passing.                                                                                           |
| iOS Simulator, packaged core-shell run          | `d261de358a54d8ffd41a02e0107c84e5e3d90c2d` | Release smoke       | packaged WebView assets                      | iPhone 17 Pro | iOS 26.5 | 26.6 (17F113) | Not opened                         | Landscape; direction not exposed by the headless capture          | **PARTIAL.** The Release build installed and launched Home with the Production badge; first and last footer tabs were visible inside the tested safe edges. The production artifact scan found no diagnostic marker. More, portrait, and both landscape directions were not all interactively exercised, so the full Release smoke is not marked passing.                                          |

The paired physical inventory contained an available iPhone 15
(`iPhone15,4`, CoreDevice identifier redacted — raw identifier removed
from source per the mobile secret policy). This XcodeBuildMCP session
exposed simulator workflows only, with no physical-device build or UI
interaction tools. The physical scenarios were therefore not run, no
physical environment row was added, and HPA-209 remains release-blocked.

## Japanese IME evidence

The mandatory physical Japanese IME scenario was not run. No draft, committed,
bound-model, post-render native-input, or submitted value was observed, so
none is recorded as `日本語`. Completion still requires an iPhone Debug
development run using the LAN development server and a Japanese Kana keyboard,
with all five observed values exactly `日本語`.

## Keyboard, safe-area, and orientation evidence

- The small-screen simulator opened the real iOS software keyboard after the
  live `WKWebView` input was focused. Portrait kept the focused block and
  Submit visible and hid the footer.
- The same focused input was rotated to landscape left through
  `UIWindowScene.requestGeometryUpdate`. The focused block remained present.
  Submit was below the initial reduced viewport, then became reachable after a
  real page scroll, with its full 44-point height ending at the viewport edge.
- Blurring the native input changed the diagnostic keyboard readout from
  `yes` to `no`; the footer returned once with no stale keyboard gap. The
  selected inset owner remained native `contentInset: "never"` plus CSS
  headerless-top ownership.
- The iPhone 17 Pro portrait capture kept the Dynamic Island above the app
  content. The earlier Task 0 measurements remain the authoritative
  portrait/landscape-left/landscape-right safe-area evidence.

## Navigation evidence

- Real DOM control actions produced the chronology
  Home → More → Diagnostics → Detail on the iPhone 17 Pro simulator.
- The visible Detail back button returned to the exact Diagnostics root.
- After re-entering Detail, two XcodeBuildMCP native
  `swipe-from-left-edge` gestures (default and `190px` over `1.2s`) reported
  successful input delivery but left the completed route at
  `#/diagnostics/ios-interactions/detail`. Swipe-forward was not run after
  that no-op.
- Detail-to-Home chronology, in-session entry back/forward, resume/no-op,
  cold entry, twenty Home/Review alternations, blank-frame observation, and
  exit/trap behavior were not completed on a physical iPhone. Automated tests
  cover their source contracts, but those source-level change detectors are
  not substitutes for the required native run.
- Because the physical WKWebView swipe scenario was not run, no WebKit
  transition type or physical completion behavior is recorded.

## Automated verification

The automated web and Capacitor asset commands below were run against
`94da5e455a12c47fbb7dd7ff02dfff2267548e73`; the final post-sync simulator
compilation used the documentation commit identified in its own bullet.
The test/coverage/lint/typecheck/build/scan commands were re-run at
`bcfe0436f694243a790260bd0cd0bf07d27188b4` with the review fixes applied
(timeout fallback, forbidden-token list update, label constant usage); the
updated counts are recorded in the re-run bullets below.

- `bun run test:unit`: 27 files, 195 tests passed (193 at `bcfe043` before
  review fixes; +2 from the timeout-fallback and forbidden-token tests). The
  intentional guard-failure test still emits its expected Vue Router warning.
- `bun run test:coverage`: 27 files, 195 tests passed; line coverage was
  `97.17%`, above the configured 95% threshold. The same expected warning was
  emitted.
- `bun run lint`, `bun run typecheck`, and the SPA production build with
  `VITE_MOBILE_API_URL=https://example.invalid/api/`: passed.
- `verify:production-diagnostics`: re-run at HEAD after the leak-fix commits
  (`9cdb99b`, `94da5e4`) with a real macOS Capacitor build and `cap sync ios`;
  no diagnostic marker was found under `src-capacitor/www`. Re-run again after
  the review fixes (which added `DIAGNOSTIC_COLD_ENTRY_KEY` to the forbidden
  token list); still no marker found.
- Final `bunx cap sync ios`: passed and found `@capacitor/app@7.1.2` and
  `@capacitor/keyboard@7.0.6`.
- Post-final-sync simulator compilation: passed against
  `95611efb619bbcb8d3a81a46ff8ce0b75a620f03`. XcodeBuildMCP first showed
  defaults, then confirmed the `App.xcworkspace`, `App` scheme, iPhone 17 Pro
  (iOS 26.5), and Debug configuration before `build_sim`. The build completed
  in 2.0 seconds with the existing CocoaPods `[CP] Embed Pods Frameworks`
  always-run warning. Its log is
  `~/Library/Developer/XcodeBuildMCP/workspaces/vela-595d49e6efe6/logs/build_sim_2026-07-26T11-01-13-673Z_pid80927_8de9c869.log`.
- Debug simulator builds passed on iPhone 17e and iPhone 17 Pro. The Release
  simulator build passed with eight dependency/build-phase warnings; it was
  not pristine warning-free output.

## Reusable rules

- Do not validate, normalize, or submit while Japanese composition is active.
- Hide bottom tabs on keyboard will-show and scroll after keyboard did-show.
- Follow the Task 0 safe-area policy; Quasar owns fixed top/bottom CSS while
  page, toolbar, and footer tabs own horizontal insets.
- Route links, tabs, and validated in-session entry through app-owned
  chronological `mobileDepth`.
- Restore saved scroll positions on back and forward.
- Resume does not navigate without a newly validated entry event.
- Ordinary pushes and validated in-session entry share
  visible-back/native-swipe history. Only a fresh cold entry replaces at depth
  zero and uses its declared header fallback.
