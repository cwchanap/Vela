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
- Simulator: iPhone 17 Pro, UDID
  `C248EC05-3E01-4A13-9BEF-5EB06C171432`
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

- `docs/evidence/hpa-209/safe-area-always-headerless-portrait.png`
- `docs/evidence/hpa-209/safe-area-always-header-portrait.png`
- `docs/evidence/hpa-209/safe-area-always-headerless-landscape-left.png`
- `docs/evidence/hpa-209/safe-area-always-header-landscape-left.png`
- `docs/evidence/hpa-209/safe-area-always-headerless-landscape-right.png`
- `docs/evidence/hpa-209/safe-area-always-header-landscape-right.png`
- `docs/evidence/hpa-209/safe-area-never-headerless-portrait.png`
- `docs/evidence/hpa-209/safe-area-never-header-portrait.png`
- `docs/evidence/hpa-209/safe-area-never-headerless-landscape-left.png`
- `docs/evidence/hpa-209/safe-area-never-header-landscape-left.png`
- `docs/evidence/hpa-209/safe-area-never-headerless-landscape-right.png`
- `docs/evidence/hpa-209/safe-area-never-header-landscape-right.png`

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
