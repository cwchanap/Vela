# Mobile iOS Interaction Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and physically verify the HPA-209 diagnostic journey and reusable iOS shell contracts for Japanese IME input, keyboard resizing, safe areas, lifecycle, and native WKWebView history.

**Architecture:** Begin with a simulator safe-area preflight that selects native-scroll or CSS headerless-top ownership before the full harness is built. Keep the diagnostic UI development-only while shipping the selected safe-area policy plus reusable keyboard, layout, lifecycle, and navigation policies. Vue Router owns one chronological hash-history stack with app-owned `mobileDepth`; Capacitor supplies typed Keyboard and App events; an app-owned `CAPBridgeViewController` enables native back/forward gestures. Automated tests cover browser-observable and committed-native contracts, while simulator and physical-iPhone evidence remain the authority for safe areas, IME, and interactive swipe behavior.

**Tech Stack:** Vue 3, Quasar 2, Vue Router 4, Capacitor 7, TypeScript 5.6, Vitest 3, Swift 5, Xcode 16+

## Global Constraints

- Work from an isolated worktree created with `superpowers:using-git-worktrees` before changing product code.
- Keep `@capacitor/keyboard` on Capacitor major 7 and install it only under `apps/vela-mobile/src-capacitor`.
- Complete Task 0 before the full harness. Preserve `ios.contentInset: "always"`
  only if it wins the recorded single-inset preflight; otherwise select
  `"never"` and app-owned CSS headerless-top ownership.
- Explicitly pin Keyboard resize as `"native"` even though it is already the
  Capacitor iOS default.
- Keep the diagnostic entry, routes, pages, cold-entry key, and marker out of production bundles.
- Use the exact production-exclusion token `ios-interaction-diagnostics`.
- Verify production exclusion against
  `apps/vela-mobile/src-capacitor/www/**/*.js`, not the SPA `dist` directory;
  the real build-and-scan command is a local macOS pre-merge gate because
  Quasar runs `cap sync ios` before honoring `--skip-pkg`.
- Route ordinary links and all five bottom tabs through one unique-push helper with app-owned `mobileDepth`.
- M1 uses chronological browser history; it does not emulate independent
  native tab stacks. Treat this as a revisitable M1 spike policy, not a
  permanent product commitment.
- Use unique push for validated in-session route entry. Use
  `router.replace` with `mobileDepth: 0` only for validated cold entry before
  router installation and header fallbacks.
- Never use `window.history.length` or Vue Router's internal `back` state as an app-history predicate.
- Never await `router.isReady()` from the development cold-entry boot file.
- Handle submission on native `keydown` and block it while either tracked composition state or `KeyboardEvent.isComposing` is true.
- Do not write in-progress native IME input back through the QInput model.
- Use the Task 0 policy for headerless top ownership. Quasar owns fixed
  header/footer top/bottom CSS insets, while page, toolbar, and footer-tab
  content own left/right insets.
- Do not add a JavaScript swipe recognizer, third-party gesture plugin, native navigation controller, universal link, or new custom scheme.
- Resume observation never navigates unless a separately validated route-entry event is consumed.
- HPA-209 cannot be marked complete without physical-iPhone IME and native-swipe evidence.
- Production mobile builds require a valid absolute HTTPS `VITE_MOBILE_API_URL`.

---

## File Map

### Create

- `apps/vela-mobile/src/ios/safe-area-policy.ts` — simulator-selected native
  content-inset and headerless-top ownership.
- `apps/vela-mobile/src/ios/safe-area-policy.test.ts` — policy/config
  consistency contract.
- `apps/vela-mobile/src/diagnostics/ios-interaction-contract.ts` — single
  canonical production-exclusion marker.
- `apps/vela-mobile/docs/evidence/hpa-209/` — twelve safe-area preflight
  screenshots using the exact mode/state/orientation naming below.
- `apps/vela-mobile/src/ios/capacitor-plugins.test.ts` — dependency, config, and Vitest-resolution contracts.
- `apps/vela-mobile/src/router/mobile-navigation.ts` — checked unique push,
  validated in-session entry, cold replace, depth reading, and back/fallback.
- `apps/vela-mobile/src/router/mobile-navigation.test.ts` — history-state behavior.
- `apps/vela-mobile/src/router/mobile-route-meta.d.ts` — typed optional header metadata.
- `apps/vela-mobile/src/router/diagnostic-routes.ts` — compile-time development route branch and pure route builder.
- `apps/vela-mobile/src/router/diagnostic-routes.test.ts` — development/production route construction.
- `apps/vela-mobile/src/boot/boot-files.ts` — pure Quasar boot-list builder.
- `apps/vela-mobile/src/boot/boot-files.test.ts` — mode-specific boot inclusion.
- `apps/vela-mobile/src/services/mobile-lifecycle.ts` — app-level resume observations.
- `apps/vela-mobile/src/services/mobile-lifecycle.test.ts` — route-neutral lifecycle state.
- `apps/vela-mobile/src/boot/capacitor-lifecycle.ts` — Capacitor-only typed App listener.
- `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts` — listener registration and idempotence.
- `apps/vela-mobile/src/boot/diagnostic-cold-entry.ts` — development-only one-shot route staging/consumption.
- `apps/vela-mobile/src/boot/diagnostic-cold-entry.test.ts` — deletion, allowlist, pre-install replace, and replay protection.
- `apps/vela-mobile/src/components/mobile/JapaneseInputProbe.vue` — native IME event probe.
- `apps/vela-mobile/src/components/mobile/JapaneseInputProbe.test.ts` — exact draft/commit/submit behavior.
- `apps/vela-mobile/src/components/mobile/MobilePageHeader.vue` — metadata-driven title/back UI.
- `apps/vela-mobile/src/components/mobile/MobilePageHeader.test.ts` — title, target size, history, and fallback.
- `apps/vela-mobile/src/composables/useKeyboardViewport.ts` — typed Keyboard listeners and settled-viewport scrolling.
- `apps/vela-mobile/src/composables/useKeyboardViewport.test.ts` — native, browser, failure, cleanup, and resize behavior.
- `apps/vela-mobile/src/pages/diagnostics/IosInteractionDiagnosticsPage.vue` — development interaction harness and canonical marker.
- `apps/vela-mobile/src/pages/diagnostics/IosInteractionDiagnosticsPage.test.ts` — diagnostic controls and readouts.
- `apps/vela-mobile/src/pages/diagnostics/IosInteractionDetailPage.vue` — nested history identity page.
- `apps/vela-mobile/src/pages/diagnostics/IosInteractionDetailPage.test.ts` —
  route identity, duplicate navigation, repeated entry, resume, and touch
  targets.
- `apps/vela-mobile/scripts/verify-production-diagnostics.mjs` — recursive emitted-JavaScript marker scanner.
- `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs` — scanner positive and negative cases.
- `apps/vela-mobile/src-capacitor/ios/App/App/VelaBridgeViewController.swift` — native WKWebView gesture enablement.
- `apps/vela-mobile/src/ios/native-interaction-contract.test.ts` — Swift, storyboard, and pbxproj contracts.
- `apps/vela-mobile/docs/ios-interaction-baseline.md` — checked-in safe-area,
  simulator, Debug-device, Release-smoke, and artifact-scan evidence.

### Modify

- `apps/vela-mobile/src-capacitor/package.json`
- `apps/vela-mobile/src-capacitor/bun.lock`
- `apps/vela-mobile/src-capacitor/capacitor.config.json`
- `apps/vela-mobile/src-capacitor/ios/App/Podfile`
- `apps/vela-mobile/vitest.config.ts`
- `apps/vela-mobile/quasar.config.ts`
- `apps/vela-mobile/package.json`
- `apps/vela-mobile/src/router/routes.ts`
- `apps/vela-mobile/src/router/routes.test.ts`
- `apps/vela-mobile/src/router/index.ts`
- `apps/vela-mobile/src/router/index.test.ts`
- `apps/vela-mobile/src/layouts/MobileLayout.vue`
- `apps/vela-mobile/src/layouts/MobileLayout.test.ts`
- `apps/vela-mobile/src/pages/MorePage.vue`
- `apps/vela-mobile/src/pages/StubPages.test.ts`
- `apps/vela-mobile/src/css/app.scss`
- `apps/vela-mobile/src-capacitor/ios/App/App/Base.lproj/Main.storyboard`
- `apps/vela-mobile/src-capacitor/ios/App/App.xcodeproj/project.pbxproj`
- `apps/vela-mobile/README.md`

---

### Task 0: Select safe-area ownership on an iOS simulator

**Files:**

- Create: `apps/vela-mobile/src/ios/safe-area-policy.ts`
- Create: `apps/vela-mobile/src/ios/safe-area-policy.test.ts`
- Create: `apps/vela-mobile/docs/ios-interaction-baseline.md`
- Modify: `apps/vela-mobile/src-capacitor/capacitor.config.json`

**Interfaces:**

- Produces:
  - `SafeAreaPolicy`
  - `safeAreaPolicy.contentInset: 'always' | 'never'`
  - `safeAreaPolicy.headerlessTopOwner: 'native-scroll-view' | 'css'`
- Blocks every later task until one mode has recorded single-inset evidence.

- [ ] **Step 1: Write the failing policy/config consistency test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeAreaPolicy } from './safe-area-policy';

const capacitorConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../../src-capacitor/capacitor.config.json'), 'utf8'),
) as { ios?: { contentInset?: string } };

describe('safeAreaPolicy', () => {
  it('matches the native content-inset configuration', () => {
    expect(capacitorConfig.ios?.contentInset).toBe(safeAreaPolicy.contentInset);
  });

  it('uses the only valid headerless-top owner for the selected mode', () => {
    expect(safeAreaPolicy).toEqual(
      capacitorConfig.ios?.contentInset === 'always'
        ? {
            contentInset: 'always',
            headerlessTopOwner: 'native-scroll-view',
          }
        : {
            contentInset: 'never',
            headerlessTopOwner: 'css',
          },
    );
  });
});
```

- [ ] **Step 2: Run the policy test and verify the missing module fails**

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/ios/safe-area-policy.test.ts
```

Expected: FAIL because `safe-area-policy.ts` does not exist.

- [ ] **Step 3: Measure the existing `"always"` mode before adding the full harness**

Start the current development shell on a notched or Dynamic Island simulator:

```bash
# workdir: apps/vela-mobile
rtk bun run dev:ios
```

Use Safari Web Inspector on the running WebView. Paste these exact inspector
helpers:

```js
function safeAreaRect(selector) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function readSafeAreaPreflight() {
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'visibility:hidden',
    'padding-top:env(safe-area-inset-top, 0px)',
    'padding-right:env(safe-area-inset-right, 0px)',
    'padding-bottom:env(safe-area-inset-bottom, 0px)',
    'padding-left:env(safe-area-inset-left, 0px)',
  ].join(';');
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const result = {
    bodyClasses: document.body.className,
    insets: {
      top: style.paddingTop,
      right: style.paddingRight,
      bottom: style.paddingBottom,
      left: style.paddingLeft,
    },
    page: safeAreaRect('.q-page'),
    pageFirstControl: safeAreaRect('.q-page :is(button, a, [role="button"], input, textarea)'),
    headerToolbar: safeAreaRect('#safe-area-preflight-header > .q-toolbar'),
    headerBack: safeAreaRect('#safe-area-preflight-header button'),
    footerTabs: safeAreaRect('.q-footer .q-tabs__content'),
    footerFirstTab: safeAreaRect('.q-footer .q-tab:first-child'),
    footerLastTab: safeAreaRect('.q-footer .q-tab:last-child'),
  };
  probe.remove();
  return result;
}

function installSafeAreaStyleProbe(headerlessTopOwner) {
  if (!['native-scroll-view', 'css'].includes(headerlessTopOwner)) {
    throw new Error(`Unknown headerless-top owner: ${headerlessTopOwner}`);
  }

  document.querySelector('#safe-area-preflight-style')?.remove();
  const pageContainer = document.querySelector('.q-page-container');
  if (!(pageContainer instanceof HTMLElement)) {
    throw new Error('Missing .q-page-container');
  }
  pageContainer.classList.toggle('safe-area-preflight--css-top', headerlessTopOwner === 'css');

  const style = document.createElement('style');
  style.id = 'safe-area-preflight-style';
  style.textContent = `
    .q-page {
      padding-left: max(16px, env(safe-area-inset-left, 0px)) !important;
      padding-right: max(16px, env(safe-area-inset-right, 0px)) !important;
    }
    #safe-area-preflight-header > .q-toolbar {
      padding-left: max(12px, env(safe-area-inset-left, 0px));
      padding-right: max(12px, env(safe-area-inset-right, 0px));
    }
    .q-footer .q-tabs__content {
      padding-left: env(safe-area-inset-left, 0px);
      padding-right: env(safe-area-inset-right, 0px);
    }
    .safe-area-preflight--css-top {
      padding-top: env(safe-area-inset-top, 0px) !important;
    }
  `;
  document.head.append(style);
}

function installSafeAreaHeaderProbe() {
  removeSafeAreaHeaderProbe();
  const layout = document.querySelector('.q-layout');
  if (!(layout instanceof HTMLElement)) {
    throw new Error('Missing .q-layout');
  }
  const header = document.createElement('header');
  header.id = 'safe-area-preflight-header';
  header.className = 'q-header q-layout__section--marginal fixed-top bg-primary text-white';
  header.innerHTML = [
    '<div class="q-toolbar row no-wrap items-center">',
    '<button style="min-width:44px;min-height:44px">Back probe</button>',
    '<div class="q-toolbar__title ellipsis">Safe-area preflight</div>',
    '</div>',
  ].join('');
  layout.prepend(header);
}

function removeSafeAreaHeaderProbe() {
  document.querySelector('#safe-area-preflight-header')?.remove();
}
```

