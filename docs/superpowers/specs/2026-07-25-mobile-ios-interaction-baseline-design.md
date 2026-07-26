# Mobile MVP M1: Japanese Input, Safe Areas, Keyboard, and iOS Navigation Baseline

**Linear issue**: [HPA-209](https://linear.app/cwchanap/issue/HPA-209/mobile-mvpm1-validate-japanese-input-safe-areas-keyboard-and-ios)  
**Parent epic**: [HPA-194](https://linear.app/cwchanap/issue/HPA-194/mobile-mvp-build-an-ios-first-vela-learning-app-from-existing-features)  
**Date**: 2026-07-25

## Goal

Establish a reusable, physically verified iOS interaction baseline for the Vela mobile app before learning screens are implemented. The work must prove that Japanese IME composition, keyboard-driven viewport changes, safe areas, route history, navigation controls, and orientation changes behave predictably in the Quasar and Capacitor shell.

## Current baseline

`apps/vela-mobile` currently provides:

- A Quasar `MobileLayout` with `Home | Review | Learn | Words | More` bottom navigation.
- Bottom safe-area padding through Quasar's native `body.q-ios-padding` handling and a web-iOS fallback.
- Vue Router history selection that uses hash history for Capacitor builds.
- Capacitor 7 with the App plugin installed.
- `ios.contentInset: "always"` in `capacitor.config.json`.
- A standard `CAPBridgeViewController` root controller.
- No Japanese-input probe, keyboard plugin, nested diagnostic route, route-entry policy, or device matrix.

The pre-design baseline is clean: 12 Vitest files and 104 tests pass at commit
`1c16f9ea2196d3c012ee620702f4af376d09c2f8`.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Diagnostic lifetime | Permanent source, available only in development builds | Keeps a reusable validation harness without exposing internal tooling to production users |
| Entry point | Development-only item on More | Discoverable to developers and device testers |
| Diagnostic routes | `/diagnostics/ios-interactions` and `/diagnostics/ios-interactions/detail` | Exercises real nested route history inside the mobile shell |
| Architecture | Reusable interaction harness | Subsequent mobile pages should consume proven conventions instead of repeating a spike |
| Physical testing | Required before HPA-209 is complete | IME composition and native swipe behavior cannot be accepted from jsdom or browser simulation |
| Orientation | Portrait and landscape remain functional | Landscape is a valuable compact-height keyboard stress case |
| General app links | Not introduced by this issue | The existing custom scheme remains OAuth-only; universal links or another scheme require separate product and security decisions |
| Deep-link behavior | Define and test route-entry policy without registering new external links | Establishes semantics now without expanding the public URL surface |
| Swipe-back | Enable only WKWebView's native back/forward gesture | Avoids a competing JavaScript or third-party gesture system |
| Bottom-tab history | Route every tab switch through the app-owned navigation helper and retain chronological history for M1 | A tab switch is a real navigation in this spike, so native swipe returns to the exact previously visible route. This deliberately favors observable history over bounded tab history and must be revisited in M2 after physical repeated-switch testing |
| History scroll position | Restore Vue Router's saved position on back/forward; scroll new pushes to the top | Keeps native swipe transitions visually coherent while preserving predictable forward navigation |
| Keyboard resize | Explicitly pin Capacitor Keyboard `native` resize | `native` is already Capacitor iOS's default; the explicit configuration and contract test prevent a future default or configuration drift |
| Bottom navigation with keyboard | Hidden while the native keyboard is visible | Preserves compact-height space for the focused field and primary action |
| Safe-area ownership | Decide `ios.contentInset` through a simulator preflight before building the full harness | The existing `.always` setting has never been exercised with both headerless and header-enabled routes; the design must not guess whether native scroll insets and CSS `env()` values combine or double |
| Production impact | Reusable shell, keyboard, and native navigation behavior ship; diagnostic pages do not | Later mobile pages need the baseline behavior, but users do not need the probe UI |

## Scope

### In scope

- Add a development-only diagnostic entry on More.
- Add a two-route diagnostic journey inside `MobileLayout`.
- Add an optional metadata-driven mobile header with a predictable back action.
- Add a Japanese-capable input probe with explicit composition handling.
- Make the input and primary action recoverably visible when the iOS keyboard appears.
- Add explicit Capacitor Keyboard configuration and lifecycle handling.
- Run a safe-area preflight that compares `ios.contentInset: "always"` and
  `"never"` with headerless content, a fixed header, and the existing fixed
  footer before committing to an inset owner.
- Extend safe-area handling to top, bottom, left, and right insets.
- Keep portrait and landscape usable.
- Enable WKWebView native back/forward gestures through a Capacitor view-controller subclass.
- Define and test in-app navigation, route entry, app resume, repeated delivery, and fallback behavior.
- Add automated unit and native-contract tests.
- Add a manual simulator and physical-device matrix.
- Record reusable guidance in the mobile README.

### Non-goals

- Final visual design or design-system polish.
- Complete accessibility certification.
- Android hardware back-button behavior.
- A JavaScript swipe recognizer or third-party gesture plugin.
- A native `UINavigationController` stack around the SPA.
- Universal links, a new custom scheme, or general-purpose externally registered app routes.
- Mobile OAuth implementation or changes to the existing OAuth-only scheme.
- The vocabulary reverse-input activity.
- Network, API, authentication, synchronization, or TTS behavior.

## Architecture

### Route structure

The diagnostic pages are children of the existing root route so they render inside `MobileLayout`:

```text
/
  /more
  /diagnostics/ios-interactions
  /diagnostics/ios-interactions/detail
```

The module that owns the diagnostic dynamic imports must place the
`() => import('...')` expressions lexically inside a module-level
`import.meta.env.DEV` branch. Vite replaces that value at build time, allowing
the entire branch and its imports to be removed from production output. A pure
route builder receives either the development-only diagnostic records or an
empty array; tests construct both variants without moving the imports outside
the compile-time branch.

More renders the diagnostic entry only in development. A production build has
neither a visible entry nor resolvable diagnostic routes. The main diagnostic
page binds its `data-testid` to a shared
`IOS_INTERACTION_DIAGNOSTICS_MARKER` constant whose exact value is
`ios-interaction-diagnostics`. The page test is the positive control that the
development UI uses that constant; scanner tests prove the same constant is
detected in nested emitted JavaScript and ignored in non-JavaScript assets.

The checked-in `scripts/verify-production-diagnostics.mjs` script scans
`src-capacitor/www/**/*.js` after a production Capacitor asset build and fails
if that token is present. The package command
`verify:production-diagnostics` first runs
`quasar build -m capacitor -T ios --skip-pkg`, which exercises the shipped
Capacitor/hash-router compile surface, and then runs the scanner. Quasar still
runs its default `cap sync ios` preparation before honoring `--skip-pkg`; that
preparation invokes CocoaPods. The real artifact scan is therefore a local
macOS pre-merge gate (or a future macOS-CI gate), not an
`ubuntu-latest` command. The CI-safe controls are the development/production
route-construction tests, the page/marker positive control, and the scanner's
synthetic positive/negative tests. The ordinary SPA `dist` output is not
accepted as production-exclusion evidence for the iOS app.

### File boundaries

The implementation should keep these responsibilities isolated:

- `MobileLayout.vue`: coordinates the optional header, router view,
  keyboard-driven footer visibility, and bottom navigation. Every
  `QRouteTab` uses Quasar's custom-navigation callback to cancel its default
  push and delegate to `mobile-navigation.ts`.
- `safe-area-policy.ts`: records the simulator-selected native content-inset
  mode and whether headerless top ownership belongs to the native scroll view
  or app CSS.
- `ios-interaction-contract.ts`: owns the single canonical diagnostics marker
  imported by the development page and the external artifact scanner.
- `MobilePageHeader.vue`: renders a route title and at least 44-by-44-point back control.
- `JapaneseInputProbe.vue`: owns text input, IME composition state, exact committed/submitted values, and explicit focus dismissal.
- `useKeyboardViewport.ts`: adapts the typed Capacitor Keyboard listener API to
  reactive keyboard visibility and focused-block scrolling. It skips native
  listener registration in browser mode and removes every returned listener
  handle.
- `mobile-navigation.ts`: owns unique push for ordinary links and tab switches,
  replace-on-entry, back-or-fallback, and resume-preservation rules.
- `mobile-route-meta.d.ts`: augments Vue Router's `RouteMeta` with the exact
  optional mobile-header contract.
- `mobile-lifecycle.ts`: exposes app-level lifecycle observations without
  mutating the route.
- `boot/capacitor-lifecycle.ts`: is included only in Capacitor mode, registers
  the typed Capacitor App resume listener once, and forwards observations to
  `mobile-lifecycle.ts`.
- `IosInteractionDiagnosticsPage.vue`: assembles selectable text, scroll stress content, input probe, lifecycle/navigation readouts, and navigation controls.
- `IosInteractionDetailPage.vue`: provides a real nested destination for header-back and native swipe validation.
- `VelaBridgeViewController.swift`: enables the native WKWebView back/forward gesture in `capacitorDidLoad()`.
- `scripts/verify-production-diagnostics.mjs`: scans the production Capacitor
  JavaScript artifact for the canonical diagnostics marker.
- A checked-in manual validation document: records the simulator and physical-device matrix and the reusable rules established by the results.

Names may be adjusted to existing repository naming conventions during planning, but the responsibility boundaries must remain intact.

## Japanese input contract

The probe uses a Quasar `QInput` backed by its native HTML input element. It
must preserve the exact text delivered by the browser and avoid
transformations while composition is active.

The installed Quasar `QInput` owns its native composition handlers and
suppresses `update:model-value` while its internal composing flag is set.
Quasar's flag is heuristic: it is set during `compositionupdate` only after
the event data matches its CJK patterns, rather than immediately on
`compositionstart`. The probe therefore treats Quasar's suppression as a
helpful implementation detail, not its correctness boundary. It does not rely
on `@compositionstart` or `@compositionend` being forwarded by the component.
After mount it reads the public `QInput.nativeEl` reference and registers
native `compositionstart`, `input`, `compositionend`, and `keydown` listeners.
Every listener is removed on unmount.

The bound QInput model and the displayed draft are separate values. The model
continues to receive Quasar's ordinary `update:model-value` events; native
`input` events update the diagnostic draft without writing that in-progress
value back through the model and risking disruption of the active IME session.

### State

The probe exposes three distinct values:

- **Draft**: the current visible input value, including in-progress composition.
- **Committed**: the value observed when composition ends.
- **Submitted**: the exact value accepted by an explicit submission.

It also displays whether composition is active. These values make premature commitment, corruption, trimming, or normalization visible during physical testing.

### Event rules

1. Native `compositionstart` marks composition active.
2. Every native `input` event reads `event.currentTarget.value` and updates the
   draft, including input events delivered while
   composition is active. An implementation must not guard out composing input
   events because WebKit may deliver the final committed value before
   `compositionend`.
3. Enter is handled on native `keydown`, not `keyup`, and does nothing while
   either the tracked flag or `KeyboardEvent.isComposing` is true.
4. Native `compositionend` marks composition inactive and records the exact
   value read from the native element.
5. A later Enter `keydown` or explicit Submit tap records the exact submitted
   value.
6. Submission does not clear the field automatically; the tester must be able to compare all three values.

The reusable guidance is: never validate, normalize, or submit Japanese answer text until composition has ended.

## Keyboard and focus behavior

Add `@capacitor/keyboard` to `src-capacitor/package.json` at the same Capacitor
7 major version as the existing native packages, update
`src-capacitor/bun.lock`, and run:

```bash
# workdir: apps/vela-mobile/src-capacitor
rtk bunx cap sync ios
```

The dependency remains only in `src-capacitor/package.json`, following
Quasar's Capacitor plugin convention. Quasar makes plugins installed there
available to imports from application UI code; the main mobile package must not
duplicate the dependency. Configure:

```json
{
  "plugins": {
    "Keyboard": {
      "resize": "native"
    }
  }
}
```

Quasar's Capacitor-mode Vite aliases and generated TypeScript paths do not
automatically configure the standalone Vitest runner. `vitest.config.ts` must
explicitly resolve `@capacitor/app` and `@capacitor/keyboard` to their packages
under `src-capacitor/node_modules`. Tests mock the typed plugin surface:
`Keyboard.addListener(...)` resolves to a `PluginListenerHandle` whose
`remove()` call can be asserted, and App lifecycle listener registration is
mocked independently. After adding Keyboard, update
`src-capacitor/bun.lock`, run `quasar prepare` so `.quasar/tsconfig.json`
contains its generated path aliases, and then run `bun run typecheck`.

Capacitor documents native resize as resizing the whole native WebView,
including viewport-relative units. `native` is already the Capacitor iOS
default; the explicit value pins that behavior. Its interaction with
`ios.contentInset` is not assumed. The safe-area preflight below decides
whether the existing `"always"` setting remains or `"never"` gives the single,
measurable inset ownership required by this issue.

The keyboard adapter imports the typed `Keyboard` API:

- `keyboardWillShow` marks the keyboard visible immediately, hiding the footer.
- `keyboardDidShow` is the authoritative resize-settled signal. After that
  event, the adapter waits for Vue's next tick and one animation frame before
  scrolling the focused form block.
- `keyboardDidHide` marks the keyboard hidden and restores the footer after the
  resized viewport has settled.

Each `Keyboard.addListener(...)` call returns a `PluginListenerHandle`; all
handles are removed on unmount. Browser mode deliberately skips native
registration and uses standard focus scrolling. A rejected listener
registration on a native build is caught, surfaced by the diagnostic, and
degrades to the same focus-scrolling behavior.

When `keyboardDidShow` fires:

- Identify the currently focused diagnostic form block.
- Wait for Vue's next tick and one animation frame so Quasar can recalculate
  `QHeader`, `QFooter`, `QPage`, and viewport dimensions.
- Scroll the whole input-and-action block into view with a centered or nearest-block strategy.
- Preserve ordinary user scrolling.

While the native keyboard is visible, `MobileLayout` hides the bottom navigation. It restores the navigation after keyboard dismissal. The diagnostic offers:

- A visible Done action that blurs the active control.
- Background-tap dismissal that ignores taps originating from interactive controls.
- A primary Submit action adjacent to the input.

Ordinary browser development must not call the native listener API. It falls
back to standard focus scrolling and leaves native-only status unavailable.

## Safe-area, orientation, and interaction rules

### Safe areas

Quasar already applies `env(safe-area-inset-top)` to the first toolbar in a
standard `QHeader` and `env(safe-area-inset-bottom)` to the final tabs in a
standard `QFooter` when `body.q-ios-padding` is present. Those rules do not add
left or right padding. Four of the five root tab routes are headerless, and the
current shell has never rendered a `QHeader`, so neither the headerless top
inset nor the interaction between Quasar CSS and the existing
`ios.contentInset: "always"` has been established.

Safe-area ownership is therefore an implementation preflight, not a settled
fact. Before the full diagnostic harness is built, compare
`ios.contentInset: "always"` and `"never"` on a notched or Dynamic Island
simulator using:

- the current headerless tab content;
- a temporary standard `QHeader`/`QToolbar` probe;
- the existing standard `QFooter`/`QTabs`;
- the exact candidate CSS for page, toolbar, and footer-tab horizontal insets
  plus CSS headerless-top ownership when testing `"never"`;
- portrait, landscape-left, and landscape-right;
- recorded computed values for all four `env(safe-area-inset-*)` variables;
- screenshots and element bounds for the first page control, header back
  control, and first/last footer tabs.

Choose the policy using these rules:

1. Headerless content has exactly one top inset.
2. Header content and footer content have exactly one top/bottom inset.
3. Header, footer, and page controls remain outside both landscape sensor
   regions.
4. No native scroll inset and CSS inset are visibly doubled.
5. If both modes satisfy the observations, preserve `"always"` to minimize
   native-configuration churn. If neither does, HPA-209 remains blocked and
   the ownership model must be redesigned before the harness proceeds.

The selected mode is written to `capacitor.config.json`, an app-owned
`safe-area-policy.ts` contract, and the checked-in evidence. Subsequent layout
work follows the selected policy:

- With `"always"`, the preflight must have proven that the native scroll view
  owns the headerless top inset without a CSS duplicate.
- With `"never"`, the app-owned layout applies a CSS top inset to the
  headerless `QPageContainer`; Quasar continues to apply the fixed header and
  footer top/bottom CSS insets.
- In either mode, page content, `QToolbar`, and the footer
  `.q-tabs__content` receive explicit left/right `env()` padding. Horizontal
  padding does not overlap Quasar's top/bottom rules.
- The existing web-iOS bottom fallback remains scoped below
  `body:not(.q-ios-padding)`.
- Header, footer, and page backgrounds fill their inset regions.
- Fixed margins are not added to Quasar layout primitives.

### Orientation

The app does not lock orientation. The diagnostic page:

- Uses a constrained readable width in portrait.
- Collapses to a compact, vertically scrollable arrangement in landscape.
- Avoids fixed viewport heights that become unusable after keyboard resize.
- Re-runs focused-block visibility handling when the viewport changes.

Portrait is the primary presentation. Landscape must remain fully operable even if it is not separately polished.

### Interaction baseline

- Buttons and navigation controls have a minimum 44-by-44-point hit area.
- Japanese sample text remains selectable.
- The page scrolls vertically with touch momentum.
- Focus dismissal does not prevent text selection, button activation, or route navigation.
- The primary action remains reachable with the keyboard open in both orientations.

## Navigation and lifecycle policy

### Scroll restoration and swipe continuity

The router preserves history-entry scroll positions:

```ts
scrollBehavior(_to, _from, savedPosition) {
  return savedPosition ?? { left: 0, top: 0 };
}
```

New pushes and replacements start at the top. Browser, header, and native
back/forward traversal restore Vue Router's `savedPosition`. Physical swipe
validation is functional rather than aesthetic. A WebKit-provided snapshot,
cross-fade, or temporarily stale transition image is acceptable while the
gesture is active if the correct live destination and saved position appear
when it completes. A blank or white intermediate frame, wrong final route,
unexpected app exit, or trapped state is not accepted.

### Ordinary in-app navigation

Before pushing, resolve the target and compare its `fullPath` with the current
route. Every mobile-owned route transition, including all five bottom tabs,
uses `mobile-navigation.ts` and writes an app-owned `mobileDepth` number to the
Vue Router history state:

- Different target: `router.push` with `mobileDepth` incremented from the
  current entry, treating a missing or invalid depth as zero.
- Same target: no operation.

This makes repeated taps explicitly idempotent even though Vue Router also
reports duplicated navigation. The app does not depend on Vue Router's internal
`back` field or on `window.history.length`.

`QRouteTab` remains responsible for route-aware active styling. Quasar emits
its `click` event with `(event, go)`, then calls `go()` unless
`event.defaultPrevented` is already true. The app handler must call
`event.preventDefault()` synchronously and deliberately not call `go()`;
instead it calls the app-owned helper. Skipping `go()` also skips Quasar's
immediate `$tabs.updateModel()`/`avoidRouteWatcher` path, so active styling
depends on QTabs' route watcher and is covered by an explicit
`q-tab--active` test after helper-driven navigation.

M1 deliberately uses one chronological WKWebView history rather than
independent per-tab stacks. If the user opens More, Diagnostics, and Detail,
then taps Home, a native back swipe from Home returns to Detail because Detail
was the previously visible route. That behavior is intentional, carries a
defined `mobileDepth`, and is verified physically. Merely adding `replace` or
resetting the numeric depth would not remove older entries from WKWebView
history and is therefore not used as a false stack-reset mechanism.

This is not declared a permanent product policy. M1 chooses chronological
history because it makes every WKWebView entry observable during the spike.
The physical matrix includes twenty alternating tab switches followed by
repeated swipe-back traversal. M2 must revisit whether a bounded or
tab-specific policy better matches product expectations after that evidence is
available.

### Route-entry behavior

A route-entry event represents a future recognized deep link or a diagnostic simulation:

- Resolve and validate the target against mobile-owned routes.
- Reject unknown or disallowed targets.
- If the target equals the current `fullPath`, do nothing.
- Otherwise use `router.replace` with `mobileDepth: 0`, so an external entry
  does not add an artificial app-owned page behind the destination.

HPA-209 does not register a new external URL. The existing custom scheme remains reserved for OAuth callback/logout paths. Future universal-link or app-scheme work can call the route-entry function after it authenticates and validates its URL.

For physical cold-entry validation, development builds expose a **Stage cold
entry** action. It writes one validated diagnostic target to a dedicated
local-storage key and instructs the tester to terminate and relaunch the app.
Development boot performs these steps in order:

1. Read the staged raw value and immediately delete the key.
2. Resolve and validate the value against the exact allowlist of the two
   diagnostic paths.
3. Ignore an absent, invalid, or disallowed value.
4. Directly `await router.replace(...)` with `mobileDepth: 0`.

Quasar executes boot functions before it installs Vue Router into the app, so
the consumer must not await `router.isReady()`; that promise represents the
initial navigation triggered by router installation. The pre-install
`router.replace` establishes the intended initial route before the app mounts.
The key and its consumer are both excluded from production builds. Invalid
values are deleted and ignored.

### App resume

An app resume event preserves the current route and history. It must not push
or replace a route merely because the app became active. A separately received,
recognized route-entry event is processed synchronously and its pending
reference is cleared immediately after success, rejection, or failure. The
development cold-entry key is deleted before navigation begins, so a failed
navigation also cannot replay on resume. Re-delivery while already at the same
`fullPath` is a no-op; a later, newly delivered event after the user has
navigated elsewhere is handled as a new entry.

`boot/capacitor-lifecycle.ts` is conditionally included only for Capacitor
builds and registers the typed `App.addListener('resume', ...)` listener once
for the app lifetime. Its callback records the event through
`mobile-lifecycle.ts` and does not navigate. The browser diagnostic can invoke
the same lifecycle observation boundary for simulation without importing or
calling the native plugin. The diagnostic displays recorded resume events and
can simulate repeated entry so route stability is visible and unit-testable.

### Header route metadata

The optional header uses one typed route-meta contract:

```ts
import type { RouteLocationRaw } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    mobileHeader?: {
      title: string;
      fallback: RouteLocationRaw;
    };
  }
}
```

`MobileLayout`, `MobilePageHeader`, and the back helper read this same object.
The diagnostic root declares a fallback to More; the detail route declares a
fallback to the diagnostic root. Root tab routes omit `mobileHeader`.

### Back behavior

Each header-enabled route declares a fallback:

```text
detail diagnostic -> diagnostic root
diagnostic root   -> More
```

The header back action reads only the app-owned `mobileDepth`:

1. Uses `router.back()` when `mobileDepth` is a positive integer.
2. Otherwise replaces with the declared fallback and `mobileDepth: 0`.
3. Never calls a native app-exit API.
4. Does not create a fallback loop when tapped repeatedly.

Vue Router restores the custom history state when back/forward navigation
changes entries, so the depth follows native WebView history. The root tab pages
do not show a redundant header back action. Any future header-enabled route must
enter through the mobile navigation helper so its depth is defined.

## Native swipe-back integration

Apple exposes `WKWebView.allowsBackForwardNavigationGestures`, which defaults to `false`. Capacitor's `CAPBridgeViewController` provides `capacitorDidLoad()` after its `webView` and bridge have been assigned.

Add an app-owned subclass:

```swift
import Capacitor

final class VelaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
```

Xcode resolves the current application target's `PRODUCT_MODULE_NAME` to
`App`. The storyboard root scene changes from Capacitor's base controller to:

```xml
<viewController
  id="BYZ-38-t0r"
  customClass="VelaBridgeViewController"
  customModule="App"
  customModuleProvider="target"
  sceneMemberID="viewController"
/>
```

The Swift file must be included in the application target.

The gesture operates on the same WKWebView session history used by Vue Router hash mode. No JavaScript edge-pan recognizer, community plugin, or parallel native navigation stack is added.

A cold route entry uses `router.replace` at `mobileDepth: 0` and therefore
creates no app-owned back destination. The staged cold-entry action plus
terminate-and-relaunch flow creates the required fresh WebView session. Native
swipe-back is intentionally a no-op and the visible header uses its fallback.
Because `replace` cannot erase entries from an already-running WebView session,
an ordinary in-session route-entry simulation is not accepted as cold-entry
evidence. Existing-session entry remains covered by the general physical
history-consistency checks and is a blocker if native swipe escapes the
app-owned route policy.

After a pushed detail route returns through `router.back()`, native
swipe-forward must restore the detail route and its `mobileDepth`. This confirms
that visible controls and WebKit gestures share one coherent history.

Physical validation is authoritative. If native swipe:

- skips routes,
- duplicates routes,
- navigates forward unexpectedly,
- closes the app,
- leaves the visible route inconsistent with Vue Router, or
- traps the user at a blank page,

HPA-209 remains blocked until the native-history integration is corrected or the product requirement is revisited. The implementation must not hide a failure behind a custom swipe imitation.

Exact native animation fidelity is not an acceptance criterion. The live
HPA-209 requirement is predictable back behavior without closing or trapping
the app; a native snapshot or cross-fade is acceptable under the functional
completion rule above.

## Diagnostic journey

The main page contains:

- A clear internal-diagnostics label.
- Selectable kana, kanji, and mixed Japanese sample text.
- Scroll stress content above and below the form.
- The Japanese input probe near the lower half of the content.
- Keyboard visibility and orientation readouts.
- Current route and last navigation outcome.
- Controls to simulate unique push, repeated push, route entry, repeated route entry, and resume.
- A development-only control that stages a one-shot cold-entry target for the
  next app launch.
- A button to navigate to the detail route.
- Concise instructions for the required Japanese IME scenario.
- The unique production-exclusion marker
  `data-testid="ios-interaction-diagnostics"`.

The detail page contains:

- A metadata-driven header and back control.
- Enough content to confirm page identity after transitions.
- A control that attempts repeated navigation to the current detail route.
- Instructions to test both the visible back button and the native left-edge swipe.

The diagnostic does not send input or device information to a backend.

## Failure handling

- Browser mode skips native Keyboard registration and remains usable through
  focus scrolling.
- Native Keyboard listener rejection leaves the page usable and displays the
  unavailable native status in development.
- All returned Capacitor listener handles are removed when their owner
  unmounts.
- Unknown route-entry targets are rejected without changing the current route.
- Duplicate navigation is a successful no-op, not a notification-worthy error.
- Unexpected Vue Router failures are surfaced in the diagnostic readout and logged.
- Back without history uses the declared fallback.
- Native swipe/history failures are recorded as physical-device blockers.
- Device-matrix failures include reproduction steps rather than being silently marked unsupported.

## Automated verification

### Component and composable tests

- Composition start updates composing state.
- Input during composition updates draft only.
- Native QInput listeners are attached through `nativeEl` and removed on
  unmount.
- The in-progress draft is not written back through the QInput model.
- Enter `keydown` during composition does not submit when either composition
  guard is active.
- Composition end records the exact committed value.
- Enter `keydown` after composition submits the exact value.
- Submit button submits the exact value.
- Done and safe background taps dismiss focus.
- Interactive background taps are not intercepted.
- Keyboard show hides the footer and scrolls the form block after layout settles.
- Keyboard hide restores the footer without duplicated bottom-safe-area
  padding or an unreachable Submit action.
- Keyboard listener handles are removed on unmount.
- Vitest resolves and mocks both `@capacitor/app` and
  `@capacitor/keyboard` from `src-capacitor/node_modules`.
- Browser fallback does not require a native plugin.
- `keyboardDidShow`, rather than a timer, initiates settled-viewport scrolling.
- Quasar layout elements recalculate after simulated viewport resize.
- New navigation scrolls to the top while popstate navigation returns
  `savedPosition`.
- Header title, back control, and fallback follow the typed route metadata.
- Safe-area content classes and minimum target classes are present.
- `IosInteractionDiagnosticsPage` tests cover every control, readout,
  lifecycle/navigation outcome, cold-entry staging, marker binding, and IME
  probe integration.
- `IosInteractionDetailPage` tests cover route identity and repeated
  current-route navigation.
- The full mobile suite passes the configured 95% line threshold with
  `bun run test:coverage`; diagnostic pages are covered rather than excluded.

### Navigation tests

- Unique internal navigation pushes once.
- Unique internal navigation increments `mobileDepth`.
- Every bottom-tab switch delegates to the navigation helper, pushes once, and
  increments `mobileDepth`.
- After helper-driven tab navigation, QTabs' route watcher applies
  `q-tab--active` to the destination tab even though the handler canceled
  Quasar's `go()` callback.
- Repeated current-route navigation is a no-op and leaves `mobileDepth`
  unchanged, including Detail to the same Detail route.
- After Detail to Home through a tab, simulated back traversal returns to
  Detail with its original `mobileDepth`.
- Route entry replaces rather than pushes and resets `mobileDepth` to zero.
- Repeated route entry is a no-op.
- Resume preserves the current route.
- Capacitor resume registration records one lifecycle event and performs no
  navigation.
- Resume does not replay an already consumed route-entry event.
- A staged development cold-entry target is deleted before it is applied and
  cannot replay after success or failure.
- The staged cold-entry consumer replaces the route during Quasar boot without
  awaiting `router.isReady()`.
- Invalid staged cold-entry values are deleted without navigation.
- Back uses existing history only when `mobileDepth` is positive.
- Back without history replaces with the fallback.
- Back and forward restore the depth attached to their history entries.
- Unknown entry targets do not navigate.
- Development route construction includes the diagnostic journey.
- Production route construction excludes the diagnostic journey.
- The shared diagnostics marker is present on the development page.
- Scanner tests use the repository's existing
  `scripts/**/*.{test,spec}.{mts,mjs}` Vitest convention and prove a nested
  JavaScript positive match, a clean negative result, and non-JavaScript
  exclusion.
- On macOS, the production-exclusion command builds Capacitor iOS assets with
  `--skip-pkg`, scans `src-capacitor/www/**/*.js` for the shared token, and
  fails if it is present.

### Native contract tests

Repository tests read the committed native/configuration files and assert:

- `@capacitor/keyboard` uses the Capacitor 7 major.
- Keyboard resize mode is `native`.
- `VelaBridgeViewController` subclasses `CAPBridgeViewController`.
- `capacitorDidLoad()` enables `allowsBackForwardNavigationGestures`.
- The storyboard root controller uses
  `customClass="VelaBridgeViewController"`, `customModule="App"`, and
  `customModuleProvider="target"`.
- `VelaBridgeViewController.swift` has a `PBXFileReference`, a `PBXBuildFile`,
  and membership in the application target's Sources build phase in
  `project.pbxproj`.

### Validation commands

At implementation completion, run:

```bash
# workdir: apps/vela-mobile
rtk bun run test:unit
rtk bun run test:coverage
rtk bun run lint
rtk bun run typecheck
rtk env VITE_MOBILE_API_URL=https://example.invalid/api/ bun run build
```

On macOS, also run:

```bash
# workdir: apps/vela-mobile
rtk env VITE_MOBILE_API_URL=https://example.invalid/api/ bun run verify:production-diagnostics
# workdir: apps/vela-mobile/src-capacitor
rtk bunx cap sync ios
```

`verify:production-diagnostics` runs the production Capacitor asset build,
including Quasar's `cap sync ios` preparation, and scans the resulting
`src-capacitor/www` JavaScript. It requires CocoaPods and the same valid
production mobile API environment as other production mobile builds. The
exact command, host platform, build configuration, and any signing constraints
are recorded with the evidence.

## Manual device matrix

The checked-in evidence document records exact models and versions used at validation time.

| Environment | Required coverage |
| --- | --- |
| Notched or Dynamic Island iPhone Simulator safe-area preflight | Compare `contentInset` modes with headerless content, an injected standard header, fixed footer, computed four-edge `env()` values, and both landscape directions before full harness work |
| Small-screen iPhone Simulator, portrait | Keyboard-open layout, scrolling, focus/action visibility, footer hide/restore without double padding, tap targets, route controls |
| Small-screen iPhone Simulator, landscape | Keyboard-open compact-height stress case; focused field and primary action remain reachable without dismissing the keyboard |
| Dynamic Island iPhone Simulator | Top/bottom/side safe areas, rotation while the keyboard is open, keyboard resize, nested back history |
| Physical iPhone, Debug development build | Japanese IME composition, candidate commitment, exact submission, keyboard visibility/dismissal, selection, background/resume, header back, repeated tab-switch history, native edge swipe, and functionally correct swipe completion |
| Simulator or physical iPhone, Release smoke build | Core Home/More shell launch, rotation, safe-area control bounds, and footer behavior with diagnostics absent; diagnostic-specific Release evidence remains indirect through the artifact scan |

Each row records:

- Device model.
- iOS version.
- Xcode version.
- Japanese keyboard layout used.
- Git commit/build identifier.
- Build configuration (`Debug development`, `Release smoke`, or production
  Capacitor asset scan).
- Whether the app used the LAN development server or packaged WebView assets.
- Orientation.
- Pass/fail result for each scenario.
- Reproduction notes and linked follow-up issue for failures.

### Required Japanese IME scenario

1. Focus the diagnostic field.
2. Enter a reading such as `にほんご`.
3. Select the kanji candidate `日本語`.
4. Use Return while the candidate/composition is active.
5. Confirm that no submission occurred prematurely.
6. Finish composition.
7. Press Return again or tap Submit.
8. Confirm draft, committed, and submitted values remain exactly `日本語`.

### Required keyboard and orientation scenario

1. In portrait, focus the Japanese input and keep the keyboard open.
2. Confirm the complete input-and-Submit block remains reachable and the
   bottom tabs are hidden.
3. Rotate directly to landscape without dismissing the keyboard.
4. Confirm the focused block is scrolled back into view after the resized
   viewport settles and Submit remains reachable.
5. Dismiss the keyboard and confirm the footer returns once with one bottom
   safe-area inset and no stale gap or double padding.
6. Rotate back to portrait and confirm the layout remains operable.

### Required navigation scenario

1. Open More.
2. Open iOS Interaction Diagnostics.
3. Navigate to the detail route.
4. Use the visible back control.
5. Re-enter detail.
6. Use the native left-edge swipe.
7. After a back traversal, use native swipe-forward and confirm detail is
   restored.
8. From Detail, tap the Home bottom tab.
9. Use native swipe-back and confirm the exact Detail page and its original
   depth return. Record whether WebKit uses a live view, snapshot, or
   cross-fade; those are acceptable, but a blank or white frame is not.
10. Use native swipe-forward and confirm Home is restored.
11. Repeat navigation to the current route and confirm its depth does not
    change.
12. Background and resume the app.
13. Simulate route entry to detail twice.
14. Stage the detail route as the next cold-entry target, terminate the app,
    relaunch it, and confirm the target is consumed once.
15. Confirm native swipe-back is a no-op from that fresh detail entry while
    header back uses its fallback.
16. Alternate Home and Review twenty times, then traverse backward repeatedly
    and record whether chronological tab history remains usable or feels
    product-hostile.
17. Confirm that the app remains on one predictable route with no duplicated
    pages, blank content, exit, or trap.

The diagnostic matrix necessarily uses a Debug development build because the
routes are development-only. Physical-iPhone Debug evidence is a release gate
for this issue. It is not represented as production-build evidence; Release
confidence comes from the marker scan plus the separate core-shell smoke row.

## Reusable guidance produced by HPA-209

The mobile README and device evidence will record these conventions:

- Do not submit or normalize Japanese input during IME composition.
- Use Capacitor native keyboard resize and scroll the focused form block after resize settles.
- Hide bottom navigation while the native keyboard is visible.
- Choose native-scroll versus CSS headerless-top ownership from measured
  simulator evidence; do not assume `contentInset` compatibility.
- Use standard Quasar header/footer structures for top/bottom CSS ownership and
  add explicit left/right safe-area padding to page, toolbar, and tab content.
- Keep interactive targets at least 44 by 44 points.
- Route ordinary links and bottom tabs through one unique-push helper; M1 uses
  chronological history rather than independent tab stacks.
- Use replace for validated external entry.
- Restore saved scroll positions for back/forward navigation.
- Register resume observation at the app boundary; resume preserves route
  state unless a new entry event is consumed.
- Header back always has a route fallback.
- For ordinary pushed navigation, native swipe and visible back controls
  traverse the same WKWebView/Vue Router history. After a validated
  replace-on-entry at depth zero, header fallback may intentionally differ
  from any older native session entry.
- Treat physical-device IME and swipe results as authoritative.

## Acceptance criteria mapping

| HPA-209 criterion | Design evidence |
| --- | --- |
| Japanese IME composition and submission do not corrupt or prematurely commit text | Explicit composition state machine, exact value readouts, automated event tests, and required physical scenario |
| Focused inputs remain visible with the keyboard | Native WebView resize, focused-block scrolling, hidden footer, portrait/landscape matrix |
| Content and navigation respect safe areas | Preflight-selected native/CSS ownership, standard Quasar top/bottom handling, explicit page/header/footer side padding, and simulator matrix |
| Back controls and swipe-back produce predictable history | Unique navigation policy for ordinary links and tabs, saved-position restoration, back fallbacks, app-owned bridge controller, storyboard module contract, and physical route sequence |
| Portrait works and landscape is handled intentionally | Both orientations remain functional; landscape is a required compact-height test |
| Findings produce reusable guidance | Isolated components/policies, README conventions, and checked-in device evidence |

## Primary references

- [Capacitor 7 Keyboard API](https://capacitorjs.com/docs/v7/apis/keyboard)
- [Capacitor 7 App API](https://capacitorjs.com/docs/v7/apis/app)
- [Quasar Capacitor build commands](https://quasar.dev/quasar-cli-vite/developing-capacitor-apps/build-commands/)
- [Quasar boot files](https://quasar.dev/quasar-cli-vite/boot-files/)
- [Quasar Layout](https://quasar.dev/layout/layout/)
- [Quasar tabs and custom route navigation](https://quasar.dev/vue-components/tabs/)
- [Vue Router scroll behavior](https://router.vuejs.org/guide/advanced/scroll-behavior)
- [Vue Router navigation failures](https://router.vuejs.org/guide/advanced/navigation-failures.html)
- [WKWebView `allowsBackForwardNavigationGestures`](https://developer.apple.com/documentation/webkit/wkwebview/allowsbackforwardnavigationgestures)
