import type { MobileOAuthConfig } from './mobile-auth-contract';
import type { OAuthTransactionPreferences } from './oauth-transaction-store';

export type MobileInstallationStore = {
  isCurrentInstallationMarked(): Promise<boolean>;
  markCurrentInstallation(): Promise<void>;
};

export function createMobileInstallationKey(
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>,
): string {
  return `vela:mobile:cognito:${config.userPoolId}:${config.mobileClientId}:installation:v1`;
}

export function createMobileInstallationStore(
  preferences: Pick<OAuthTransactionPreferences, 'get' | 'set'>,
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>,
): MobileInstallationStore {
  const key = createMobileInstallationKey(config);

  return {
    async isCurrentInstallationMarked() {
      return (await preferences.get({ key })).value === '1';
    },
    async markCurrentInstallation() {
      await preferences.set({ key, value: '1' });
    },
  };
}