For each orientation, run this exact cycle. Save the first result/screenshot as
`headerless` and the second as `header`, then remove the probe before rotating:

```js
removeSafeAreaHeaderProbe();
installSafeAreaStyleProbe('native-scroll-view');
readSafeAreaPreflight();
installSafeAreaHeaderProbe();
readSafeAreaPreflight();
removeSafeAreaHeaderProbe();
```

Repeat the full five-call cycle independently in portrait, landscape-left, and
landscape-right. Record whether the headerless page, injected toolbar, footer
tabs, and their first/last controls have exactly one inset and remain outside
the sensor housing. Save the six distinct screenshots under
`docs/evidence/hpa-209/` as
`safe-area-always-{headerless,header}-{portrait,landscape-left,landscape-right}.png`.
Stop the first development process after all `"always"` evidence is saved.

- [ ] **Step 4: Repeat the same measurements with `"never"`**

Set only the native inset value in `capacitor.config.json`:

```json
"ios": {
  "contentInset": "never"
}
```

Synchronize and restart the simulator build:

```bash
# workdir: apps/vela-mobile/src-capacitor
rtk bunx cap sync ios
# workdir: apps/vela-mobile
rtk bun run dev:ios
```

Run the same five-call cycle in every orientation. For this mode, replace
`installSafeAreaStyleProbe('native-scroll-view')` with
`installSafeAreaStyleProbe('css')` so the candidate app-owned headerless top
inset is present. The horizontal rules remain identical between modes, and the
header is removed before every headerless capture and after every header
capture.
Save the six screenshots as
`safe-area-never-{headerless,header}-{portrait,landscape-left,landscape-right}.png`.
Do not reuse values from the `"always"` run.

- [ ] **Step 5: Apply the deterministic ownership decision**

Choose `"always"` only when all of these observations are true:

- the native scroll view gives headerless content exactly one top inset;
- Quasar's fixed toolbar and footer each have exactly one top/bottom inset;
- all four CSS `env()` values are usable in the relevant orientations;
- the candidate page, toolbar, and footer-tab horizontal rules keep the
  measured first/last controls outside either landscape sensor region;
- no top or bottom inset is visibly doubled.

Choose `"never"` when it meets those same control-bound requirements with CSS
owning the headerless top inset. If both pass, choose `"always"` to preserve
the existing native configuration. If neither passes, stop execution and
report HPA-209 blocked; do not build the full harness against an unknown
ownership model.

- [ ] **Step 6: Commit the selected policy as one of two exact variants**

If `"always"` wins, keep it in `capacitor.config.json` and create:

```ts
export type SafeAreaPolicy = {
  contentInset: 'always' | 'never';
  headerlessTopOwner: 'native-scroll-view' | 'css';
};

export const safeAreaPolicy: SafeAreaPolicy = {
  contentInset: 'always',
  headerlessTopOwner: 'native-scroll-view',
};
```

If `"never"` wins, keep it in `capacitor.config.json` and create:

```ts
export type SafeAreaPolicy = {
  contentInset: 'always' | 'never';
  headerlessTopOwner: 'native-scroll-view' | 'css';
};

export const safeAreaPolicy: SafeAreaPolicy = {
  contentInset: 'never',
  headerlessTopOwner: 'css',
};
```

Create `docs/ios-interaction-baseline.md` with:

- the selected mode and ownership;
- both modes' exact computed inset values and element bounds;
- simulator model, iOS, Xcode, orientation, commit, and build configuration;
- screenshots' repository-relative paths;
- an explicit pass/fail result for each decision rule;
- reproduction details for any failure.

- [ ] **Step 7: Run the policy test and typecheck**

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/ios/safe-area-policy.test.ts
rtk bun run typecheck
```

Expected: PASS with the policy literal matching `capacitor.config.json`.

- [ ] **Step 8: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src/ios/safe-area-policy.ts \
  apps/vela-mobile/src/ios/safe-area-policy.test.ts \
  apps/vela-mobile/src-capacitor/capacitor.config.json \
  apps/vela-mobile/docs/ios-interaction-baseline.md \
  apps/vela-mobile/docs/evidence/hpa-209
rtk git commit -m "test(mobile): record safe-area ownership"
```

---

### Task 1: Add the typed Capacitor Keyboard dependency and test resolver

**Files:**

- Create: `apps/vela-mobile/src/ios/capacitor-plugins.test.ts`
- Modify: `apps/vela-mobile/src-capacitor/package.json`
- Modify: `apps/vela-mobile/src-capacitor/bun.lock`
- Modify: `apps/vela-mobile/src-capacitor/capacitor.config.json`
- Modify: `apps/vela-mobile/src-capacitor/ios/App/Podfile`
- Modify: `apps/vela-mobile/vitest.config.ts`

**Interfaces:**

- Consumes: existing Capacitor 7 packages under `src-capacitor/node_modules`.
- Produces: resolvable `@capacitor/app`, `@capacitor/core`, and `@capacitor/keyboard` modules in Vitest; native Keyboard resize configuration.

- [ ] **Step 1: Write the failing dependency/configuration test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const capacitorRoot = resolve(__dirname, '../../src-capacitor');
const packageJson = JSON.parse(readFileSync(resolve(capacitorRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const capacitorConfig = JSON.parse(
  readFileSync(resolve(capacitorRoot, 'capacitor.config.json'), 'utf8'),
) as { plugins?: { Keyboard?: { resize?: string } } };

describe('Capacitor plugin contracts', () => {
  it('pins Keyboard to Capacitor major 7', () => {
    expect(packageJson.dependencies['@capacitor/keyboard']).toMatch(/^\^7\./);
  });

  it('uses native WebView keyboard resize', () => {
    expect(capacitorConfig.plugins?.Keyboard?.resize).toBe('native');
  });

  it('resolves typed Capacitor plugins from Vitest', async () => {
    expect((await import('@capacitor/app')).App).toBeDefined();
    expect((await import('@capacitor/core')).Capacitor).toBeDefined();
    expect((await import('@capacitor/keyboard')).Keyboard).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test and verify the missing Keyboard module fails**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/ios/capacitor-plugins.test.ts
```

Expected: FAIL because `@capacitor/keyboard` is absent and the standalone Vitest resolver has no Capacitor aliases.

- [ ] **Step 3: Install Keyboard in the Capacitor project and configure native resize**

Run:

```bash
# workdir: apps/vela-mobile/src-capacitor
rtk bun add @capacitor/keyboard@^7.0.0
```

Leave the Task 0 `ios.contentInset` value unchanged and add this exact
top-level plugin block to `capacitor.config.json`:

```json
"plugins": {
  "Keyboard": {
    "resize": "native"
  }
}
```

The explicit value pins Capacitor iOS's existing default; it is not expected
to change behavior.

- [ ] **Step 4: Add explicit Vitest aliases**

Add these entries to `vitest.config.ts` under `resolve.alias`:

```ts
'@capacitor/app': resolve(__dirname, './src-capacitor/node_modules/@capacitor/app'),
'@capacitor/core': resolve(__dirname, './src-capacitor/node_modules/@capacitor/core'),
'@capacitor/keyboard': resolve(
  __dirname,
  './src-capacitor/node_modules/@capacitor/keyboard',
),
```

- [ ] **Step 5: Synchronize iOS native dependencies and generated TypeScript paths**

Run:

```bash
# workdir: apps/vela-mobile/src-capacitor
rtk bunx cap sync ios
# workdir: apps/vela-mobile
rtk bunx quasar prepare
```

Expected: `Podfile` contains `CapacitorKeyboard`, `src-capacitor/bun.lock` contains the v7 package, and `.quasar/tsconfig.json` contains the generated Keyboard path alias.

- [ ] **Step 6: Run the focused test and typecheck**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/ios/capacitor-plugins.test.ts
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src/ios/capacitor-plugins.test.ts \
  apps/vela-mobile/src-capacitor/package.json \
  apps/vela-mobile/src-capacitor/bun.lock \
  apps/vela-mobile/src-capacitor/capacitor.config.json \
  apps/vela-mobile/src-capacitor/ios/App/Podfile \
  apps/vela-mobile/vitest.config.ts
rtk git commit -m "feat(mobile): configure typed keyboard plugin"
```

---

### Task 2: Establish router metadata, chronological depth, and development routes

**Files:**

- Create: `apps/vela-mobile/src/router/mobile-navigation.ts`
- Create: `apps/vela-mobile/src/router/mobile-navigation.test.ts`
- Create: `apps/vela-mobile/src/router/mobile-route-meta.d.ts`
- Create: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Create: `apps/vela-mobile/src/router/diagnostic-routes.test.ts`
- Create: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDiagnosticsPage.vue`
- Create: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDetailPage.vue`
- Modify: `apps/vela-mobile/src/router/routes.ts`
- Modify: `apps/vela-mobile/src/router/routes.test.ts`
- Modify: `apps/vela-mobile/src/router/index.ts`
- Modify: `apps/vela-mobile/src/router/index.test.ts`

**Interfaces:**

- Produces:
  - `readMobileDepth(router: Router): number`
  - `pushMobileRoute(router: Router, target: RouteLocationRaw): Promise<MobileNavigationResult>`
  - `enterMobileRoute(router: Router, target: RouteLocationRaw, allowedFullPaths: ReadonlySet<string>): Promise<MobileNavigationResult>`
  - `replaceColdMobileRoute(router: Router, target: RouteLocationRaw, allowedFullPaths: ReadonlySet<string>): Promise<MobileNavigationResult>`
  - `backOrFallback(router: Router, fallback: RouteLocationRaw): Promise<MobileNavigationResult>`
  - `mobileScrollBehavior: RouterScrollBehavior`
  - `IOS_DIAGNOSTIC_ROOT_PATH` and `IOS_DIAGNOSTIC_DETAIL_PATH`
  - `buildMobileChildRoutes(diagnosticRoutes?: RouteRecordRaw[]): RouteRecordRaw[]`

- [ ] **Step 1: Write failing navigation and scroll tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryHistory,
  createRouter,
  isNavigationFailure,
  NavigationFailureType,
  type RouteRecordRaw,
} from 'vue-router';
import {
  backOrFallback,
  enterMobileRoute,
  pushMobileRoute,
  readMobileDepth,
  replaceColdMobileRoute,
} from './mobile-navigation';
import { mobileScrollBehavior } from './index';

const records: RouteRecordRaw[] = [
  { path: '/', component: { template: '<div>home</div>' } },
  { path: '/more', component: { template: '<div>more</div>' } },
  { path: '/detail', component: { template: '<div>detail</div>' } },
];

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: records });
}

describe('mobile navigation', () => {
  it('pushes unique routes and increments mobileDepth', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await pushMobileRoute(router, '/more');
    expect(router.currentRoute.value.fullPath).toBe('/more');
    expect(readMobileDepth(router)).toBe(1);
  });

  it('does not change depth for the current fullPath', async () => {
    const router = makeRouter();
    await router.replace({ path: '/detail', state: { mobileDepth: 2 } });
    const result = await pushMobileRoute(router, '/detail');
    expect(result.kind).toBe('noop');
    expect(readMobileDepth(router)).toBe(2);
  });

  it('rejects route entry outside the allowlist', async () => {
    const router = makeRouter();
    await router.replace('/');
    const result = await enterMobileRoute(router, '/more', new Set(['/detail']));
    expect(result.kind).toBe('rejected');
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('pushes an allowed in-session entry with chronological depth', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await enterMobileRoute(router, '/detail', new Set(['/detail']));
    expect(router.currentRoute.value.fullPath).toBe('/detail');
    expect(readMobileDepth(router)).toBe(1);
  });

  it('treats repeated route entry as a depth-preserving no-op', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await enterMobileRoute(router, '/detail', new Set(['/detail']));
    const result = await enterMobileRoute(router, '/detail', new Set(['/detail']));
    expect(result.kind).toBe('noop');
    expect(readMobileDepth(router)).toBe(1);
  });

  it('replaces an allowed cold entry at depth zero', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 3 } });
    await replaceColdMobileRoute(router, '/detail', new Set(['/detail']));
    expect(router.currentRoute.value.fullPath).toBe('/detail');
    expect(readMobileDepth(router)).toBe(0);
  });

  it('keeps in-session entry coherent across back and forward', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await enterMobileRoute(router, '/detail', new Set(['/detail']));

    router.back();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/');
      expect(readMobileDepth(router)).toBe(0);
    });

    router.forward();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/detail');
      expect(readMobileDepth(router)).toBe(1);
    });
  });

  it('rejects when a guard aborts navigation instead of reporting success', async () => {
    const router = makeRouter();
    await router.replace('/');
    router.beforeEach(() => false);
    let failure: unknown;
    try {
      await pushMobileRoute(router, '/detail');
    } catch (error) {
      failure = error;
    }
    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('surfaces cancellation when a newer navigation supersedes an in-flight push', async () => {
    const router = makeRouter();
    await router.replace('/');
    let releaseMore: (() => void) | undefined;
    router.beforeEach(async (to) => {
      if (to.path === '/more') {
        await new Promise<void>((resolve) => {
          releaseMore = resolve;
        });
      }
    });

    const first = pushMobileRoute(router, '/more');
    await vi.waitFor(() => expect(releaseMore).toBeTypeOf('function'));
    const second = pushMobileRoute(router, '/detail');
    releaseMore?.();

    let cancellation: unknown;
    try {
      await first;
    } catch (error) {
      cancellation = error;
    }
    expect(isNavigationFailure(cancellation, NavigationFailureType.cancelled)).toBe(true);
    await expect(second).resolves.toMatchObject({
      kind: 'pushed',
      fullPath: '/detail',
      depth: 1,
    });
  });

  it('uses browser history when app-owned depth is positive', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await pushMobileRoute(router, '/detail');
    const result = await backOrFallback(router, '/more');
    expect(result.kind).toBe('back');
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/');
      expect(readMobileDepth(router)).toBe(0);
    });
  });

  it('uses fallback when app-owned depth is zero', async () => {
    const router = makeRouter();
    await router.replace({ path: '/detail', state: { mobileDepth: 0 } });
    await backOrFallback(router, '/more');
    expect(router.currentRoute.value.fullPath).toBe('/more');
    expect(readMobileDepth(router)).toBe(0);
  });

  it('restores the original route depth across back and forward', async () => {
    const router = makeRouter();
    await router.replace({ path: '/detail', state: { mobileDepth: 2 } });
    await pushMobileRoute(router, '/');
    expect(readMobileDepth(router)).toBe(3);

    router.back();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/detail');
      expect(readMobileDepth(router)).toBe(2);
    });

    router.forward();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/');
      expect(readMobileDepth(router)).toBe(3);
    });
  });
});

