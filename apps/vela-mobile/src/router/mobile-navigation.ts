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
function whenRouteNavigationSettled(router: Router): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = router.afterEach((_to, _from, failure) => {
      stop();
      if (failure) {
        reject(failure);
      } else {
        resolve();
      }
    });
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
    await settled;
    return {
      kind: 'back',
      fullPath: router.currentRoute.value.fullPath,
      depth: readMobileDepth(router),
    };
  }
  const resolved = router.resolve(fallback);
  const result = await router.replace(routeLocation(resolved, 0));
  throwNavigationFailure(result);
  return { kind: 'fallback', fullPath: resolved.fullPath, depth: 0 };
}
