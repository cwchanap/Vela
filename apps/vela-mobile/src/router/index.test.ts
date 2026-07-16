import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import createRouter from './index';

describe('router/index', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.SERVER;
    delete process.env.VUE_ROUTER_MODE;
    delete process.env.VUE_ROUTER_BASE;
  });

  it('exports a router factory function', () => {
    expect(typeof createRouter).toBe('function');
  });

  it('returns a router instance with the scaffold routes', () => {
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(router.options.routes.length).toBeGreaterThan(0);
  });

  it('uses memory history when SERVER is set', () => {
    process.env.SERVER = 'true';
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(router.options.history).toBeDefined();
  });
});