describe('mobileScrollBehavior', () => {
  it('restores saved positions for popstate navigation', () => {
    const saved = { left: 12, top: 480 };
    expect(mobileScrollBehavior({} as never, {} as never, saved)).toEqual(saved);
  });

  it('scrolls new navigation to the top', () => {
    expect(mobileScrollBehavior({} as never, {} as never, null)).toEqual({
      left: 0,
      top: 0,
    });
  });
});
```

- [ ] **Step 2: Run the focused tests and verify missing exports fail**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/router/mobile-navigation.test.ts src/router/index.test.ts
```

Expected: FAIL because the navigation module and exported scroll behavior do not exist.

- [ ] **Step 3: Implement the navigation helper**

Create `mobile-navigation.ts` with this public shape:

```ts
import {
  isNavigationFailure,
  type RouteLocationRaw,
  type RouteLocationResolved,
  type Router,
} from 'vue-router';

export type MobileNavigationResult = {
  kind: 'pushed' | 'replaced' | 'back' | 'fallback' | 'noop' | 'rejected';
  fullPath: string;
  depth: number;
};

export function readMobileDepth(router: Router): number {
  const value = router.options.history.state.mobileDepth;
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function routeLocation(resolved: RouteLocationResolved, mobileDepth: number): RouteLocationRaw {
  return {
    path: resolved.path,
    query: resolved.query,
    hash: resolved.hash,
    state: { mobileDepth },
  };
}

function throwNavigationFailure(result: Awaited<ReturnType<Router['push']>>): void {
  if (isNavigationFailure(result)) {
    throw result;
  }
}

export async function pushMobileRoute(
  router: Router,
  target: RouteLocationRaw,
): Promise<MobileNavigationResult> {
  const resolved = router.resolve(target);
  const depth = readMobileDepth(router);
  if (resolved.fullPath === router.currentRoute.value.fullPath) {
    return { kind: 'noop', fullPath: resolved.fullPath, depth };
  }
  const nextDepth = depth + 1;
  const result = await router.push(routeLocation(resolved, nextDepth));
  throwNavigationFailure(result);
  return { kind: 'pushed', fullPath: resolved.fullPath, depth: nextDepth };
}

export async function enterMobileRoute(
  router: Router,
  target: RouteLocationRaw,
  allowedFullPaths: ReadonlySet<string>,
): Promise<MobileNavigationResult> {
  const resolved = router.resolve(target);
  if (!allowedFullPaths.has(resolved.fullPath)) {
    return {
      kind: 'rejected',
      fullPath: router.currentRoute.value.fullPath,
      depth: readMobileDepth(router),
    };
  }
  if (resolved.fullPath === router.currentRoute.value.fullPath) {
    return { kind: 'noop', fullPath: resolved.fullPath, depth: readMobileDepth(router) };
  }
  return pushMobileRoute(router, target);
}

export async function replaceColdMobileRoute(
  router: Router,
  target: RouteLocationRaw,
  allowedFullPaths: ReadonlySet<string>,
): Promise<MobileNavigationResult> {
  const resolved = router.resolve(target);
  if (!allowedFullPaths.has(resolved.fullPath)) {
    return {
      kind: 'rejected',
      fullPath: router.currentRoute.value.fullPath,
      depth: readMobileDepth(router),
    };
  }
  if (resolved.fullPath === router.currentRoute.value.fullPath) {
    return { kind: 'noop', fullPath: resolved.fullPath, depth: readMobileDepth(router) };
  }
  const result = await router.replace(routeLocation(resolved, 0));
  throwNavigationFailure(result);
  return { kind: 'replaced', fullPath: resolved.fullPath, depth: 0 };
}

export async function backOrFallback(
  router: Router,
  fallback: RouteLocationRaw,
): Promise<MobileNavigationResult> {
  const depth = readMobileDepth(router);
  if (depth > 0) {
    router.back();
    return { kind: 'back', fullPath: router.currentRoute.value.fullPath, depth };
  }
  const resolved = router.resolve(fallback);
  const result = await router.replace(routeLocation(resolved, 0));
  throwNavigationFailure(result);
  return { kind: 'fallback', fullPath: resolved.fullPath, depth: 0 };
}
```

Vue Router resolves aborted, cancelled, and duplicated navigation with a
`NavigationFailure` value. Same-route duplication is handled by the explicit
precheck; every other resolved navigation failure is thrown for the caller to
log and surface. Diagnostic actions catch these failures and store the exact
message in their last-outcome readout. Shell tab handlers catch and log them so
no rejected promise is left unhandled.

- [ ] **Step 4: Add typed mobile header metadata**

Create `mobile-route-meta.d.ts`:

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

export {};
```

- [ ] **Step 5: Write failing development-route construction tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildMobileChildRoutes,
  developmentDiagnosticRoutes,
  IOS_DIAGNOSTIC_DETAIL_PATH,
  IOS_DIAGNOSTIC_ROOT_PATH,
} from './diagnostic-routes';

describe('diagnostic route construction', () => {
  it('adds the two diagnostic routes in development', () => {
    const paths = buildMobileChildRoutes(developmentDiagnosticRoutes).map((route) => route.path);
    expect(paths).toContain(IOS_DIAGNOSTIC_ROOT_PATH.slice(1));
    expect(paths).toContain(IOS_DIAGNOSTIC_DETAIL_PATH.slice(1));
  });

  it('keeps production construction at the five shell routes', () => {
    expect(buildMobileChildRoutes([])).toHaveLength(5);
  });

  it('declares exact header metadata and fallbacks', () => {
    expect(developmentDiagnosticRoutes[0]?.meta?.mobileHeader).toEqual({
      title: 'iOS Interaction Diagnostics',
      fallback: '/more',
    });
    expect(developmentDiagnosticRoutes[1]?.meta?.mobileHeader).toEqual({
      title: 'Navigation Detail',
      fallback: IOS_DIAGNOSTIC_ROOT_PATH,
    });
  });
});
```

- [ ] **Step 6: Implement the compile-time route branch and minimal route pages**

Create `diagnostic-routes.ts` so the dynamic imports remain lexically inside the module-level development branch:

```ts
import type { RouteRecordRaw } from 'vue-router';

export const IOS_DIAGNOSTIC_ROOT_PATH = '/diagnostics/ios-interactions';
export const IOS_DIAGNOSTIC_DETAIL_PATH = '/diagnostics/ios-interactions/detail';

const coreRoutes: RouteRecordRaw[] = [
  { path: '', name: 'home', component: () => import('pages/HomePage.vue') },
  { path: 'review', name: 'review', component: () => import('pages/ReviewPage.vue') },
  { path: 'learn', name: 'learn', component: () => import('pages/LearnPage.vue') },
  { path: 'words', name: 'words', component: () => import('pages/WordsPage.vue') },
  { path: 'more', name: 'more', component: () => import('pages/MorePage.vue') },
];

export const developmentDiagnosticRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: IOS_DIAGNOSTIC_ROOT_PATH.slice(1),
        name: 'iosInteractionDiagnostics',
        component: () => import('pages/diagnostics/IosInteractionDiagnosticsPage.vue'),
        meta: {
          mobileHeader: {
            title: 'iOS Interaction Diagnostics',
            fallback: '/more',
          },
        },
      },
      {
        path: IOS_DIAGNOSTIC_DETAIL_PATH.slice(1),
        name: 'ios-interaction-detail',
        component: () => import('pages/diagnostics/IosInteractionDetailPage.vue'),
        meta: {
          mobileHeader: {
            title: 'Navigation Detail',
            fallback: IOS_DIAGNOSTIC_ROOT_PATH,
          },
        },
      },
    ]
  : [];

export function buildMobileChildRoutes(
  diagnosticRoutes: RouteRecordRaw[] = developmentDiagnosticRoutes,
): RouteRecordRaw[] {
  return [...coreRoutes, ...diagnosticRoutes];
}
```

Create both page files with a real route identity that Task 6 will expand:

```vue
<template>
  <q-page padding>
    <h1 class="text-h5">iOS Interaction Diagnostics</h1>
  </q-page>
</template>
```

