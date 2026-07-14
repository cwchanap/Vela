import { describe, it, expect } from 'vitest';
import routes from './routes';

describe('routes', () => {
  it('exports an array of route records', () => {
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
  });

  it('has a root route with MobileLayout', () => {
    const root = routes.find((r) => r.path === '/');
    expect(root).toBeDefined();
    expect(root?.component).toBeDefined();
  });

  it('has 5 child routes under the root layout', () => {
    const root = routes.find((r) => r.path === '/');
    expect(root?.children).toHaveLength(5);
  });

  it('includes all expected child paths', () => {
    const root = routes.find((r) => r.path === '/');
    const paths = root?.children?.map((c) => c.path) ?? [];
    expect(paths).toContain('');
    expect(paths).toContain('review');
    expect(paths).toContain('learn');
    expect(paths).toContain('words');
    expect(paths).toContain('more');
  });

  it('has a catch-all route', () => {
    const catchAll = routes.find((r) => r.path === '/:catchAll(.*)*');
    expect(catchAll).toBeDefined();
  });
});
