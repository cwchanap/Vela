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

The pre-design baseline is clean: 12 Vitest files and 104 tests pass on `main`.

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
| Keyboard resize | Capacitor Keyboard `native` resize | Resizes the whole WebView and keeps Quasar viewport calculations aligned with the visible iOS viewport |
| Bottom navigation with keyboard | Hidden while the native keyboard is visible | Preserves compact-height space for the focused field and primary action |
| Production impact | Reusable shell, keyboard, and native navigation behavior ship; diagnostic pages do not | Later mobile pages need the baseline behavior, but users do not need the probe UI |

## Scope

### In scope

- Add a development-only diagnostic entry on More.
- Add a two-route diagnostic journey inside `MobileLayout`.
- Add an optional metadata-driven mobile header with a predictable back action.
- Add a Japanese-capable input probe with explicit composition handling.
- Make the input and primary action recoverably visible when the iOS keyboard appears.
- Add explicit Capacitor Keyboard configuration and lifecycle handling.
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

The module that owns the diagnostic dynamic imports must place them behind a module-level `import.meta.env.DEV` branch. Vite replaces that value at build time, allowing the entire branch and its imports to be removed from production output. A pure route builder receives either the development-only diagnostic records or an empty array; tests construct both variants without moving the imports outside the compile-time branch.

More renders the diagnostic entry only in development. A production build has neither a visible entry nor resolvable diagnostic routes, and build verification confirms that it emits no diagnostic page chunk.

### File boundaries

The implementation should keep these responsibilities isolated:

- `MobileLayout.vue`: coordinates the optional header, router view, keyboard-driven footer visibility, and bottom navigation.
- `MobilePageHeader.vue`: renders a route title and at least 44-by-44-point back control.
- `JapaneseInputProbe.vue`: owns text input, IME composition state, exact committed/submitted values, and explicit focus dismissal.
- `useKeyboardViewport.ts`: adapts the Keyboard plugin's window lifecycle events to reactive keyboard visibility and focused-block scrolling. It provides a browser-safe fallback and cleans up listeners.
- `mobile-navigation.ts`: owns unique push, replace-on-entry, back-or-fallback, and resume-preservation rules.
- `IosInteractionDiagnosticsPage.vue`: assembles selectable text, scroll stress content, input probe, lifecycle/navigation readouts, and navigation controls.
- `IosInteractionDetailPage.vue`: provides a real nested destination for header-back and native swipe validation.
- `VelaBridgeViewController.swift`: enables the native WKWebView back/forward gesture in `capacitorDidLoad()`.
- A checked-in manual validation document: records the simulator and physical-device matrix and the reusable rules established by the results.

Names may be adjusted to existing repository naming conventions during planning, but the responsibility boundaries must remain intact.

## Japanese input contract

The probe uses a Quasar text input backed by the native HTML input element. It must preserve the exact text delivered by the browser and avoid transformations while composition is active.

### State

The probe exposes three distinct values:

- **Draft**: the current visible input value, including in-progress composition.
- **Committed**: the value observed when composition ends.
- **Submitted**: the exact value accepted by an explicit submission.

It also displays whether composition is active. These values make premature commitment, corruption, trimming, or normalization visible during physical testing.

### Event rules

1. `compositionstart` marks composition active.
2. Input events update the draft but do not submit, trim, or normalize it.
3. Enter does nothing while either the tracked flag or `KeyboardEvent.isComposing` is true.
4. `compositionend` marks composition inactive and records the exact committed value.
5. A later Enter press or explicit Submit tap records the exact submitted value.
6. Submission does not clear the field automatically; the tester must be able to compare all three values.

The reusable guidance is: never validate, normalize, or submit Japanese answer text until composition has ended.

## Keyboard and focus behavior

Add `@capacitor/keyboard` to `src-capacitor/package.json` at the same Capacitor 7 major version as the existing native packages, update its lockfile, and synchronize the native project. Configure:

```json
{
  "plugins": {
    "Keyboard": {
      "resize": "native"
    }
  }
}
```

Capacitor documents native resize as resizing the whole native WebView, including viewport-relative units. It also exposes its show and hide lifecycle events through `window` for compatibility. The keyboard adapter uses those window events rather than importing a native package into the main Quasar workspace, preserving the repository's existing `src-capacitor` dependency boundary. It exposes a reactive visibility value and removes the same window listeners on unmount.

When the keyboard finishes appearing:

- Identify the currently focused diagnostic form block.
- Wait for Vue and the resized WebView to settle.
- Scroll the whole input-and-action block into view with a centered or nearest-block strategy.
- Preserve ordinary user scrolling.

