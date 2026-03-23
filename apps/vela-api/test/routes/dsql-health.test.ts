import { describe, test, expect, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

// Mock the dsql module before importing the route
const mockCheckDsqlHealth = vi.fn();

vi.mock('../../src/dsql', () => ({
  checkDsqlHealth: mockCheckDsqlHealth,
}));

const { dsqlHealth } = await import('../../src/routes/dsql-health');

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', dsqlHealth);
  return app;
}

describe('DSQL Health Route', () => {
  test('returns 200 with status ok when health check succeeds', async () => {
    mockCheckDsqlHealth.mockResolvedValueOnce({
      status: 'ok',
      details: 'Successfully executed SELECT 1 against Aurora DSQL.',
    });

    const app = createTestApp();
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; details: string };
    expect(body.status).toBe('ok');
    expect(body.details).toContain('SELECT 1');
  });

  test('returns 200 with default details when health check succeeds with no details', async () => {
    mockCheckDsqlHealth.mockResolvedValueOnce({
      status: 'ok',
    });

    const app = createTestApp();
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; details: string };
    expect(body.status).toBe('ok');
    expect(body.details).toContain('SELECT 1');
  });

  test('returns 500 with error message when health check fails', async () => {
    mockCheckDsqlHealth.mockResolvedValueOnce({
      status: 'error',
      error: 'Connection refused',
    });

    const app = createTestApp();
    const res = await app.request('/');

    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe('error');
    expect(body.error).toBe('Connection refused');
  });

  test('returns 500 with default error when health check fails with no error message', async () => {
    mockCheckDsqlHealth.mockResolvedValueOnce({
      status: 'error',
    });

    const app = createTestApp();
    const res = await app.request('/');

    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe('error');
    expect(body.error).toContain('Failed to execute test query');
  });
});