```vue
<template>
  <q-page padding>
    <h1 class="text-h5">Navigation Detail</h1>
  </q-page>
</template>
```

Replace the root route's inline children in `routes.ts` with:

```ts
children: buildMobileChildRoutes(),
```

- [ ] **Step 7: Export and use native-like scroll behavior**

In `router/index.ts`:

```ts
import type { RouterScrollBehavior } from 'vue-router';

export const mobileScrollBehavior: RouterScrollBehavior = (_to, _from, savedPosition) =>
  savedPosition ?? { left: 0, top: 0 };
```

Pass `mobileScrollBehavior` to `createRouter`.

- [ ] **Step 8: Update existing route tests and run the router suite**

Update `routes.test.ts` to expect five core children plus two development children and to exercise `buildMobileChildRoutes([])` for production. Continue awaiting every development lazy component.

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/router
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src/router \
  apps/vela-mobile/src/pages/diagnostics
rtk git commit -m "feat(mobile): define chronological route history"
```

---

### Task 3: Add app-level resume ownership and one-shot development entry

**Files:**

- Create: `apps/vela-mobile/src/boot/boot-files.ts`
- Create: `apps/vela-mobile/src/boot/boot-files.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-lifecycle.ts`
- Create: `apps/vela-mobile/src/services/mobile-lifecycle.test.ts`
- Create: `apps/vela-mobile/src/boot/capacitor-lifecycle.ts`
- Create: `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts`
- Create: `apps/vela-mobile/src/boot/diagnostic-cold-entry.ts`
- Create: `apps/vela-mobile/src/boot/diagnostic-cold-entry.test.ts`
- Modify: `apps/vela-mobile/quasar.config.ts`

**Interfaces:**

- Produces:
  - `getMobileBootFiles(flags): string[]`
  - `recordAppResume(at?: number): void`
  - `mobileLifecycleState`
  - `registerCapacitorLifecycle(adapter): Promise<void>`
  - `DIAGNOSTIC_COLD_ENTRY_KEY`
  - `stageDiagnosticColdEntry(storage, target): void`
  - `consumeDiagnosticColdEntry(router, storage): Promise<MobileNavigationResult | null>`

- [ ] **Step 1: Write failing lifecycle and boot-selection tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { getMobileBootFiles } from './boot-files';
import {
  mobileLifecycleState,
  recordAppResume,
  resetMobileLifecycleForTests,
} from 'src/services/mobile-lifecycle';
import { registerCapacitorLifecycle, resetCapacitorLifecycleForTests } from './capacitor-lifecycle';

describe('mobile boot files', () => {
  it('includes native lifecycle only in Capacitor mode', () => {
    expect(getMobileBootFiles({ isCapacitor: true, isDevelopment: false })).toEqual([
      'main',
      'capacitor-lifecycle',
    ]);
  });

  it('includes cold entry only in development', () => {
    expect(getMobileBootFiles({ isCapacitor: false, isDevelopment: true })).toEqual([
      'main',
      'diagnostic-cold-entry',
    ]);
  });
});

describe('mobile lifecycle', () => {
  it('records resume without a router dependency', () => {
    resetMobileLifecycleForTests();
    recordAppResume(1234);
    expect(mobileLifecycleState.resumeCount.value).toBe(1);
    expect(mobileLifecycleState.lastResumeAt.value).toBe(1234);
  });

  it('registers one native resume listener', async () => {
    resetCapacitorLifecycleForTests();
    const addListener = vi.fn(async (_name: 'resume', listener: () => void) => {
      listener();
      return { remove: vi.fn(async () => undefined) };
    });
    await registerCapacitorLifecycle({ addListener });
    await registerCapacitorLifecycle({ addListener });
    expect(addListener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify missing modules fail**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/boot/boot-files.test.ts \
  src/boot/capacitor-lifecycle.test.ts \
  src/services/mobile-lifecycle.test.ts
```

Expected: FAIL because the new boot and service modules do not exist.

- [ ] **Step 3: Implement route-neutral lifecycle state**

Create `mobile-lifecycle.ts`:

```ts
import { readonly, ref } from 'vue';

const resumeCount = ref(0);
const lastResumeAt = ref<number | null>(null);

export const mobileLifecycleState = {
  resumeCount: readonly(resumeCount),
  lastResumeAt: readonly(lastResumeAt),
};

export function recordAppResume(at = Date.now()): void {
  resumeCount.value += 1;
  lastResumeAt.value = at;
}

export function resetMobileLifecycleForTests(): void {
  resumeCount.value = 0;
  lastResumeAt.value = null;
}
```

Create `capacitor-lifecycle.ts` with an injectable adapter:

```ts
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { defineBoot } from '#q-app/wrappers';
import { recordAppResume } from 'src/services/mobile-lifecycle';

export type ResumeAppAdapter = {
  addListener(eventName: 'resume', listener: () => void): Promise<PluginListenerHandle>;
};

let registered = false;

export async function registerCapacitorLifecycle(adapter: ResumeAppAdapter = App): Promise<void> {
  if (registered) return;
  await adapter.addListener('resume', () => recordAppResume());
  registered = true;
}

export function resetCapacitorLifecycleForTests(): void {
  registered = false;
}

export default defineBoot(async () => {
  await registerCapacitorLifecycle();
});
```

- [ ] **Step 4: Write failing one-shot cold-entry tests**

```ts
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import {
  consumeDiagnosticColdEntry,
  DIAGNOSTIC_COLD_ENTRY_KEY,
  stageDiagnosticColdEntry,
} from './diagnostic-cold-entry';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('diagnostic cold entry', () => {
  it('deletes then replaces an allowed target before router installation', async () => {
    const storage = memoryStorage();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/diagnostics/ios-interactions/detail', component: {} },
      ],
    });
    stageDiagnosticColdEntry(storage, '/diagnostics/ios-interactions/detail');
    await consumeDiagnosticColdEntry(router, storage);
    expect(storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY)).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe('/diagnostics/ios-interactions/detail');
    expect(router.options.history.state.mobileDepth).toBe(0);
  });

  it('deletes invalid values without navigation', async () => {
    const storage = memoryStorage();
    storage.setItem(DIAGNOSTIC_COLD_ENTRY_KEY, '/words');
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/words', component: {} },
      ],
    });
    await consumeDiagnosticColdEntry(router, storage);
    expect(storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY)).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('deletes the key before a failed navigation and cannot replay it', async () => {
    const storage = memoryStorage();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/diagnostics/ios-interactions/detail', component: {} },
      ],
    });
    stageDiagnosticColdEntry(storage, '/diagnostics/ios-interactions/detail');
    let keyWasDeletedBeforeNavigation = false;
    router.beforeEach(() => {
      keyWasDeletedBeforeNavigation = storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY) === null;
      throw new Error('navigation failed');
    });

    await expect(consumeDiagnosticColdEntry(router, storage)).rejects.toThrow('navigation failed');
    expect(keyWasDeletedBeforeNavigation).toBe(true);
    expect(storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY)).toBeNull();
    await expect(consumeDiagnosticColdEntry(router, storage)).resolves.toBeNull();
  });
});
```

- [ ] **Step 5: Implement staged-entry consumption without `router.isReady()`**

Create `diagnostic-cold-entry.ts`:

```ts
import { defineBoot } from '#q-app/wrappers';
import type { Router } from 'vue-router';
import { IOS_DIAGNOSTIC_DETAIL_PATH, IOS_DIAGNOSTIC_ROOT_PATH } from 'src/router/diagnostic-routes';
import { replaceColdMobileRoute, type MobileNavigationResult } from 'src/router/mobile-navigation';

export const DIAGNOSTIC_COLD_ENTRY_KEY = 'vela:dev:ios-interaction-cold-entry';

const allowedDiagnosticEntries = new Set([IOS_DIAGNOSTIC_ROOT_PATH, IOS_DIAGNOSTIC_DETAIL_PATH]);

export function stageDiagnosticColdEntry(storage: Storage, target: string): void {
  if (!allowedDiagnosticEntries.has(target)) {
    throw new Error(`Disallowed diagnostic cold-entry target: ${target}`);
  }
  storage.setItem(DIAGNOSTIC_COLD_ENTRY_KEY, target);
}

export async function consumeDiagnosticColdEntry(
  router: Router,
  storage: Storage,
): Promise<MobileNavigationResult | null> {
  const target = storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY);
  if (target === null) return null;
  storage.removeItem(DIAGNOSTIC_COLD_ENTRY_KEY);
  return replaceColdMobileRoute(router, target, allowedDiagnosticEntries);
}

export default defineBoot(async ({ router }) => {
  await consumeDiagnosticColdEntry(router, window.localStorage);
});
```

- [ ] **Step 6: Make boot inclusion explicit in Quasar configuration**

Create `boot-files.ts`:

```ts
export function getMobileBootFiles(flags: {
  isCapacitor: boolean;
  isDevelopment: boolean;
}): string[] {
  return [
    'main',
    ...(flags.isCapacitor ? ['capacitor-lifecycle'] : []),
    ...(flags.isDevelopment ? ['diagnostic-cold-entry'] : []),
  ];
}
```

Change `quasar.config.ts` to call:

```ts
boot: getMobileBootFiles({
  isCapacitor: ctx.mode.capacitor,
  isDevelopment: ctx.dev,
}),
```

- [ ] **Step 7: Run the lifecycle/cold-entry tests and full boot tests**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/boot src/services/mobile-lifecycle.test.ts
```

Expected: PASS with no call to `router.isReady()`.

- [ ] **Step 8: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src/boot \
  apps/vela-mobile/src/services/mobile-lifecycle.ts \
  apps/vela-mobile/src/services/mobile-lifecycle.test.ts \
  apps/vela-mobile/quasar.config.ts
rtk git commit -m "feat(mobile): own resume and cold entry lifecycle"
```

---

### Task 4: Build the Japanese IME probe on QInput's native element

**Files:**

- Create: `apps/vela-mobile/src/components/mobile/JapaneseInputProbe.vue`
- Create: `apps/vela-mobile/src/components/mobile/JapaneseInputProbe.test.ts`

**Interfaces:**

- Produces a self-contained probe with `fieldModel`, `draft`, `committed`,
  `submitted`, and `isComposing` readouts.
- Exposes no normalized or trimmed answer value.

- [ ] **Step 1: Write failing native-event component tests**

```ts
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import JapaneseInputProbe from './JapaneseInputProbe.vue';

function mountProbe() {
  return mount(JapaneseInputProbe, { global: { plugins: [Quasar] } });
}

describe('JapaneseInputProbe', () => {
  it('tracks draft during composition without submitting', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    input.element.value = 'にほんご';
    await input.trigger('input');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.get('[data-testid="ime-draft"]').text()).toContain('にほんご');
    expect(wrapper.get('[data-testid="ime-composing"]').text()).toContain('yes');
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).not.toContain('にほんご');
  });

  it('records exact commit then submits on a later Enter keydown', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    input.element.value = '日本語';
    await input.trigger('input');
    await input.trigger('compositionend', { data: '日本語' });
    await nextTick();
    expect(wrapper.getComponent({ name: 'QInput' }).props('modelValue')).toBe('日本語');
    expect(wrapper.get('[data-testid="ime-model"]').text()).toContain('日本語');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('日本語');
    await input.trigger('keydown', { key: 'Enter', isComposing: false });
    expect(wrapper.get('[data-testid="ime-committed"]').text()).toContain('日本語');
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).toContain('日本語');
  });

  it('does not write an in-progress draft through QInput model updates', async () => {
    const wrapper = mountProbe();
    const qInput = wrapper.getComponent({ name: 'QInput' });
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    input.element.value = 'にほ';
    await input.trigger('input');
    expect(qInput.props('modelValue')).toBe('');
  });

  it('Done blurs the native control', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    input.element.focus();
    await wrapper.get('[data-testid="ime-done"]').trigger('click');
    expect(document.activeElement).not.toBe(input.element);
  });
});
```

- [ ] **Step 2: Run the test and verify the component is missing**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/components/mobile/JapaneseInputProbe.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement native listener ownership and exact submission**

