# Mobile iOS Interaction Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and physically verify the HPA-209 diagnostic journey and reusable iOS shell contracts for Japanese IME input, keyboard resizing, safe areas, lifecycle, and native WKWebView history.

**Architecture:** Keep the diagnostic UI development-only while shipping the reusable keyboard, layout, lifecycle, and navigation policies. Vue Router owns one chronological hash-history stack with app-owned `mobileDepth`; Capacitor supplies typed Keyboard and App events; an app-owned `CAPBridgeViewController` enables native back/forward gestures. Automated tests cover browser-observable and committed-native contracts, while simulator and physical-iPhone evidence remain the authority for IME and interactive swipe behavior.

**Tech Stack:** Vue 3, Quasar 2, Vue Router 4, Capacitor 7, TypeScript 5.6, Vitest 3, Swift 5, Xcode 16+

## Global Constraints

- Work from an isolated worktree created with `superpowers:using-git-worktrees` before changing product code.
- Keep `@capacitor/keyboard` on Capacitor major 7 and install it only under `apps/vela-mobile/src-capacitor`.
- Preserve `ios.contentInset: "always"` and configure Keyboard resize as `"native"`.
- Keep the diagnostic entry, routes, pages, cold-entry key, and marker out of production bundles.
- Use the exact production-exclusion token `ios-interaction-diagnostics`.
- Verify production exclusion against `apps/vela-mobile/src-capacitor/www/**/*.js`, not the SPA `dist` directory.
- Route ordinary links and all five bottom tabs through one unique-push helper with app-owned `mobileDepth`.
- M1 uses chronological browser history; it does not emulate independent native tab stacks.
- Use `router.replace` with `mobileDepth: 0` only for validated route-entry events and header fallbacks.
- Never use `window.history.length` or Vue Router's internal `back` state as an app-history predicate.
- Never await `router.isReady()` from the development cold-entry boot file.
- Handle submission on native `keydown` and block it while either tracked composition state or `KeyboardEvent.isComposing` is true.
- Do not write in-progress native IME input back through the QInput model.
- Use standard Quasar `QHeader` and `QFooter` safe-area ownership; custom page CSS owns only left/right insets on native iOS.
- Do not add a JavaScript swipe recognizer, third-party gesture plugin, native navigation controller, universal link, or new custom scheme.
- Resume observation never navigates unless a separately validated route-entry event is consumed.
- HPA-209 cannot be marked complete without physical-iPhone IME and native-swipe evidence.
- Production mobile builds require a valid absolute HTTPS `VITE_MOBILE_API_URL`.

---

## File Map

### Create

- `apps/vela-mobile/src/ios/capacitor-plugins.test.ts` — dependency, config, and Vitest-resolution contracts.
- `apps/vela-mobile/src/router/mobile-navigation.ts` — unique push, validated replace, depth reading, and back/fallback.
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
- `apps/vela-mobile/src/pages/diagnostics/IosInteractionDetailPage.test.ts` — metadata and duplicate-navigation control.
- `apps/vela-mobile/scripts/verify-production-diagnostics.mjs` — recursive emitted-JavaScript marker scanner.
- `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs` — scanner positive and negative cases.
- `apps/vela-mobile/src-capacitor/ios/App/App/VelaBridgeViewController.swift` — native WKWebView gesture enablement.
- `apps/vela-mobile/src/ios/native-interaction-contract.test.ts` — Swift, storyboard, and pbxproj contracts.
- `apps/vela-mobile/docs/ios-interaction-baseline.md` — checked-in simulator/device evidence.

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

Set `capacitor.config.json` to:

```json
{
  "appId": "com.vela.app",
  "appName": "Vela",
  "webDir": "www",
  "ios": {
    "contentInset": "always"
  },
  "plugins": {
    "Keyboard": {
      "resize": "native"
    }
  }
}
```

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
  - `backOrFallback(router: Router, fallback: RouteLocationRaw): Promise<MobileNavigationResult>`
  - `mobileScrollBehavior: RouterScrollBehavior`
  - `IOS_DIAGNOSTIC_ROOT_PATH` and `IOS_DIAGNOSTIC_DETAIL_PATH`
  - `buildMobileChildRoutes(diagnosticRoutes?: RouteRecordRaw[]): RouteRecordRaw[]`

