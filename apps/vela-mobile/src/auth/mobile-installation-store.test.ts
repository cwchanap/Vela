import { describe, expect, it, vi } from 'vitest';
import {
  createMobileInstallationKey,
  createMobileInstallationStore,
} from './mobile-installation-store';

const config = {
  userPoolId: 'ca-central-1_pool',
  mobileClientId: 'mobile-client',
};

describe('mobile installation store', () => {
  it('uses an environment-scoped non-secret marker', async () => {
    const preferences = {
      get: vi.fn().mockResolvedValue({ value: null }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const store = createMobileInstallationStore(preferences, config);
    const key = 'vela:mobile:cognito:ca-central-1_pool:mobile-client:installation:v1';

    await expect(store.isCurrentInstallationMarked()).resolves.toBe(false);
    await store.markCurrentInstallation();

    expect(createMobileInstallationKey(config)).toBe(key);
    expect(preferences.get).toHaveBeenCalledWith({ key });
    expect(preferences.set).toHaveBeenCalledWith({ key, value: '1' });
  });

  it('reports marked when the current installation marker is present', async () => {
    const store = createMobileInstallationStore(
      {
        get: vi.fn().mockResolvedValue({ value: '1' }),
        set: vi.fn(),
      },
      config,
    );

    await expect(store.isCurrentInstallationMarked()).resolves.toBe(true);
  });

  it.each([null, '', '0', 'unexpected'])('treats %p as unmarked', async (value) => {
    const store = createMobileInstallationStore(
      {
        get: vi.fn().mockResolvedValue({ value }),
        set: vi.fn(),
      },
      config,
    );

    await expect(store.isCurrentInstallationMarked()).resolves.toBe(false);
  });

  it('propagates an exact Preferences read rejection', async () => {
    const failure = new Error('read failed');
    const store = createMobileInstallationStore(
      {
        get: vi.fn().mockRejectedValue(failure),
        set: vi.fn(),
      },
      config,
    );

    await expect(store.isCurrentInstallationMarked()).rejects.toBe(failure);
  });

  it('propagates an exact Preferences write rejection', async () => {
    const failure = new Error('write failed');
    const store = createMobileInstallationStore(
      {
        get: vi.fn(),
        set: vi.fn().mockRejectedValue(failure),
      },
      config,
    );

    await expect(store.markCurrentInstallation()).rejects.toBe(failure);
  });
});