While the native keyboard is visible, `MobileLayout` hides the bottom navigation. It restores the navigation after keyboard dismissal. The diagnostic offers:

- A visible Done action that blurs the active control.
- Background-tap dismissal that ignores taps originating from interactive controls.
- A primary Submit action adjacent to the input.

If the native Keyboard plugin is unavailable in ordinary browser development, the adapter must not throw. It falls back to standard focus scrolling and leaves native-only status unavailable.

## Safe-area, orientation, and interaction rules

### Safe areas

Quasar already applies `env(safe-area-inset-top)` to the first toolbar in a standard `QHeader` and `env(safe-area-inset-bottom)` to the final tabs in a standard `QFooter` when `body.q-ios-padding` is present. The mobile shell will:

- Use those standard Quasar header/footer structures on native iOS.
- Retain a web-iOS fallback without double-applying native padding.
- Define reusable content padding for left and right safe-area insets.
- Ensure header, footer, and page backgrounds fill their inset regions.
- Avoid fixed margins on Quasar layout primitives.

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

### Ordinary in-app navigation

Before pushing, resolve the target and compare its `fullPath` with the current route:

- Different target: `router.push`.
- Same target: no operation.

This makes repeated taps explicitly idempotent even though Vue Router also reports duplicated navigation.

### Route-entry behavior

A route-entry event represents a future recognized deep link or a diagnostic simulation:

- Resolve and validate the target against mobile-owned routes.
- Reject unknown or disallowed targets.
- If the target equals the current `fullPath`, do nothing.
- Otherwise use `router.replace`, so an external entry does not add an artificial page behind the destination.

HPA-209 does not register a new external URL. The existing custom scheme remains reserved for OAuth callback/logout paths. Future universal-link or app-scheme work can call the route-entry function after it authenticates and validates its URL.

### App resume

An app resume event preserves the current route and history. It must not push or replace a route merely because the app became active. If a separately received, recognized route-entry event exists, that event is consumed once through the replace-on-entry policy.

The diagnostic records resume events and can simulate repeated entry so route stability is visible and unit-testable.

### Back behavior

Each header-enabled route declares a fallback:

```text
detail diagnostic -> diagnostic root
diagnostic root   -> More
```

The header back action:

1. Uses `router.back()` when Vue Router history contains a back entry.
2. Otherwise replaces with the declared fallback.
3. Never calls a native app-exit API.
4. Does not create a fallback loop when tapped repeatedly.

The root tab pages do not show a redundant header back action.

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

The storyboard root scene changes from Capacitor's base controller to the app-owned subclass. The Swift file must be included in the application target.

The gesture operates on the same WKWebView session history used by Vue Router hash mode. No JavaScript edge-pan recognizer, community plugin, or parallel native navigation stack is added.

Physical validation is authoritative. If native swipe:

- skips routes,
- duplicates routes,
- navigates forward unexpectedly,
- closes the app,
- leaves the visible route inconsistent with Vue Router, or
- traps the user at a blank page,

HPA-209 remains blocked until the native-history integration is corrected or the product requirement is revisited. The implementation must not hide a failure behind a custom swipe imitation.

## Diagnostic journey

The main page contains:

- A clear internal-diagnostics label.
- Selectable kana, kanji, and mixed Japanese sample text.
- Scroll stress content above and below the form.
- The Japanese input probe near the lower half of the content.
- Keyboard visibility and orientation readouts.
- Current route and last navigation outcome.
- Controls to simulate unique push, repeated push, route entry, repeated route entry, and resume.
- A button to navigate to the detail route.
- Concise instructions for the required Japanese IME scenario.

The detail page contains:

- A metadata-driven header and back control.
- Enough content to confirm page identity after transitions.
- A control that attempts repeated navigation to the current detail route.
- Instructions to test both the visible back button and the native left-edge swipe.

The diagnostic does not send input or device information to a backend.

## Failure handling

- Keyboard listener setup failure leaves the page usable and displays the unavailable native status in development.
- All registered Capacitor listeners are removed when their owner unmounts.
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
- Enter during composition does not submit.
- Composition end records the exact committed value.
- Enter after composition submits the exact value.
- Submit button submits the exact value.
- Done and safe background taps dismiss focus.
- Interactive background taps are not intercepted.
- Keyboard show hides the footer and scrolls the form block after layout settles.
- Keyboard hide restores the footer.
- Keyboard listener handles are removed on unmount.
- Browser fallback does not require a native plugin.
- Header title and back control follow route metadata.
- Safe-area content classes and minimum target classes are present.

