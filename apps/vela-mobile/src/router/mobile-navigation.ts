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