Do not use Quasar's internal `qComposing` flag as the probe's source of truth.
The installed Quasar version sets it during `compositionupdate` only after CJK
pattern detection, so it can lag native `compositionstart`. The tracked native
flag and `KeyboardEvent.isComposing` remain the submission guards.

Use this state and event contract in the component:

```ts
const qInput = ref<InstanceType<typeof QInput> | null>(null);
const fieldModel = ref('');
const draft = ref('');
const committed = ref('');
const submitted = ref('');
const isComposing = ref(false);

function nativeValue(event: Event): string {
  return (event.currentTarget as HTMLInputElement).value;
}

function onCompositionStart(): void {
  isComposing.value = true;
}

function onNativeInput(event: Event): void {
  draft.value = nativeValue(event);
}

function onFieldModelUpdate(value: string | number | null): void {
  if (isComposing.value) return;
  fieldModel.value = String(value ?? '');
}

function onCompositionEnd(event: CompositionEvent): void {
  const value = nativeValue(event);
  isComposing.value = false;
  fieldModel.value = value;
  committed.value = value;
  draft.value = value;
}

function submitExactValue(): void {
  if (isComposing.value) return;
  submitted.value = qInput.value?.nativeEl?.value ?? fieldModel.value;
}

function onNativeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  if (isComposing.value || event.isComposing) return;
  event.preventDefault();
  submitExactValue();
}
```

On mount, attach `compositionstart`, `input`, `compositionend`, and `keydown` to `qInput.value.nativeEl`. On unmount, remove the same function references.

The template must include:

```vue
<q-input
  ref="qInput"
  :model-value="fieldModel"
  label="Japanese input"
  autocomplete="off"
  autocapitalize="off"
  spellcheck="false"
  @update:model-value="onFieldModelUpdate"
/>
<div data-testid="ime-model">Model: {{ fieldModel }}</div>
<div data-testid="ime-draft">Draft: {{ draft }}</div>
<div data-testid="ime-committed">Committed: {{ committed }}</div>
<div data-testid="ime-submitted">Submitted: {{ submitted }}</div>
<div data-testid="ime-composing">
  Composing: {{ isComposing ? 'yes' : 'no' }}
</div>
<q-btn
  data-testid="ime-done"
  class="mobile-touch-target"
  label="Done"
  @click="qInput?.nativeEl?.blur()"
/>
<q-btn
  data-testid="ime-submit"
  class="mobile-touch-target"
  label="Submit"
  color="primary"
  @click="submitExactValue"
/>
```

- [ ] **Step 4: Add button, background-dismissal, and listener-cleanup cases**

Add tests that:

- dispatch an ordinary non-composing `input` and Submit click and expect exact whitespace-preserving output;
- assert Done and Submit both carry `mobile-touch-target`;
- tap the component's non-interactive background and expect blur;
- tap Submit and expect it to remain focused long enough to activate;
- unmount, dispatch native events, and verify readouts no longer change.

- [ ] **Step 5: Run the focused tests and typecheck**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/components/mobile/JapaneseInputProbe.test.ts
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src/components/mobile/JapaneseInputProbe.vue \
  apps/vela-mobile/src/components/mobile/JapaneseInputProbe.test.ts
rtk git commit -m "feat(mobile): add Japanese IME probe"
```

---

### Task 5: Integrate keyboard viewport behavior, header, tabs, and safe areas

**Files:**

- Create: `apps/vela-mobile/src/composables/useKeyboardViewport.ts`
- Create: `apps/vela-mobile/src/composables/useKeyboardViewport.test.ts`
- Create: `apps/vela-mobile/src/components/mobile/MobilePageHeader.vue`
- Create: `apps/vela-mobile/src/components/mobile/MobilePageHeader.test.ts`
- Modify: `apps/vela-mobile/src/layouts/MobileLayout.vue`
- Modify: `apps/vela-mobile/src/layouts/MobileLayout.test.ts`
- Modify: `apps/vela-mobile/src/css/app.scss`

**Interfaces:**

- Produces:
  - `useKeyboardViewport(options?): { isKeyboardVisible; nativeStatus; lastError }`
  - `MobilePageHeader` reading `route.meta.mobileHeader`
  - bottom tabs using `pushMobileRoute`
  - layout classes driven by `safeAreaPolicy.headerlessTopOwner`

- [ ] **Step 1: Write failing keyboard adapter tests**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  type KeyboardListener,
  type KeyboardListenerEvent,
  useKeyboardViewport,
} from './useKeyboardViewport';

function mountHarness(options: Parameters<typeof useKeyboardViewport>[0]) {
  let state: ReturnType<typeof useKeyboardViewport>;
  const Harness = defineComponent({
    setup() {
      state = useKeyboardViewport(options);
      return () => null;
    },
  });
  const wrapper = mount(Harness);
  return { wrapper, state: state! };
}

describe('useKeyboardViewport', () => {
  it('skips native registration in browser mode', () => {
    const addListener = vi.fn();
    mountHarness({ isNative: () => false, addListener });
    expect(addListener).not.toHaveBeenCalled();
  });

  it('hides on will-show, scrolls after did-show, and restores on did-hide', async () => {
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const remove = vi.fn(async () => undefined);
    const scrollIntoView = vi.fn();
    const addListener = vi.fn(async (name: KeyboardListenerEvent, listener: KeyboardListener) => {
      listeners.set(name, listener);
      return { remove };
    });
    const { state } = mountHarness({
      isNative: () => true,
      addListener,
      getFocusedBlock: () => ({ scrollIntoView }) as unknown as HTMLElement,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    await flushPromises();
    listeners.get('keyboardWillShow')?.();
    expect(state.isKeyboardVisible.value).toBe(true);
    listeners.get('keyboardDidShow')?.();
    await nextTick();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    listeners.get('keyboardDidHide')?.();
    expect(state.isKeyboardVisible.value).toBe(false);
  });

  it('removes every resolved listener handle on unmount', async () => {
    const remove = vi.fn(async () => undefined);
    const { wrapper } = mountHarness({
      isNative: () => true,
      addListener: vi.fn(async () => ({ remove })),
    });
    await flushPromises();
    wrapper.unmount();
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('rolls back partial registration before native callbacks can mutate layout', async () => {
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const remove = vi.fn(async () => undefined);
    const addListener = vi.fn(async (name: KeyboardListenerEvent, listener: KeyboardListener) => {
      listeners.set(name, listener);
      if (name === 'keyboardDidShow') {
        throw new Error('native listener unavailable');
      }
      return { remove };
    });
    const { state, wrapper } = mountHarness({
      isNative: () => true,
      addListener,
    });
    await flushPromises();
    expect(state.nativeStatus.value).toBe('unavailable');
    expect(state.lastError.value).toBe('native listener unavailable');
    expect(remove).toHaveBeenCalledTimes(1);
    listeners.get('keyboardWillShow')?.();
    expect(state.isKeyboardVisible.value).toBe(false);
    wrapper.unmount();
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('repeats settled scrolling when the native viewport resizes', async () => {
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const scrollIntoView = vi.fn();
    mountHarness({
      isNative: () => true,
      addListener: vi.fn(async (name, listener) => {
        listeners.set(name, listener);
        return { remove: vi.fn(async () => undefined) };
      }),
      getFocusedBlock: () => ({ scrollIntoView }) as unknown as HTMLElement,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    await flushPromises();
    listeners.get('keyboardWillShow')?.();
    listeners.get('keyboardDidShow')?.();
    await nextTick();
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('removes the resize listener and cancels a pending frame on unmount', async () => {
    const removeNative = vi.fn(async () => undefined);
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const requestFrame = vi.fn(() => 17);
    const cancelFrame = vi.fn();
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const { wrapper } = mountHarness({
      isNative: () => true,
      addListener: vi.fn(async (name, listener) => {
        listeners.set(name, listener);
        return { remove: removeNative };
      }),
      getFocusedBlock: () => document.createElement('section'),
      requestFrame,
      cancelFrame,
    });
    await flushPromises();
    listeners.get('keyboardWillShow')?.();
    listeners.get('keyboardDidShow')?.();
    await nextTick();
    expect(requestFrame).toHaveBeenCalledOnce();

    wrapper.unmount();

    expect(removeNative).toHaveBeenCalledTimes(3);
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(cancelFrame).toHaveBeenCalledWith(17);
    removeWindow.mockRestore();
  });
});
```

- [ ] **Step 2: Run the focused test and verify the composable is missing**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/composables/useKeyboardViewport.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement typed listener registration and settled scrolling**

Define a narrow adapter instead of inheriting Capacitor's overloaded method
type. This keeps the production wrapper exact while allowing structurally typed
test doubles:

```ts
import { Keyboard, type KeyboardInfo } from '@capacitor/keyboard';
import type { PluginListenerHandle } from '@capacitor/core';

export type KeyboardListenerEvent = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardDidHide';

export type KeyboardListener = (info?: KeyboardInfo) => void;

export type AddKeyboardListener = (
  eventName: KeyboardListenerEvent,
  listener: KeyboardListener,
) => Promise<PluginListenerHandle>;

export type KeyboardViewportOptions = {
  isNative?: () => boolean;
  addListener?: AddKeyboardListener;
  getFocusedBlock?: () => HTMLElement | null;
  requestFrame?: typeof requestAnimationFrame;
  cancelFrame?: typeof cancelAnimationFrame;
};

function addNativeKeyboardListener(
  eventName: KeyboardListenerEvent,
  listener: KeyboardListener,
): Promise<PluginListenerHandle> {
  switch (eventName) {
    case 'keyboardWillShow':
      return Keyboard.addListener(eventName, (info) => listener(info));
    case 'keyboardDidShow':
      return Keyboard.addListener(eventName, (info) => listener(info));
    case 'keyboardDidHide':
      return Keyboard.addListener(eventName, () => listener());
  }
}
```

Register `keyboardWillShow`, `keyboardDidShow`, and `keyboardDidHide`
sequentially behind a `nativeReady` boolean. Listener callbacks return without
changing state until all three handles resolve. If any registration rejects,
set `nativeReady` false, remove every already-resolved handle immediately,
clear the handle list, set `nativeStatus` to `'unavailable'`, and retain the
error message. Keep a mounted flag so handles resolving after unmount are
removed immediately.

Install one named window `resize` listener on mount. On unmount, remove that
listener, set `nativeReady` false, remove all remaining native handles, and
cancel the last pending animation-frame id. On `keyboardDidShow`, await
`nextTick()`, cancel any earlier pending frame, then request one animation
frame and call:

```ts
focusedBlock.scrollIntoView({ block: 'nearest' });
```

While the keyboard is visible and `nativeReady` is true, a window `resize`
event repeats the settled scroll. Set `nativeStatus` to `'browser'`, `'native'`,
or `'unavailable'`; store a rejected registration message in `lastError`.

- [ ] **Step 4: Write failing header and shell integration tests**

Add `beforeEach`, `vi`, and `flushPromises` to the existing Vitest/Test Utils
imports. Install these hoisted native plugin fakes before importing
`MobileLayout.vue`, import `safeAreaPolicy`, then extend
`MobileLayout.test.ts`:

```ts
type TestKeyboardEvent = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardDidHide';

const keyboardListeners = vi.hoisted(
  () => new Map<TestKeyboardEvent, (info?: { keyboardHeight: number }) => void>(),
);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn(
      async (name: TestKeyboardEvent, listener: (info?: { keyboardHeight: number }) => void) => {
        keyboardListeners.set(name, listener);
        return { remove: vi.fn(async () => undefined) };
      },
    ),
  },
}));

beforeEach(() => {
  keyboardListeners.clear();
});
```

Add the table-driven tab cases and shell contracts:

