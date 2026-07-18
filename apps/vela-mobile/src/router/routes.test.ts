import { describe, it, expect } from 'vitest';
import routes from './routes';

// Route components are lazy: `() => import('pages/HomePage.vue')`. Asserting
// `component` is `toBeDefined` only checks the wrapper function exists — it
// passes even if the target file is deleted, because the import never runs.
// Awaiting each lazy component forces the module to load, so a missing or
// broken page/layout actually fails this test instead of slipping through to
// runtime.
async function loadDefault(component: unknown): Promise<unknown> {
  const fn = component as () => Promise<Record<string, unknown>>;
  expect(typeof fn).toBe('function');
  const mod = await fn();
  return mod.default ?? mod;
}

describe('routes', () => {
  it('exports an array of route records', () => {
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
  });

  it('has a root route with a resolvable MobileLayout', async () => {
    const root = routes.find((r) => r.path === '/');
    expect(root).toBeDefined();
    expect(await loadDefault(root?.component)).toBeDefined();
  });

  it('has 5 child routes under the root layout', () => {
    const root = routes.find((r) => r.path === '/');
    expect(root?.children).toHaveLength(5);
  });

  it('includes all expected child paths with resolvable components', async () => {
    const root = routes.find((r) => r.path === '/');
    const paths = root?.children?.map((c) => c.path) ?? [];
    expect(paths).toContain('');
    expect(paths).toContain('review');
    expect(paths).toContain('learn');
    expect(paths).toContain('words');
    expect(paths).toContain('more');
    // Await every child component so a deleted page fails here, not at runtime.
    await Promise.all(
      (root?.children ?? []).map(async (c) => {
        expect(await loadDefault(c.component)).toBeDefined();
      }),
    );
  });

  it('has a catch-all route with a resolvable component', async () => {
    const catchAll = routes.find((r) => r.path === '/:catchAll(.*)*');
    expect(catchAll).toBeDefined();
    expect(await loadDefault(catchAll?.component)).toBeDefined();
  });
});