### Navigation tests

- Unique internal navigation pushes once.
- Repeated current-route navigation is a no-op.
- Route entry replaces rather than pushes.
- Repeated route entry is a no-op.
- Resume preserves the current route.
- Back uses existing history.
- Back without history replaces with the fallback.
- Unknown entry targets do not navigate.
- Development route construction includes the diagnostic journey.
- Production route construction excludes the diagnostic journey.
- The production build emits no diagnostic page chunk.

### Native contract tests

Repository tests read the committed native/configuration files and assert:

- `@capacitor/keyboard` uses the Capacitor 7 major.
- Keyboard resize mode is `native`.
- `VelaBridgeViewController` subclasses `CAPBridgeViewController`.
- `capacitorDidLoad()` enables `allowsBackForwardNavigationGestures`.
- The storyboard root controller uses the app-owned class.
- The Swift file belongs to the application target.

### Validation commands

At implementation completion, run:

```bash
cd apps/vela-mobile
bun run test:unit
bun run lint
bun run typecheck
bun run build
```

Then run the Capacitor synchronization/build workflow needed for simulator and device validation. The exact command and any signing constraints must be recorded with the evidence.

## Manual device matrix

The checked-in evidence document records exact models and versions used at validation time.

| Environment | Required coverage |
| --- | --- |
| Small-screen iPhone Simulator | Portrait and landscape layout, scrolling, focus visibility, safe areas, tap targets, route controls |
| Dynamic Island iPhone Simulator | Top/bottom/side safe areas, rotation, keyboard resize, nested back history |
| Physical iPhone | Japanese IME composition, candidate commitment, exact submission, keyboard visibility/dismissal, selection, background/resume, header back, native edge swipe |

Each row records:

- Device model.
- iOS version.
- Xcode version.
- Japanese keyboard layout used.
- Git commit/build identifier.
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

### Required navigation scenario

1. Open More.
2. Open iOS Interaction Diagnostics.
3. Navigate to the detail route.
4. Use the visible back control.
5. Re-enter detail.
6. Use the native left-edge swipe.
7. Repeat navigation to the current route.
8. Background and resume the app.
9. Simulate route entry to detail twice.
10. Confirm that the app remains on one predictable route with no duplicated pages, blank content, exit, or trap.

Physical-iPhone evidence is a release gate for this issue.

## Reusable guidance produced by HPA-209

The mobile README and device evidence will record these conventions:

- Do not submit or normalize Japanese input during IME composition.
- Use Capacitor native keyboard resize and scroll the focused form block after resize settles.
- Hide bottom navigation while the native keyboard is visible.
- Use standard Quasar header/footer structures so native safe-area padding is applied once.
- Apply left/right safe-area padding to page content for landscape.
- Keep interactive targets at least 44 by 44 points.
- Use unique push for in-app navigation and replace for validated external entry.
- Resume preserves route state unless a new entry event is consumed.
- Header back always has a route fallback.
- Native swipe and visible back controls share one WKWebView/Vue Router history.
- Treat physical-device IME and swipe results as authoritative.

## Acceptance criteria mapping

| HPA-209 criterion | Design evidence |
| --- | --- |
| Japanese IME composition and submission do not corrupt or prematurely commit text | Explicit composition state machine, exact value readouts, automated event tests, and required physical scenario |
| Focused inputs remain visible with the keyboard | Native WebView resize, focused-block scrolling, hidden footer, portrait/landscape matrix |
| Content and navigation respect safe areas | Standard Quasar header/footer handling, web fallback, side-inset content padding, simulator matrix |
| Back controls and swipe-back produce predictable history | Unique navigation policy, back fallbacks, app-owned bridge controller, physical route sequence |
| Portrait works and landscape is handled intentionally | Both orientations remain functional; landscape is a required compact-height test |
| Findings produce reusable guidance | Isolated components/policies, README conventions, and checked-in device evidence |

## Primary references

- [Capacitor 7 Keyboard API](https://capacitorjs.com/docs/v7/apis/keyboard)
- [Capacitor 7 App API](https://capacitorjs.com/docs/v7/apis/app)
- [Quasar Layout](https://quasar.dev/layout/layout/)
- [Vue Router navigation failures](https://router.vuejs.org/guide/advanced/navigation-failures.html)
- [WKWebView `allowsBackForwardNavigationGestures`](https://developer.apple.com/documentation/webkit/wkwebview/allowsbackforwardnavigationgestures)