```ts
it.each([
  ['/more', 'Home', '/'],
  ['/', 'Review', '/review'],
  ['/', 'Learn', '/learn'],
  ['/', 'Words', '/words'],
  ['/', 'More', '/more'],
])('delegates %s -> %s to chronological mobile navigation', async (start, label, target) => {
  const wrapper = await mountLayout(start);
  await tabByLabel(wrapper, label).trigger('click');
  await flushPromises();
  expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe(target);
  expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(1);
  expect(tabByLabel(wrapper, label).classes()).toContain('q-tab--active');
});

it('does not duplicate navigation to the active tab', async () => {
  const wrapper = await mountLayout('/more');
  await tabByLabel(wrapper, 'More').trigger('click');
  await flushPromises();
  expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe('/more');
  expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(0);
});

it('removes the footer while the keyboard is visible and restores it once', async () => {
  const wrapper = await mountLayout('/');
  await flushPromises();
  keyboardListeners.get('keyboardWillShow')?.({ keyboardHeight: 320 });
  await nextTick();
  expect(wrapper.findComponent({ name: 'QFooter' }).exists()).toBe(false);
  keyboardListeners.get('keyboardDidHide')?.();
  await nextTick();
  expect(wrapper.findAllComponents({ name: 'QFooter' })).toHaveLength(1);
});

it('applies only the selected headerless-top owner', async () => {
  const wrapper = await mountLayout('/');
  const container = wrapper.getComponent({ name: 'QPageContainer' });
  expect(container.classes()).toContain('mobile-page-container--headerless');
  expect(container.classes().includes('mobile-page-container--css-safe-top')).toBe(
    String(safeAreaPolicy.headerlessTopOwner) === 'css',
  );
});

it('pins horizontal safe areas for fixed header and footer content', () => {
  const appScss = readFileSync(resolve(__dirname, '../css/app.scss'), 'utf8');
  expect(appScss).toContain('.mobile-header .q-toolbar');
  expect(appScss).toContain('.mobile-nav .q-tabs__content');
  expect(appScss).toContain('.mobile-touch-target');
  expect(appScss).toContain('env(safe-area-inset-left, 0px)');
  expect(appScss).toContain('env(safe-area-inset-right, 0px)');
});
```

Also add `readFileSync` from `node:fs` and `resolve` from `node:path` to the
test imports. Keep the existing Quasar dark-mode reset in `afterEach`.

Create `MobilePageHeader.test.ts` cases for:

- title from `route.meta.mobileHeader.title`;
- a `.mobile-back-target` with minimum 44-by-44 CSS;
- `router.back()` when depth is positive;
- fallback replace with depth zero when depth is absent.

- [ ] **Step 5: Implement the metadata header**

Use:

```vue
<q-header v-if="header" class="mobile-header">
  <q-toolbar>
    <q-btn
      flat
      round
      dense
      icon="arrow_back_ios_new"
      class="mobile-back-target mobile-touch-target"
      aria-label="Back"
      @click="back"
    />
    <q-toolbar-title>{{ header.title }}</q-toolbar-title>
  </q-toolbar>
</q-header>
```

The `back` method surfaces fallback navigation failures without leaving a
rejected event-handler promise:

```ts
async function back(): Promise<void> {
  try {
    await backOrFallback(router, header.value.fallback);
  } catch (error) {
    console.error('Mobile header navigation failed', error);
  }
}
```

- [ ] **Step 6: Integrate header, keyboard state, and custom QRouteTab navigation**

In `MobileLayout.vue`:

- render `MobilePageHeader` before `QPageContainer`;
- import `safeAreaPolicy` and compute `hasMobileHeader` from
  `route.meta.mobileHeader`;
- always add `mobile-page-container--headerless` when metadata is absent;
- add `mobile-page-container--css-safe-top` only when metadata is absent and
  `safeAreaPolicy.headerlessTopOwner === 'css'`;
- call `useKeyboardViewport` with a `getFocusedBlock` query for `[data-keyboard-scroll-block]`;
- render `QFooter` with `v-if="!isKeyboardVisible"`;
- keep each `QRouteTab`'s `to` prop for active matching;
- attach `@click="onTabClick($event, '/target')"` to every tab;
- call `event.preventDefault()` synchronously, deliberately do not invoke
  Quasar's emitted `go()` callback, and then call
  `pushMobileRoute(router, target)`;
- catch and log a rejected navigation helper so cancelled/aborted navigation
  never becomes an unhandled promise rejection.

Use this handler:

```ts
function onTabClick(event: Event, target: RouteLocationRaw): void {
  event.preventDefault();
  void pushMobileRoute(router, target).catch((error: unknown) => {
    console.error('Mobile tab navigation failed', error);
  });
}
```

- [ ] **Step 7: Add safe-area and hit-target CSS**

Add:

```scss
.mobile-touch-target,
.mobile-back-target {
  min-width: 44px;
  min-height: 44px;
}

.mobile-safe-x {
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}

.mobile-header .q-toolbar {
  padding-left: max(12px, env(safe-area-inset-left, 0px));
  padding-right: max(12px, env(safe-area-inset-right, 0px));
}

.mobile-nav .q-tabs__content {
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}

body:not(.q-ios-padding) .mobile-page-container--headerless,
.mobile-page-container--css-safe-top {
  padding-top: env(safe-area-inset-top, 0px) !important;
}
```

Retain the existing `body:not(.q-ios-padding) .nav-tabs` bottom fallback. Do
not add custom top/bottom padding to native `QHeader` or `QFooter`; the only
app-owned native top rule is the policy-selected headerless
`QPageContainer`. Horizontal toolbar/tab padding is required in both inset
modes.

- [ ] **Step 8: Run component/composable tests and typecheck**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/composables/useKeyboardViewport.test.ts \
  src/components/mobile/MobilePageHeader.test.ts \
  src/layouts/MobileLayout.test.ts
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src/composables \
  apps/vela-mobile/src/components/mobile/MobilePageHeader.vue \
  apps/vela-mobile/src/components/mobile/MobilePageHeader.test.ts \
  apps/vela-mobile/src/layouts/MobileLayout.vue \
  apps/vela-mobile/src/layouts/MobileLayout.test.ts \
  apps/vela-mobile/src/css/app.scss
rtk git commit -m "feat(mobile): integrate keyboard-safe navigation shell"
```

---

### Task 6: Complete the development-only diagnostic journey

**Files:**

- Create: `apps/vela-mobile/src/diagnostics/ios-interaction-contract.ts`
- Modify: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDiagnosticsPage.vue`
- Create: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDiagnosticsPage.test.ts`
- Modify: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDetailPage.vue`
- Create: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDetailPage.test.ts`
- Modify: `apps/vela-mobile/src/pages/MorePage.vue`
- Modify: `apps/vela-mobile/src/pages/StubPages.test.ts`

**Interfaces:**

- Consumes: JapaneseInputProbe, mobile lifecycle state, mobile navigation, cold-entry staging, typed route metadata.
- Produces:
  - `IOS_INTERACTION_DIAGNOSTICS_MARKER`
  - the two-route physical-validation journey
  - the only application-bundle source literal
    `ios-interaction-diagnostics`

- [ ] **Step 1: Write failing diagnostic-page tests**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IOS_INTERACTION_DIAGNOSTICS_MARKER } from 'src/diagnostics/ios-interaction-contract';
import { resetMobileLifecycleForTests, mobileLifecycleState } from 'src/services/mobile-lifecycle';
import IosInteractionDetailPage from './IosInteractionDetailPage.vue';
import IosInteractionDiagnosticsPage from './IosInteractionDiagnosticsPage.vue';

const ROOT_PATH = '/diagnostics/ios-interactions';
const DETAIL_PATH = '/diagnostics/ios-interactions/detail';

const JourneyHost = defineComponent({
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><router-view /></q-page-container></q-layout>',
});

async function mountJourney() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: ROOT_PATH, component: IosInteractionDiagnosticsPage },
      { path: DETAIL_PATH, component: IosInteractionDetailPage },
    ],
  });
  await router.replace({ path: ROOT_PATH, state: { mobileDepth: 1 } });
  await router.isReady();
  const wrapper = mount(JourneyHost, {
    global: { plugins: [Quasar, router] },
  });
  await flushPromises();
  return { router, wrapper };
}

beforeEach(() => {
  window.localStorage.clear();
  resetMobileLifecycleForTests();
});

describe('iOS interaction diagnostic journey', () => {
  it('renders the canonical marker, Japanese samples, and IME probe', async () => {
    const { wrapper } = await mountJourney();
    expect(wrapper.find(`[data-testid="${IOS_INTERACTION_DIAGNOSTICS_MARKER}"]`).exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain('日本語');
    expect(wrapper.text()).toContain('かな');
    expect(wrapper.findComponent({ name: 'JapaneseInputProbe' }).exists()).toBe(true);
    expect(wrapper.get('[data-testid="ime-model"]').exists()).toBe(true);
  });

  it('pushes Detail and repeats navigation only from the visible Detail control', async () => {
    const { router, wrapper } = await mountJourney();
    await wrapper.get('[data-testid="navigate-detail"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(DETAIL_PATH);
    expect(router.options.history.state.mobileDepth).toBe(2);
    expect(wrapper.find('[data-testid="navigate-detail"]').exists()).toBe(false);

    await wrapper.get('[data-testid="repeat-detail-navigation"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(DETAIL_PATH);
    expect(router.options.history.state.mobileDepth).toBe(2);
  });

  it('pushes in-session entry once, then keeps repeated entry and resume route-neutral', async () => {
    const { router, wrapper } = await mountJourney();
    await wrapper.get('[data-testid="simulate-entry"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(DETAIL_PATH);
    expect(router.options.history.state.mobileDepth).toBe(2);

    await wrapper.get('[data-testid="simulate-entry-again"]').trigger('click');
    await wrapper.get('[data-testid="simulate-resume"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(DETAIL_PATH);
    expect(router.options.history.state.mobileDepth).toBe(2);
    expect(mobileLifecycleState.resumeCount.value).toBe(1);
  });

  it('stages the allowlisted detail route for one cold entry', async () => {
    const { wrapper } = await mountJourney();
    await wrapper.get('[data-testid="stage-cold-entry"]').trigger('click');
    expect(window.localStorage.getItem('vela:dev:ios-interaction-cold-entry')).toBe(DETAIL_PATH);
  });

  it('surfaces an aborted navigation in the visible outcome', async () => {
    const { router, wrapper } = await mountJourney();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    router.beforeEach(() => false);
    await wrapper.get('[data-testid="navigate-detail"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(ROOT_PATH);
    expect(wrapper.get('[data-testid="navigation-outcome"]').text()).toContain(
      'push-detail:failed:',
    );
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('applies the shared 44-point class to every visible diagnostic action', async () => {
    const { wrapper } = await mountJourney();
    for (const selector of [
      '[data-testid="navigate-detail"]',
      '[data-testid="simulate-entry"]',
      '[data-testid="stage-cold-entry"]',
      '[data-testid="ime-done"]',
      '[data-testid="ime-submit"]',
    ]) {
      expect(wrapper.get(selector).classes()).toContain('mobile-touch-target');
    }
  });
});
```

Create `IosInteractionDetailPage.test.ts` with:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { mobileLifecycleState, resetMobileLifecycleForTests } from 'src/services/mobile-lifecycle';
import IosInteractionDetailPage from './IosInteractionDetailPage.vue';

describe('IosInteractionDetailPage', () => {
  it('keeps its route identity and ignores repeated current navigation', async () => {
    resetMobileLifecycleForTests();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/diagnostics/ios-interactions/detail',
          component: IosInteractionDetailPage,
        },
      ],
    });
    await router.replace({
      path: '/diagnostics/ios-interactions/detail',
      state: { mobileDepth: 2 },
    });
    await router.isReady();
    const Host = defineComponent({
      template:
        '<q-layout view="hHh Lpr fFf"><q-page-container><router-view /></q-page-container></q-layout>',
    });
    const wrapper = mount(Host, {
      global: { plugins: [Quasar, router] },
    });
    await flushPromises();

    expect(wrapper.get('[data-testid="detail-route-identity"]').text()).toContain(
      'nested iOS interaction route',
    );
    await wrapper.get('[data-testid="repeat-detail-navigation"]').trigger('click');
    await wrapper.get('[data-testid="simulate-entry-again"]').trigger('click');
    await wrapper.get('[data-testid="simulate-resume"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/diagnostics/ios-interactions/detail');
    expect(router.options.history.state.mobileDepth).toBe(2);
    expect(mobileLifecycleState.resumeCount.value).toBe(1);
    for (const selector of [
      '[data-testid="repeat-detail-navigation"]',
      '[data-testid="simulate-entry-again"]',
      '[data-testid="simulate-resume"]',
    ]) {
      expect(wrapper.get(selector).classes()).toContain('mobile-touch-target');
    }
  });
});
```

In `StubPages.test.ts`, mock the named `config` export with a hoisted mutable
`isDev` getter, reset it before each test, and assert the diagnostic entry
exists when `config.app.isDev` is true and is absent when it is false. Keep the
existing section-label and “Coming soon” coverage.

- [ ] **Step 2: Run the focused tests and verify the minimal pages fail the contract**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/pages/diagnostics src/pages/StubPages.test.ts
```

