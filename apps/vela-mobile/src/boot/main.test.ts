import { describe, it, expect, vi, afterEach } from 'vitest';
import boot from './main';

describe('boot/main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('exports a function', () => {
    expect(typeof boot).toBe('function');
  });

  it('logs in dev mode', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('DEV', true);
    (boot as () => void)();
    expect(log).toHaveBeenCalledWith('Vela Mobile boot initialized');
  });

  it('does not log in production', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('DEV', false);
    (boot as () => void)();
    expect(log).not.toHaveBeenCalled();
  });
});
