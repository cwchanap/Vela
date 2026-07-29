import {
  KeychainAccess,
  StorageError,
  StorageErrorType,
  type SecureStoragePlugin,
} from '@aparajita/capacitor-secure-storage';
import type { MobileOAuthConfig } from './mobile-auth-contract';

export type MobileSessionStore = {
  loadRefreshToken(): Promise<string | null>;
  saveRefreshToken(refreshToken: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
};

export type MobileSessionStoreErrorCode = 'corrupt' | 'unavailable' | 'unsupported_platform';

export class MobileSessionStoreError extends Error {
  constructor(readonly code: MobileSessionStoreErrorCode) {
    super(code);
    this.name = 'MobileSessionStoreError';
  }
}

export type MobileRuntimeAdapter = {
  isNativePlatform(): boolean;
  getPlatform(): string;
};

export function createMobileSessionKey(
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>,
): string {
  return `vela:mobile:cognito:${config.userPoolId}:${config.mobileClientId}:refresh:v1`;
}

function normalizeFailure(error: unknown): MobileSessionStoreError {
  if (error instanceof MobileSessionStoreError) return error;
  if (error instanceof StorageError && error.code === StorageErrorType.invalidData) {
    return new MobileSessionStoreError('corrupt');
  }
  return new MobileSessionStoreError('unavailable');
}

function assertNativeIos(runtime: MobileRuntimeAdapter): void {
  if (!runtime.isNativePlatform() || runtime.getPlatform() !== 'ios') {
    throw new MobileSessionStoreError('unsupported_platform');
  }
}

function unsupportedPlatform(): never {
  throw new MobileSessionStoreError('unsupported_platform');
}

export function createIosKeychainSessionStore(options: {
  secureStorage: Pick<SecureStoragePlugin, 'get' | 'set' | 'remove'>;
  runtime: MobileRuntimeAdapter;
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>;
}): MobileSessionStore {
  const key = createMobileSessionKey(options.config);

  return {
    async loadRefreshToken() {
      assertNativeIos(options.runtime);
      try {
        const refreshToken = await options.secureStorage.get(key, false, false);
        if (refreshToken === null) return null;
        if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
          throw new MobileSessionStoreError('corrupt');
        }
        return refreshToken;
      } catch (error) {
        throw normalizeFailure(error);
      }
    },

    async saveRefreshToken(refreshToken) {
      assertNativeIos(options.runtime);
      if (refreshToken.trim().length === 0) {
        throw new MobileSessionStoreError('corrupt');
      }
      try {
        await options.secureStorage.set(
          key,
          refreshToken,
          false,
          false,
          KeychainAccess.afterFirstUnlockThisDeviceOnly,
        );
      } catch (error) {
        throw normalizeFailure(error);
      }
    },

    async clearRefreshToken() {
      assertNativeIos(options.runtime);
      try {
        await options.secureStorage.remove(key, false);
      } catch (error) {
        throw normalizeFailure(error);
      }
    },
  };
}

export function createUnsupportedMobileSessionStore(): MobileSessionStore {
  return {
    async loadRefreshToken() {
      return unsupportedPlatform();
    },
    async saveRefreshToken() {
      return unsupportedPlatform();
    },
    async clearRefreshToken() {
      return unsupportedPlatform();
    },
  };
}