Expected: FAIL because the marker, controls, and More entry are absent.

- [ ] **Step 3: Build the diagnostic page structure**

Create the marker contract:

```ts
export const IOS_INTERACTION_DIAGNOSTICS_MARKER = 'ios-interaction-diagnostics';
```

Import that constant into `IosInteractionDiagnosticsPage.vue`. The root
element must be:

```vue
<q-page
  padding
  class="mobile-safe-x ios-interaction-page"
  :data-testid="IOS_INTERACTION_DIAGNOSTICS_MARKER"
  @pointerdown.self="dismissFocusedControl"
>
```

Include these exact sections:

- selectable `かな`, `カタカナ`, `日本語`, and `日本語を勉強しています。`;
- scroll-stress content before and after the form;
- `<JapaneseInputProbe data-keyboard-scroll-block />`;
  - current route, current `mobileDepth`, keyboard visibility/status/error,
    orientation, resume count, and
    `<div data-testid="navigation-outcome">{{ lastNavigationOutcome }}</div>`;
- `mobile-touch-target` buttons with `data-testid` values `navigate-detail`,
  `simulate-entry`, and `stage-cold-entry`;
- concise Japanese keyboard instructions matching the design scenario.

Use `pushMobileRoute` for detail navigation, `enterMobileRoute` for in-session
entry simulation, and
`stageDiagnosticColdEntry(window.localStorage, IOS_DIAGNOSTIC_DETAIL_PATH)` for
the one-shot action. Both asynchronous navigation buttons call this exact
failure-recording wrapper:

Import `ref` from Vue; `useRouter`; `MobileNavigationResult`,
`enterMobileRoute`, and `pushMobileRoute`; both diagnostic path constants; and
`stageDiagnosticColdEntry`.

```ts
const allowedDiagnosticEntries = new Set([IOS_DIAGNOSTIC_ROOT_PATH, IOS_DIAGNOSTIC_DETAIL_PATH]);
const lastNavigationOutcome = ref('none');

async function recordNavigation(
  label: string,
  action: () => Promise<MobileNavigationResult>,
): Promise<void> {
  try {
    const result = await action();
    lastNavigationOutcome.value = `${label}:${result.kind}:${result.fullPath}:depth=${result.depth}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastNavigationOutcome.value = `${label}:failed:${message}`;
    console.error(`Diagnostic navigation failed (${label})`, error);
  }
}
```

The root actions are:

```ts
const openDetail = () =>
  recordNavigation('push-detail', () => pushMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH));

const simulateEntry = () =>
  recordNavigation('entry-detail', () =>
    enterMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH, allowedDiagnosticEntries),
  );

function stageColdEntry(): void {
  stageDiagnosticColdEntry(window.localStorage, IOS_DIAGNOSTIC_DETAIL_PATH);
  lastNavigationOutcome.value = `cold-entry:staged:${IOS_DIAGNOSTIC_DETAIL_PATH}`;
}
```

Bind the three root actions with:

```vue
<q-btn
  data-testid="navigate-detail"
  class="mobile-touch-target"
  label="Navigate to detail"
  @click="openDetail"
/>
<q-btn
  data-testid="simulate-entry"
  class="mobile-touch-target"
  label="Enter detail in this session"
  @click="simulateEntry"
/>
<q-btn
  data-testid="stage-cold-entry"
  class="mobile-touch-target"
  label="Stage cold entry"
  @click="stageColdEntry"
/>
```

- [ ] **Step 4: Complete the detail page**

Render:

```vue
<q-page padding class="mobile-safe-x">
  <section class="column q-gutter-md">
    <h1 class="text-h5">Navigation Detail</h1>
    <p data-testid="detail-route-identity">
      This is the nested iOS interaction route.
    </p>
    <q-btn
      data-testid="repeat-detail-navigation"
      class="mobile-touch-target"
      label="Navigate to this detail again"
      @click="repeatCurrentRoute"
    />
    <q-btn
      data-testid="simulate-entry-again"
      class="mobile-touch-target"
      label="Deliver this route entry again"
      @click="repeatRouteEntry"
    />
    <q-btn
      data-testid="simulate-resume"
      class="mobile-touch-target"
      label="Simulate resume"
      @click="simulateResume"
    />
    <div data-testid="detail-navigation-outcome">
      Last outcome: {{ lastNavigationOutcome }}
    </div>
    <p>
      Test the visible header back control, native left-edge swipe-back, and
      native swipe-forward from this page.
    </p>
  </section>
</q-page>
```

Use these exact Detail actions:

Import `ref`, `useRoute`, `useRouter`, `MobileNavigationResult`,
`enterMobileRoute`, `pushMobileRoute`, both diagnostic path constants, and
`recordAppResume`.

```ts
const allowedDiagnosticEntries = new Set([IOS_DIAGNOSTIC_ROOT_PATH, IOS_DIAGNOSTIC_DETAIL_PATH]);
const lastNavigationOutcome = ref('none');

