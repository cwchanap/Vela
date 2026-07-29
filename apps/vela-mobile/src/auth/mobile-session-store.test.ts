import {
  KeychainAccess,
  StorageError,
  StorageErrorType,
} from '@aparajita/capacitor-secure-storage';
import { describe, expect, it, vi } from 'vitest';
import {
  MobileSessionStoreError,
  createIosKeychainSessionStore,
  createMobileSessionKey,
  createUnsupportedMobileSessionStore,
} from './mobile-session-store';

const config = {
  userPoolId: 'ca-central-1_pool',
  mobileClientId: 'mobile-client',
};

function createNativeStore(secureStorage: {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}) {
  return createIosKeychainSessionStore({
    secureStorage,
    runtime: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    },
    config,
  });
}

describe('mobile session store', () => {
  it('uses the exact environment key and non-synchronizing typed calls', async () => {
    const secureStorage = {
      get: vi.fn().mockResolvedValue('refresh-token'),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(true),
    };
    const store = createNativeStore(secureStorage);
    const key = 'vela:mobile:cognito:ca-central-1_pool:mobile-client:refresh:v1';

    await expect(store.loadRefreshToken()).resolves.toBe('refresh-token');
    await store.saveRefreshToken('rotated-token');
    await store.clearRefreshToken();

    expect(createMobileSessionKey(config)).toBe(key);
    expect(secureStorage.get).toHaveBeenCalledWith(key, false, false);
    expect(secureStorage.set).toHaveBeenCalledWith(
      key,
      'rotated-token',
      false,
      false,
      KeychainAccess.afterFirstUnlockThisDeviceOnly,
    );
    expect(secureStorage.remove).toHaveBeenCalledWith(key, false);
  });

  it('returns null only when no refresh token is stored', async () => {
    const store = createNativeStore({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      remove: vi.fn(),
    });

    await expect(store.loadRefreshToken()).resolves.toBeNull();
  });

  it.each([[''], ['   '], [42], [false], [{}], [[]]])(
    'rejects malformed stored refresh token %p as corrupt',
    async (value) => {
      const store = createNativeStore({
        get: vi.fn().mockResolvedValue(value),
        set: vi.fn(),
        remove: vi.fn(),
      });

      await expect(store.loadRefreshToken()).rejects.toMatchObject({
        name: 'MobileSessionStoreError',
        code: 'corrupt',
        message: 'corrupt',
      } satisfies Partial<MobileSessionStoreError>);
    },
  );

  it.each([
    [new StorageError('bad json', StorageErrorType.invalidData), 'corrupt'],
    [new StorageError('native failure', StorageErrorType.osError), 'unavailable'],
    [new Error('bridge failure'), 'unavailable'],
  ] as const)('normalizes %p without exposing its message', async (failure, code) => {
    const store = createNativeStore({
      get: vi.fn().mockRejectedValue(failure),
      set: vi.fn(),
      remove: vi.fn(),
    });

    await expect(store.loadRefreshToken()).rejects.toMatchObject({
      name: 'MobileSessionStoreError',
      code,
      message: code,
    } satisfies Partial<MobileSessionStoreError>);
  });

  it.each([
    ['save', (store: ReturnType<typeof createNativeStore>) => store.saveRefreshToken('token')],
    ['clear', (store: ReturnType<typeof createNativeStore>) => store.clearRefreshToken()],
  ])('normalizes %s failures without exposing their messages', async (_operation, invoke) => {
    const failure = new Error('native secret');
    const store = createNativeStore({
      get: vi.fn(),
      set: vi.fn().mockRejectedValue(failure),
      remove: vi.fn().mockRejectedValue(failure),
    });

    await expect(invoke(store)).rejects.toMatchObject({
      name: 'MobileSessionStoreError',
      code: 'unavailable',
      message: 'unavailable',
    } satisfies Partial<MobileSessionStoreError>);
  });

  it.each([
    ['browser', false, 'web'],
    ['android', true, 'android'],
    ['unknown platform', true, 'desktop'],
  ])('refuses %s without invoking secure storage', async (_name, isNativePlatform, platform) => {
    const secureStorage = {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const store = createIosKeychainSessionStore({
      secureStorage,
      runtime: { isNativePlatform: () => isNativePlatform, getPlatform: () => platform },
      config,
    });

    await expect(store.loadRefreshToken()).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
    await expect(store.saveRefreshToken('token')).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
    await expect(store.clearRefreshToken()).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
    expect(secureStorage.get).not.toHaveBeenCalled();
    expect(secureStorage.set).not.toHaveBeenCalled();
    expect(secureStorage.remove).not.toHaveBeenCalled();
  });

  it('provides an explicitly unsupported store for non-native composition roots', async () => {
    const store = createUnsupportedMobileSessionStore();

    await expect(store.loadRefreshToken()).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
    await expect(store.saveRefreshToken('token')).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
    await expect(store.clearRefreshToken()).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
  });
});