- [ ] **Step 1: Write failing navigation and scroll tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import {
  backOrFallback,
  enterMobileRoute,
  pushMobileRoute,
  readMobileDepth,
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

  it('replaces allowed entry at depth zero', async () => {
    const router = makeRouter();
    await router.replace('/');
    await enterMobileRoute(router, '/detail', new Set(['/detail']));
    expect(router.currentRoute.value.fullPath).toBe('/detail');
    expect(readMobileDepth(router)).toBe(0);
  });

  it('treats repeated route entry as a depth-preserving no-op', async () => {
    const router = makeRouter();
    await router.replace('/');
    await enterMobileRoute(router, '/detail', new Set(['/detail']));
    const result = await enterMobileRoute(router, '/detail', new Set(['/detail']));
    expect(result.kind).toBe('noop');
    expect(readMobileDepth(router)).toBe(0);
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
import type { RouteLocationRaw, RouteLocationResolved, Router } from 'vue-router';

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
  await router.push(routeLocation(resolved, nextDepth));
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
  await router.replace(routeLocation(resolved, 0));
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
  await router.replace(routeLocation(resolved, 0));
  return { kind: 'fallback', fullPath: resolved.fullPath, depth: 0 };
}
```

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
import { enterMobileRoute, type MobileNavigationResult } from 'src/router/mobile-navigation';

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
  return enterMobileRoute(router, target, allowedDiagnosticEntries);
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

- Produces a self-contained probe with `draft`, `committed`, `submitted`, and `isComposing` readouts.
- Exposes no normalized or trimmed answer value.

- [ ] **Step 1: Write failing native-event component tests**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
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
  isComposing.value = false;
  committed.value = nativeValue(event);
  draft.value = nativeValue(event);
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
<div data-testid="ime-draft">Draft: {{ draft }}</div>
<div data-testid="ime-committed">Committed: {{ committed }}</div>
<div data-testid="ime-submitted">Submitted: {{ submitted }}</div>
<div data-testid="ime-composing">
  Composing: {{ isComposing ? 'yes' : 'no' }}
</div>
<q-btn data-testid="ime-done" label="Done" @click="qInput?.nativeEl?.blur()" />
<q-btn data-testid="ime-submit" label="Submit" color="primary" @click="submitExactValue" />
```

- [ ] **Step 4: Add button, background-dismissal, and listener-cleanup cases**

Add tests that:

- dispatch an ordinary non-composing `input` and Submit click and expect exact whitespace-preserving output;
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

- [ ] **Step 1: Write failing keyboard adapter tests**

```ts
import { mount } from '@vue/test-utils';
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
    await nextTick();
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
    await nextTick();
    wrapper.unmount();
    await nextTick();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('surfaces listener registration failure and keeps resolved handles removable', async () => {
    const remove = vi.fn(async () => undefined);
    const addListener = vi
      .fn()
      .mockResolvedValueOnce({ remove })
      .mockRejectedValueOnce(new Error('native listener unavailable'));
    const { state, wrapper } = mountHarness({
      isNative: () => true,
      addListener,
    });
    await flushPromises();
    expect(state.nativeStatus.value).toBe('unavailable');
    expect(state.lastError.value).toBe('native listener unavailable');
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

Register `keyboardWillShow`, `keyboardDidShow`, and `keyboardDidHide` sequentially so already-resolved handles remain removable if a later registration rejects. Keep a mounted flag so handles resolving after unmount are removed immediately. On `keyboardDidShow`, await `nextTick()`, then request one animation frame, then call:

```ts
focusedBlock.scrollIntoView({ block: 'nearest' });
```

While the keyboard is visible, a window `resize` event repeats the settled scroll. Set `nativeStatus` to `'browser'`, `'native'`, or `'unavailable'`; store a rejected registration message in `lastError`.

- [ ] **Step 4: Write failing header and shell integration tests**

Extend `MobileLayout.test.ts` with a table-driven test covering every tab:

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
  await nextTick();
  expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe(target);
  expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(1);
});

it('does not duplicate navigation to the active tab', async () => {
  const wrapper = await mountLayout('/more');
  await tabByLabel(wrapper, 'More').trigger('click');
  await nextTick();
  expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe('/more');
  expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(0);
});

it('removes the footer while the keyboard is visible and restores it once', async () => {
  keyboardListeners.get('keyboardWillShow')?.();
  await nextTick();
  expect(wrapper.findComponent({ name: 'QFooter' }).exists()).toBe(false);
  keyboardListeners.get('keyboardDidHide')?.();
  await nextTick();
  expect(wrapper.findAllComponents({ name: 'QFooter' })).toHaveLength(1);
});
```

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
      class="mobile-back-target"
      aria-label="Back"
      @click="back"
    />
    <q-toolbar-title>{{ header.title }}</q-toolbar-title>
  </q-toolbar>
</q-header>
```

The `back` method calls:

```ts
await backOrFallback(router, header.value.fallback);
```

- [ ] **Step 6: Integrate header, keyboard state, and custom QRouteTab navigation**

In `MobileLayout.vue`:

- render `MobilePageHeader` before `QPageContainer`;
- call `useKeyboardViewport` with a `getFocusedBlock` query for `[data-keyboard-scroll-block]`;
- render `QFooter` with `v-if="!isKeyboardVisible"`;
- keep each `QRouteTab`'s `to` prop for active matching;
- attach `@click="onTabClick($event, '/target')"` to every tab;
- call `event.preventDefault()` and then `pushMobileRoute(router, target)`.

Use this handler:

```ts
function onTabClick(event: Event, target: RouteLocationRaw): void {
  event.preventDefault();
  void pushMobileRoute(router, target);
}
```

- [ ] **Step 7: Add safe-area and hit-target CSS**

Add:

```scss
.mobile-back-target {
  min-width: 44px;
  min-height: 44px;
}

.mobile-safe-x {
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
```

Retain the existing `body:not(.q-ios-padding) .nav-tabs` bottom fallback and do not add native top/bottom padding to `QHeader`, `QFooter`, or `QPage`.

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

- Modify: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDiagnosticsPage.vue`
- Create: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDiagnosticsPage.test.ts`
- Modify: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDetailPage.vue`
- Create: `apps/vela-mobile/src/pages/diagnostics/IosInteractionDetailPage.test.ts`
- Modify: `apps/vela-mobile/src/pages/MorePage.vue`
- Modify: `apps/vela-mobile/src/pages/StubPages.test.ts`

**Interfaces:**

- Consumes: JapaneseInputProbe, mobile lifecycle state, mobile navigation, cold-entry staging, typed route metadata.
- Produces: the two-route physical-validation journey and the only application-bundle source literal `data-testid="ios-interaction-diagnostics"`.

- [ ] **Step 1: Write failing diagnostic-page tests**

```ts
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import IosInteractionDiagnosticsPage from './IosInteractionDiagnosticsPage.vue';

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/diagnostics/ios-interactions', component: IosInteractionDiagnosticsPage },
      {
        path: '/diagnostics/ios-interactions/detail',
        component: { template: '<div>detail</div>' },
      },
    ],
  });
  await router.replace({
    path: '/diagnostics/ios-interactions',
    state: { mobileDepth: 1 },
  });
  await router.isReady();
  return mount(IosInteractionDiagnosticsPage, {
    global: { plugins: [Quasar, router] },
  });
}

describe('IosInteractionDiagnosticsPage', () => {
  it('renders the canonical production-exclusion marker', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="ios-interaction-diagnostics"]').exists()).toBe(true);
  });

  it('renders selectable Japanese samples and the IME probe', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('日本語');
    expect(wrapper.text()).toContain('かな');
    expect(wrapper.findComponent({ name: 'JapaneseInputProbe' }).exists()).toBe(true);
  });

  it('pushes detail once and ignores repeated current-route navigation', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="navigate-detail"]').trigger('click');
    expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe(
      '/diagnostics/ios-interactions/detail',
    );
    const depth = wrapper.vm.$router.options.history.state.mobileDepth;
    await wrapper.get('[data-testid="navigate-detail"]').trigger('click');
    expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(depth);
  });

  it('applies repeated route entry once and resume preserves it', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="simulate-entry"]').trigger('click');
    expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe(
      '/diagnostics/ios-interactions/detail',
    );
    expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(0);
    await wrapper.get('[data-testid="simulate-entry-again"]').trigger('click');
    await wrapper.get('[data-testid="simulate-resume"]').trigger('click');
    expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe(
      '/diagnostics/ios-interactions/detail',
    );
    expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(0);
  });

  it('stages the allowlisted detail route for one cold entry', async () => {
    const wrapper = await mountPage();
    window.localStorage.clear();
    await wrapper.get('[data-testid="stage-cold-entry"]').trigger('click');
    expect(window.localStorage.getItem('vela:dev:ios-interaction-cold-entry')).toBe(
      '/diagnostics/ios-interactions/detail',
    );
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

The root element must be:

```vue
<q-page
  padding
  class="mobile-safe-x ios-interaction-page"
  data-testid="ios-interaction-diagnostics"
  @pointerdown.self="dismissFocusedControl"
>
```

Include these exact sections:

- selectable `かな`, `カタカナ`, `日本語`, and `日本語を勉強しています。`;
- scroll-stress content before and after the form;
- `<JapaneseInputProbe data-keyboard-scroll-block />`;
- current route, current `mobileDepth`, keyboard visibility/status/error, orientation, resume count, and last navigation outcome;
- buttons with `data-testid` values `navigate-detail`, `navigate-detail-again`, `simulate-entry`, `simulate-entry-again`, `simulate-resume`, and `stage-cold-entry`;
- concise Japanese keyboard instructions matching the design scenario.

Use `pushMobileRoute` for detail navigation, `enterMobileRoute` for route-entry simulation, `recordAppResume` for browser simulation, and `stageDiagnosticColdEntry(window.localStorage, IOS_DIAGNOSTIC_DETAIL_PATH)` for the one-shot action.

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
      label="Navigate to this detail again"
      @click="repeatCurrentRoute"
    />
    <p>
      Test the visible header back control, native left-edge swipe-back, and
      native swipe-forward from this page.
    </p>
  </section>
</q-page>
```

`repeatCurrentRoute` calls `pushMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH)`.

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

`openDiagnostics` calls `pushMobileRoute(router, IOS_DIAGNOSTIC_ROOT_PATH)`.

- [ ] **Step 6: Run diagnostic, route, and shell tests**

Run:

```bash
# workdir: apps/vela-mobile
rtk bunx vitest run src/pages/diagnostics \
  src/pages/StubPages.test.ts \
  src/router \
  src/layouts/MobileLayout.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
# workdir: repository root
rtk git add apps/vela-mobile/src/pages/diagnostics \
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
import { findDiagnosticMarker } from './verify-production-diagnostics.mjs';

describe('verify-production-diagnostics', () => {
  it('returns no files when emitted JavaScript excludes the marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await writeFile(join(root, 'app.js'), 'console.log(\"production\")');
    expect(await findDiagnosticMarker(root, 'ios-interaction-diagnostics')).toEqual([]);
  });

  it('finds the marker in nested emitted JavaScript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await mkdir(join(root, 'assets'));
    await writeFile(
      join(root, 'assets', 'diagnostic.js'),
      'const marker=\"ios-interaction-diagnostics\"',
    );
    expect(await findDiagnosticMarker(root, 'ios-interaction-diagnostics')).toEqual([
      join(root, 'assets', 'diagnostic.js'),
    ]);
  });

  it('ignores non-JavaScript assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await writeFile(join(root, 'notes.txt'), 'ios-interaction-diagnostics');
    expect(await findDiagnosticMarker(root, 'ios-interaction-diagnostics')).toEqual([]);
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

export const DIAGNOSTIC_MARKER = 'ios-interaction-diagnostics';
const defaultRoot = fileURLToPath(new URL('../src-capacitor/www/', import.meta.url));

if (import.meta.main) {
  const matches = await findDiagnosticMarker(defaultRoot, DIAGNOSTIC_MARKER);
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

Run:

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

- Create: `apps/vela-mobile/docs/ios-interaction-baseline.md`
- Modify: `apps/vela-mobile/README.md`

**Interfaces:**

- Consumes: all implementation tasks and the exact physical scenarios from the design.
- Produces: durable simulator/device evidence and reusable shell guidance.

- [ ] **Step 1: Add the checked-in evidence document**

Start the document with:

```markdown
# iOS Interaction Baseline Evidence

**Linear issue:** HPA-209

## Result policy

- Record a row only after running that environment.
- Put the exact tested commit SHA in every environment row.
- A failure includes reproduction steps and a linked follow-up issue.
- Physical Japanese IME and WKWebView swipe results are release-blocking.

## Environment matrix

| Environment | Commit | Model | OS  | Xcode | Japanese keyboard | Orientation | Result |
| ----------- | ------ | ----- | --- | ----- | ----------------- | ----------- | ------ |

## Japanese IME evidence

Record the exact draft, committed, and submitted values observed for `日本語`.

## Keyboard, safe-area, and orientation evidence

Record keyboard-open portrait, keyboard-open rotation to landscape, focused
block visibility, Submit reachability, footer restoration, and inset ownership.

## Navigation evidence

Record visible back, native swipe-back, swipe-forward, Detail-to-Home tab
history, cold entry, resume, duplicate navigation, visual continuity, and
exit/trap behavior.

## Reusable rules

- Do not validate, normalize, or submit while Japanese composition is active.
- Hide bottom tabs on keyboard will-show and scroll after keyboard did-show.
- Let Quasar own native top and bottom safe areas exactly once.
- Route links and tabs through app-owned chronological `mobileDepth`.
- Restore saved scroll positions on back and forward.
- Resume does not navigate without a newly validated entry event.
```

Do not pre-populate unrun environments with passing results.

- [ ] **Step 2: Update the mobile README**

Add:

- the diagnostic route and development-only More entry;
- Japanese native keyboard setup;
- the `build:ios:assets` and `verify:production-diagnostics` commands;
- chronological tab/swipe history behavior;
- safe-area ownership rules;
- app-level resume rule;
- a link to `docs/ios-interaction-baseline.md`;
- the physical-device completion requirement.

- [ ] **Step 3: Run the complete automated verification**

Run:

```bash
# workdir: apps/vela-mobile
rtk bun run test:unit
rtk bun run lint
rtk bun run typecheck
rtk bun run build
rtk env VITE_MOBILE_API_URL=https://example.invalid/api/ bun run verify:production-diagnostics
# workdir: apps/vela-mobile/src-capacitor
rtk bunx cap sync ios
```

Expected: all commands exit 0, and the production scanner reports no diagnostic marker under `src-capacitor/www`.

- [ ] **Step 4: Run simulator validation**

Use XcodeBuildMCP to build and launch the synchronized app on:

- one small-screen iPhone simulator in portrait and landscape;
- one Dynamic Island simulator.

Record only observed results. While the keyboard remains open, rotate from portrait to landscape and verify the focused block and Submit remain reachable. Dismiss the keyboard and verify the footer returns once without stale space or doubled inset.

- [ ] **Step 5: Run the physical Japanese IME scenario**

On a connected iPhone with a Japanese keyboard:

1. Enter `にほんご`.
2. Select `日本語`.
3. Press Return while composition/candidate selection is active.
4. Verify no premature submission.
5. Finish composition.
6. Press Return again or tap Submit.
7. Record that draft, committed, and submitted values are exactly `日本語`.

- [ ] **Step 6: Run the physical history scenario**

1. Open More, Diagnostics, and Detail.
2. Use visible back.
3. Re-enter Detail and use native swipe-back.
4. Use native swipe-forward.
5. From Detail, tap Home.
6. Swipe back and verify the exact Detail page returns with visible content throughout the animation.
7. Swipe forward and verify Home returns.
8. Repeat current-route navigation and verify depth is unchanged.
9. Background/resume and verify the route is preserved.
10. Simulate the same route entry twice and verify no duplicate.
11. Stage Detail, terminate, relaunch, and verify one-shot cold entry.
12. Verify fresh-entry swipe-back is a no-op while header fallback reaches the diagnostic root.
13. Record any blank frame, unexpected route, exit, or trap as a blocking failure.

- [ ] **Step 7: Fill the evidence document with observed values**

Use:

```bash
# workdir: repository root
rtk git rev-parse HEAD
rtk xcodebuild -version
```

Record the actual commit, Xcode version, device models, OS versions, Japanese keyboard layout, orientations, results, and reproduction details. Do not infer or copy values from another run.

- [ ] **Step 8: Run final repository verification after documentation**

Run:

```bash
# workdir: apps/vela-mobile
rtk bun run test:unit
rtk bun run lint
rtk bun run typecheck
# workdir: repository root
rtk git diff --check
rtk git status --short
```

Expected: tests, lint, typecheck, and diff check pass; status contains only the intended README/evidence changes.

- [ ] **Step 9: Commit**

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
- Re-run `bun run test:unit`, `bun run lint`, `bun run typecheck`, `bun run build`, and the real Capacitor production marker scan.
- Confirm the simulator build succeeds after the final `cap sync ios`.
- Confirm the evidence document names the exact tested commit.
- Confirm physical Japanese IME submission preserves `日本語` exactly.
- Confirm native back, forward, and tab-switch history match the chronological policy without blank frames, exit, or trap.
- If a physical device is unavailable or either physical scenario fails, report HPA-209 as blocked rather than complete.