async function recordNavigation(
  label: string,
  action: () => Promise<MobileNavigationResult>,
): Promise<void> {
  try {
    const result = await action();
    lastNavigationOutcome.value = `${label}:${result.kind}:${result.fullPath}:depth=${result.depth}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastNavigationOutcome.value = `${label}:failed:${message}`;
    console.error(`Diagnostic navigation failed (${label})`, error);
  }
}

const repeatCurrentRoute = () =>
  recordNavigation('repeat-push', () => pushMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH));

const repeatRouteEntry = () =>
  recordNavigation('repeat-entry', () =>
    enterMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH, allowedDiagnosticEntries),
  );

function simulateResume(): void {
  recordAppResume();
  lastNavigationOutcome.value = `resume:preserved:${route.fullPath}`;
}
```

- [ ] **Step 5: Add the development-only More entry**

Import `{ config }` and render the entry only with:

```vue
<q-item
  v-if="config.app.isDev"
  clickable
  data-testid="ios-interaction-entry"
  @click="openDiagnostics"
>
  <q-item-section avatar><q-icon name="developer_mode" /></q-item-section>
  <q-item-section>
    <q-item-label>iOS Interaction Diagnostics</q-item-label>
    <q-item-label caption>IME, keyboard, safe areas, and navigation</q-item-label>
  </q-item-section>
</q-item>
```

Use:

```ts
function openDiagnostics(): void {
  void pushMobileRoute(router, IOS_DIAGNOSTIC_ROOT_PATH).catch((error: unknown) => {
    console.error('Opening iOS interaction diagnostics failed', error);
  });
}
```

- [ ] **Step 6: Run diagnostic, route, and shell tests**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/pages/diagnostics \
  src/pages/StubPages.test.ts \
  src/router \
  src/layouts/MobileLayout.test.ts
rtk bun run test:coverage
```

Expected: PASS, including the configured 95% mobile line-coverage threshold.

- [ ] **Step 7: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src/pages/diagnostics \
  apps/vela-mobile/src/diagnostics/ios-interaction-contract.ts \
  apps/vela-mobile/src/pages/MorePage.vue \
  apps/vela-mobile/src/pages/StubPages.test.ts
rtk git commit -m "feat(mobile): add iOS interaction diagnostics"
```

---

### Task 7: Verify diagnostics are absent from the shipped Capacitor artifact

**Files:**

- Create: `apps/vela-mobile/scripts/verify-production-diagnostics.mjs`
- Create: `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs`
- Modify: `apps/vela-mobile/package.json`

**Interfaces:**

- Consumes: `IOS_INTERACTION_DIAGNOSTICS_MARKER`
- Produces:
  - `findDiagnosticMarker(root, marker): Promise<string[]>`
  - `build:ios:assets`
  - `verify:production-diagnostics`

- [ ] **Step 1: Write failing scanner tests**

```js
// @vitest-environment node
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IOS_INTERACTION_DIAGNOSTICS_MARKER } from '../src/diagnostics/ios-interaction-contract.ts';
import { findDiagnosticMarker } from './verify-production-diagnostics.mjs';

describe('verify-production-diagnostics', () => {
  it('returns no files when emitted JavaScript excludes the marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await writeFile(join(root, 'app.js'), 'console.log(\"production\")');
    expect(await findDiagnosticMarker(root, IOS_INTERACTION_DIAGNOSTICS_MARKER)).toEqual([]);
  });

  it('finds the marker in nested emitted JavaScript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await mkdir(join(root, 'assets'));
    await writeFile(
      join(root, 'assets', 'diagnostic.js'),
      `const marker=${JSON.stringify(IOS_INTERACTION_DIAGNOSTICS_MARKER)}`,
    );
    expect(await findDiagnosticMarker(root, IOS_INTERACTION_DIAGNOSTICS_MARKER)).toEqual([
      join(root, 'assets', 'diagnostic.js'),
    ]);
  });

  it('ignores non-JavaScript assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await writeFile(join(root, 'notes.txt'), IOS_INTERACTION_DIAGNOSTICS_MARKER);
    expect(await findDiagnosticMarker(root, IOS_INTERACTION_DIAGNOSTICS_MARKER)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify the scanner module is missing**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run scripts/verify-production-diagnostics.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement recursive `.js` scanning and a failing CLI**

The script must:

- recursively enumerate directories with `readdir(..., { withFileTypes: true })`;
- read only files ending in `.js`;
- return sorted absolute matching paths from `findDiagnosticMarker`;
- convert `new URL('../src-capacitor/www/', import.meta.url)` with
  `fileURLToPath(...)` for the default absolute scan root;
- print matching relative paths and exit 1 when the marker is found;
- print the scanned root and exit 0 when absent;
- fail clearly if `src-capacitor/www` does not exist.

Use:

```js
import { fileURLToPath } from 'node:url';
import { IOS_INTERACTION_DIAGNOSTICS_MARKER } from '../src/diagnostics/ios-interaction-contract.ts';

const defaultRoot = fileURLToPath(new URL('../src-capacitor/www/', import.meta.url));

if (import.meta.main) {
  const matches = await findDiagnosticMarker(defaultRoot, IOS_INTERACTION_DIAGNOSTICS_MARKER);
  if (matches.length > 0) {
    console.error(`Production diagnostics marker found:\n${matches.join('\n')}`);
    process.exit(1);
  }
  console.log(`No production diagnostics marker found under ${defaultRoot}`);
}
```

- [ ] **Step 4: Add exact package scripts**

Add:

```json
"build:ios:assets": "bun run sync:ios-version && quasar build -m capacitor -T ios --skip-pkg",
"verify:production-diagnostics": "bun run build:ios:assets && bun run scripts/verify-production-diagnostics.mjs"
```

- [ ] **Step 5: Run scanner tests**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run scripts/verify-production-diagnostics.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Build the real production Capacitor asset and scan it**

This is a local macOS pre-merge gate, not an `ubuntu-latest` CI command.
Quasar runs `cap sync ios` and CocoaPods before honoring `--skip-pkg`. On
macOS, run:

```bash
# workdir: apps/vela-mobile
rtk env VITE_MOBILE_API_URL=https://example.invalid/api/ bun run verify:production-diagnostics
```

Expected: the Capacitor production build fills `src-capacitor/www`, the scanner checks its emitted JavaScript, and the marker is absent.

- [ ] **Step 7: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/scripts/verify-production-diagnostics.mjs \
  apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs \
  apps/vela-mobile/package.json
rtk git commit -m "test(mobile): verify diagnostics stay out of production"
```

---

### Task 8: Wire the app-owned native bridge controller

**Files:**

- Create: `apps/vela-mobile/src-capacitor/ios/App/App/VelaBridgeViewController.swift`
- Create: `apps/vela-mobile/src/ios/native-interaction-contract.test.ts`
- Modify: `apps/vela-mobile/src-capacitor/ios/App/App/Base.lproj/Main.storyboard`
- Modify: `apps/vela-mobile/src-capacitor/ios/App/App.xcodeproj/project.pbxproj`

**Interfaces:**

- Produces: storyboard-instantiated `App.VelaBridgeViewController` with WKWebView back/forward gestures enabled.

- [ ] **Step 1: Write the failing native contract test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const iosRoot = resolve(__dirname, '../../src-capacitor/ios/App');
const swift = readFileSync(resolve(iosRoot, 'App/VelaBridgeViewController.swift'), 'utf8');
const storyboard = readFileSync(resolve(iosRoot, 'App/Base.lproj/Main.storyboard'), 'utf8');
const project = readFileSync(resolve(iosRoot, 'App.xcodeproj/project.pbxproj'), 'utf8');

describe('native interaction bridge contract', () => {
  it('subclasses the Capacitor bridge and enables native gestures', () => {
    expect(swift).toContain('final class VelaBridgeViewController: CAPBridgeViewController');
    expect(swift).toContain('override func capacitorDidLoad()');
    expect(swift).toContain('super.capacitorDidLoad()');
    expect(swift).toContain('webView?.allowsBackForwardNavigationGestures = true');
  });

  it('wires the storyboard to the App target module', () => {
    expect(storyboard).toContain('customClass=\"VelaBridgeViewController\"');
    expect(storyboard).toContain('customModule=\"App\"');
    expect(storyboard).toContain('customModuleProvider=\"target\"');
  });

  it('adds the Swift file to the application Sources phase', () => {
    expect(project).toContain('VelaBridgeViewController.swift');
    expect(project).toContain('VelaBridgeViewController.swift in Sources');
  });
});
```

- [ ] **Step 2: Run the test and verify the missing Swift file fails**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/ios/native-interaction-contract.test.ts
```

Expected: FAIL at module load because the Swift file does not exist.

- [ ] **Step 3: Add the Swift subclass**

```swift
import Capacitor

final class VelaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
```

- [ ] **Step 4: Update the storyboard module contract**

Replace the root view-controller element with:

```xml
<viewController id="BYZ-38-t0r" customClass="VelaBridgeViewController" customModule="App" customModuleProvider="target" sceneMemberID="viewController"/>
```

- [ ] **Step 5: Add the Swift file to the Xcode project**

Use these unused stable pbxproj identifiers:

```text
A20900012D00000100000001 /* VelaBridgeViewController.swift */
A20900022D00000100000001 /* VelaBridgeViewController.swift in Sources */
```

Add:

```text
A20900022D00000100000001 /* VelaBridgeViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = A20900012D00000100000001 /* VelaBridgeViewController.swift */; };
A20900012D00000100000001 /* VelaBridgeViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = VelaBridgeViewController.swift; sourceTree = "<group>"; };
```

Add the file reference to the `App` group and the build-file reference to `504EC3001FED79650016851F /* Sources */`.

- [ ] **Step 6: Run the contract test**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/ios/native-interaction-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Build the iOS simulator target**

Use XcodeBuildMCP in this order:

1. `session_show_defaults`
2. `session_set_defaults` with workspace `apps/vela-mobile/src-capacitor/ios/App/App.xcworkspace`, scheme `App`, and an available iPhone simulator
3. `build_sim`

Expected: Swift compilation and storyboard instantiation complete successfully without signing.

- [ ] **Step 8: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src-capacitor/ios/App/App/VelaBridgeViewController.swift \
  apps/vela-mobile/src-capacitor/ios/App/App/Base.lproj/Main.storyboard \
  apps/vela-mobile/src-capacitor/ios/App/App.xcodeproj/project.pbxproj \
  apps/vela-mobile/src/ios/native-interaction-contract.test.ts
rtk git commit -m "feat(mobile): enable native WebView swipe history"
```

---

### Task 9: Record reusable guidance and complete the verification gates

**Files:**

- Modify: `apps/vela-mobile/docs/ios-interaction-baseline.md`
- Modify: `apps/vela-mobile/README.md`

**Interfaces:**

- Consumes: all implementation tasks and the exact physical scenarios from the design.
- Produces: durable simulator/device evidence and reusable shell guidance.

- [ ] **Step 1: Extend the checked-in evidence document**

Preserve Task 0's safe-area measurements and selected policy. Add these exact
result rules and matrix columns:

```markdown
## Result policy

- Record a row only after running that environment.
- Put the exact tested commit SHA in every environment row.
- Record whether the row used Debug development, Release smoke, or production
  Capacitor assets.
- Record whether the WebView loaded from the LAN development server or
  packaged assets.
- A failure includes reproduction steps and a linked follow-up issue.
- Physical Japanese IME and WKWebView swipe results are release-blocking.

## Environment matrix

| Environment | Commit | Build configuration | Asset source | Model | OS  | Xcode | Japanese keyboard | Orientation | Result |
| ----------- | ------ | ------------------- | ------------ | ----- | --- | ----- | ----------------- | ----------- | ------ |

## Japanese IME evidence

Record the exact draft, committed, bound-model, post-render native-input, and
submitted values observed for `日本語`.

## Keyboard, safe-area, and orientation evidence

Record keyboard-open portrait, keyboard-open rotation to landscape, focused
block visibility, Submit reachability, footer restoration, and inset ownership.

## Navigation evidence

Record visible back, native swipe-back, swipe-forward, Detail-to-Home tab
history, in-session entry back/forward, cold entry, resume, duplicate
navigation, the observed WebKit transition type, functional completion, and
exit/trap behavior.

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
```

Do not pre-populate unrun environments with passing results.

- [ ] **Step 2: Update the mobile README**

Add:

- the diagnostic route and development-only More entry;
- Japanese native keyboard setup;
- the `build:ios:assets` and `verify:production-diagnostics` commands;
- the fact that the real Capacitor artifact scan is a local macOS pre-merge
  gate because it runs `cap sync ios`;
- chronological tab/swipe history behavior;
- unique-push in-session entry versus depth-zero cold-entry behavior;
- the M2 revisit point for bounded or tab-specific history;
- safe-area ownership rules;
- app-level resume rule;
- a link to `docs/ios-interaction-baseline.md`;
- the physical-device completion requirement.

- [ ] **Step 3: Run the complete automated verification**

Run:

```bash
# workdir: apps/vela-mobile
rtk bun run test:unit
rtk bun run test:coverage
rtk bun run lint
rtk bun run typecheck
rtk env VITE_MOBILE_API_URL=https://example.invalid/api/ bun run build
```

Expected: all commands exit 0, including the configured 95% line threshold.

On macOS, run the real production artifact gate and final native sync:

```bash
# workdir: apps/vela-mobile
rtk env VITE_MOBILE_API_URL=https://example.invalid/api/ bun run verify:production-diagnostics
# workdir: apps/vela-mobile/src-capacitor
rtk bunx cap sync ios
```

Expected: both commands exit 0, and the scanner reports no diagnostic marker
under `src-capacitor/www`.

- [ ] **Step 4: Run simulator validation**

Start the development Capacitor build and keep its LAN server running:

```bash
# workdir: apps/vela-mobile
rtk bun run dev:ios
```

Use XcodeBuildMCP to build and launch the synchronized Debug development app
on:

- one small-screen iPhone simulator in portrait and landscape;
- one Dynamic Island simulator.

Record `Debug development` and `LAN development server` in every diagnostic
row. Record only observed results. While the keyboard remains open, rotate
from portrait to landscape and verify the focused block and Submit remain
reachable. Dismiss the keyboard and verify the footer returns once without
stale space or doubled inset.

- [ ] **Step 5: Run the physical Japanese IME scenario**

Run the development-only diagnostics on a connected iPhone with a Japanese
keyboard. Record `Debug development` and `LAN development server`:

1. Enter `にほんご`.
2. Select `日本語`.
3. Press Return while composition/candidate selection is active.
4. Verify no premature submission.
5. Finish composition.
6. Press Return again or tap Submit.
7. Record that the model, draft, committed, submitted, and visible native-input
   values are exactly `日本語`.

- [ ] **Step 6: Run the physical history scenario**

1. Open More, Diagnostics, and Detail.
2. Use visible back.
3. Re-enter Detail and use native swipe-back.
4. Use native swipe-forward.
5. From Detail, tap Home.
6. Swipe back and verify the exact Detail page returns at completion. A
   WebKit snapshot or cross-fade during the gesture is acceptable; a blank
   frame is not.
7. Swipe forward and verify Home returns.
8. Repeat current-route navigation and verify depth is unchanged.
9. Background/resume and verify the route is preserved.
10. Return to the diagnostic root and perform the in-session entry to Detail.
11. Repeat entry from Detail and verify it is a depth-preserving no-op.
12. Swipe back and confirm the diagnostic root returns, then swipe forward and
    confirm Detail and its entry depth return.
13. Simulate resume from Detail and verify the route is preserved.
14. Alternate Home and Review twenty times.
15. Traverse backward repeatedly and record whether the chronological policy
    remains usable or should change in M2.
16. Stage Detail, terminate, relaunch, and verify one-shot cold entry.
17. Verify fresh-entry swipe-back is a no-op while header fallback reaches the
    diagnostic root.
18. Record any blank frame, unexpected final route, exit, or trap as a
    blocking failure.

- [ ] **Step 7: Run a Release core-shell smoke pass**

Use XcodeBuildMCP in this order:

1. `session_show_defaults`
2. `session_set_defaults` with workspace
   `apps/vela-mobile/src-capacitor/ios/App/App.xcworkspace`, scheme `App`, an
   available iPhone simulator, and configuration `Release`
3. `build_run_sim`

This launches the packaged WebView assets produced by the macOS artifact gate.
Diagnostics must be absent. Record:

- Home and More launch successfully;
- the footer and its first/last tabs avoid every tested safe-area edge;
- portrait and both landscape directions remain operable;
- the selected Task 0 inset policy still produces one top/bottom inset;
- build configuration is `Release smoke` and asset source is
  `packaged WebView assets`.

- [ ] **Step 8: Fill the evidence document with observed values**

Use:

```bash
# workdir: repository root
rtk git rev-parse HEAD
rtk xcodebuild -version
```

Record the actual commit, Xcode version, build configurations, asset sources,
device models, OS versions, Japanese keyboard layout, orientations, results,
and reproduction details. Do not infer or copy values from another run.

- [ ] **Step 9: Run final repository verification after documentation**

Run:

```bash
# workdir: apps/vela-mobile
rtk bun run test:unit
rtk bun run test:coverage
rtk bun run lint
rtk bun run typecheck
# workdir: repository root
rtk git diff --check
rtk git status --short
```

Expected: tests, the 95% coverage threshold, lint, typecheck, and diff check
pass; status contains only the intended README/evidence changes.

- [ ] **Step 10: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/README.md \
  apps/vela-mobile/docs/ios-interaction-baseline.md
rtk git commit -m "docs(mobile): record iOS interaction baseline"
```

---

## Final Acceptance Gate

Before reporting HPA-209 complete:

- Confirm every task commit is present.
- Confirm Task 0 selected and recorded one safe-area owner before harness work.
- Re-run `bun run test:unit`, `bun run test:coverage`, `bun run lint`,
  `bun run typecheck`, `bun run build`, and the real macOS Capacitor
  production marker scan.
- Confirm the simulator build succeeds after the final `cap sync ios`.
- Confirm the evidence document names the exact tested commit, build
  configuration, and LAN-versus-packaged asset source for every row.
- Confirm physical Japanese IME submission preserves `日本語` exactly.
- Confirm the bound model and native input still contain `日本語` after the
  post-composition render.
- Confirm native back, forward, and tab-switch history—including twenty
  alternating tab switches—matches the chronological M1 policy without blank
  frames, wrong final routes, exit, or trap.
- Confirm an in-session entry pushes once, back returns to the exact prior
  route, forward restores the entry, repeated delivery is a no-op, and cold
  entry alone replaces at depth zero.
- Confirm the Release packaged-assets smoke row passes with diagnostics absent.
- If a physical device is unavailable or either physical scenario fails, report HPA-209 as blocked rather than complete.
