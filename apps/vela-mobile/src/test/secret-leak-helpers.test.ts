import { beforeEach, describe, expect, it } from 'vitest';
import { MOBILE_OAUTH_TRANSACTION_KEY } from '../auth/mobile-auth-contract';
import {
  SECRET_SENTINELS,
  createSecretLeakAssertions,
  storageSnapshot,
} from './secret-leak-helpers';

const [storageSecret] = SECRET_SENTINELS;
if (!storageSecret) throw new Error('mobile secret policy must define storage sentinels');

const { expectNoSecretLeak } = createSecretLeakAssertions({ installationKey: 'installation-key' });

function expectNoLeak(): void {
  expectNoSecretLeak({ consoleCalls: [], preferenceCalls: [] });
}

describe('secret-leak helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('includes the router scroll bookkeeping key in the secret-scan snapshot', () => {
    window.sessionStorage.setItem('vue-router:scroll', '{"1":{"left":0,"top":0}}');

    expect(storageSnapshot(window.sessionStorage)).toContain('vue-router:scroll');
  });

  it('detects secrets stored under the router scroll bookkeeping key', () => {
    window.sessionStorage.setItem('vue-router:scroll', JSON.stringify({ value: storageSecret }));

    expect(() => expectNoLeak()).toThrow();
  });

  it('allows benign router scroll bookkeeping without failing the leak check', () => {
    window.sessionStorage.setItem('vue-router:scroll', '{"1":{"left":0,"top":0}}');

    expect(() => expectNoLeak()).not.toThrow();
  });

  it('does not allow router scroll bookkeeping in localStorage', () => {
    window.localStorage.setItem('vue-router:scroll', '{"1":{"left":0,"top":0}}');

    expect(() => expectNoLeak()).toThrow();
  });

  it('still rejects unrelated session storage keys', () => {
    window.sessionStorage.setItem('unexpected', 'value');

    expect(() => expectNoLeak()).toThrow();
  });

  it.each(['SECRET-code-verifier', 'SECRET-nonce', 'SECRET-unlisted-storage-secret'])(
    'detects %s stored under the router scroll bookkeeping key',
    (secret) => {
      window.sessionStorage.setItem('vue-router:scroll', JSON.stringify({ value: secret }));

      expect(() => expectNoLeak()).toThrow();
    },
  );

  it('still allows approved transaction verifier values in Preferences', () => {
    expectNoSecretLeak({
      consoleCalls: [],
      preferenceCalls: [
        [
          {
            key: MOBILE_OAUTH_TRANSACTION_KEY,
            value: JSON.stringify({
              state: 'state-value',
              codeVerifier: 'SECRET-code-verifier',
              nonce: 'SECRET-nonce',
              createdAt: 1,
            }),
          },
        ],
      ],
      renderedText: '',
    });
  });
});
