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

type AllowlistDecision =
  | { kind: 'allowed'; resolved: RouteLocationResolved }
  | { kind: 'rejected' | 'noop'; result: MobileNavigationResult };

function resolveAllowedTarget(
  router: Router,
  target: RouteLocationRaw,
  allowedFullPaths: ReadonlySet<string>,
): AllowlistDecision {
  const resolved = router.resolve(target);
  if (!allowedFullPaths.has(resolved.fullPath)) {
    return {
      kind: 'rejected',
      result: {
        kind: 'rejected',
        fullPath: router.currentRoute.value.fullPath,
        depth: readMobileDepth(router),
      },
    };
  }
  if (resolved.fullPath === router.currentRoute.value.fullPath) {
    return {
      kind: 'noop',
      result: { kind: 'noop', fullPath: resolved.fullPath, depth: readMobileDepth(router) },
    };
  }
  return { kind: 'allowed', resolved };
}

export async function enterMobileRoute(
  router: Router,
  target: RouteLocationRaw,
  allowedFullPaths: ReadonlySet<string>,
): Promise<MobileNavigationResult> {
  const decision = resolveAllowedTarget(router, target, allowedFullPaths);
  if (decision.kind !== 'allowed') return decision.result;
  return pushMobileRoute(router, target);
}

export async function replaceColdMobileRoute(
  router: Router,
  target: RouteLocationRaw,
  allowedFullPaths: ReadonlySet<string>,
): Promise<MobileNavigationResult> {
  const decision = resolveAllowedTarget(router, target, allowedFullPaths);
  if (decision.kind !== 'allowed') return decision.result;
  const result = await router.replace(routeLocation(decision.resolved, 0));
  throwNavigationFailure(result);
  return { kind: 'replaced', fullPath: decision.resolved.fullPath, depth: 0 };
}

// router.back() triggers an asynchronous popstate navigation but returns void.
// Await the destination route via afterEach so the result reports the actual
// destination fullPath and recomputed mobile depth instead of the pre-back route.
// afterEach fires with a NavigationFailure when the pop is aborted/cancelled by
// a guard; rejecting here propagates the failure to backOrFallback's caller
// instead of letting it report a successful back with the unchanged route.
//
// A timeout guards against router.back() being a no-op when the app-owned
// mobileDepth disagrees with the real browser history length (e.g. a stale
// depth left by a crashed navigation). In that case afterEach never fires and
// the promise would hang forever, freezing backOrFallback's caller. On timeout
// the promise resolves with false (rather than rejecting) so backOrFallback
// can recover by replacing with the fallback route — the user reaches a sane
// destination instead of being trapped on a stale header. The timeout is not
// definitive proof of a no-op (a slow guarded or lazy-loaded navigation could
// take longer), but recovery via replace is safe: if a real navigation was
// in flight, the replace supersedes it and the user still reaches the fallback.
const ROUTE_BACK_SETTLE_TIMEOUT_MS = 1000;

function whenRouteNavigationSettled(router: Router): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stop = router.afterEach((_to, _from, failure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      if (failure) {
        reject(failure);
      } else {
        resolve(true);
      }
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      resolve(false);
    }, ROUTE_BACK_SETTLE_TIMEOUT_MS);
  });
}

export async function backOrFallback(
  router: Router,
  fallback: RouteLocationRaw,
): Promise<MobileNavigationResult> {
  const depth = readMobileDepth(router);
  if (depth > 0) {
    const settled = whenRouteNavigationSettled(router);
    router.back();
    const navigated = await settled;
    if (navigated) {
      return {
        kind: 'back',
        fullPath: router.currentRoute.value.fullPath,
        depth: readMobileDepth(router),
      };
    }
    // router.back() was a no-op (stale positive depth with no matching history
    // entry). Fall through to the fallback so the user is not trapped.
  }
  const resolved = router.resolve(fallback);
  const result = await router.replace(routeLocation(resolved, 0));
  throwNavigationFailure(result);
  return { kind: 'fallback', fullPath: resolved.fullPath, depth: 0 };
}
