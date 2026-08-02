import { expect, vi } from 'vitest';
import {
  LOG_AND_DOM_SENTINELS,
  NON_SCHEMA_STORAGE_SENTINELS,
  SECRET_SENTINELS,
} from '../../build/mobile-secret-policy';
import { MOBILE_OAUTH_TRANSACTION_KEY } from '../auth/mobile-auth-contract';

/**
 * Shared secret-leak regression helpers. The policy-owned sentinel lists are
 * re-exported here so existing mobile auth tests share one source of truth.
 */
export { LOG_AND_DOM_SENTINELS, NON_SCHEMA_STORAGE_SENTINELS, SECRET_SENTINELS };

export function searchable(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function storageSnapshot(storage: Storage): string {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index) ?? '';
    return `${key}=${storage.getItem(key) ?? ''}`;
  }).join('\n');
}

export function captureConsoleCalls(): {
  calls: () => unknown[][];
  restore: () => void;
} {
  const spies = (['debug', 'info', 'log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  return {
    calls: () =>
      spies.flatMap((spy) =>
        spy.mock.calls.map((call) =>
          call.map((value) =>
            value instanceof Error ? { ...value, name: value.name, message: value.message } : value,
          ),
        ),
      ),
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

/**
 * Creates the secret-leak assertions. The preference-write schema check uses
 * the supplied installation key (derived from the OAuth config by each caller)
 * to verify that non-transaction preference writes target only the installation
 * marker. Callers that never produce preference writes (gate, boot) may pass a
 * placeholder key.
 */
export function createSecretLeakAssertions(options: { installationKey: string }): {
  expectNoSecretLeak: (input: {
    consoleCalls: unknown[][];
    preferenceCalls: unknown[][];
    errorMessages?: string[];
    jsonSnapshots?: string[];
    renderedText?: string;
  }) => void;
  expectApprovedPreferenceWrites: (preferenceCalls: unknown[][]) => void;
} {
  const installationKey = options.installationKey;

  function expectApprovedPreferenceWrites(preferenceCalls: unknown[][]): void {
    for (const call of preferenceCalls) {
      expect(call).toHaveLength(1);
      const options = call[0];
      expect(options).toEqual(
        expect.objectContaining({
          key: expect.any(String),
          value: expect.any(String),
        }),
      );
      const { key, value } = options as { key: string; value: string };
      expect(Object.keys(options as object).sort()).toEqual(['key', 'value']);

      if (key === MOBILE_OAUTH_TRANSACTION_KEY) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(value);
        } catch {
          expect.fail('OAuth transaction Preferences value must be valid JSON');
        }
        expect(parsed).toEqual(
          expect.objectContaining({
            state: expect.any(String),
            codeVerifier: expect.any(String),
            nonce: expect.any(String),
            createdAt: expect.any(Number),
          }),
        );
        const transaction = parsed as Record<string, unknown>;
        expect(Object.keys(transaction).sort()).toEqual([
          'codeVerifier',
          'createdAt',
          'nonce',
          'state',
        ]);
        expect((transaction.state as string).length).toBeGreaterThan(0);
        expect((transaction.codeVerifier as string).length).toBeGreaterThan(0);
        expect((transaction.nonce as string).length).toBeGreaterThan(0);
        expect(Number.isFinite(transaction.createdAt)).toBe(true);
        continue;
      }

      expect(key).toBe(installationKey);
      expect(value).toBe('1');
    }
  }

  function expectNoSecretLeak(input: {
    consoleCalls: unknown[][];
    preferenceCalls: unknown[][];
    errorMessages?: string[];
    jsonSnapshots?: string[];
    renderedText?: string;
  }): void {
    const logsAndDom = [
      searchable(input.consoleCalls),
      ...(input.errorMessages ?? []),
      ...(input.jsonSnapshots ?? []),
      input.renderedText ?? document.body.textContent ?? '',
    ].join('\n');
    const browserAndPreferenceStorage = [
      searchable(input.preferenceCalls),
      storageSnapshot(window.localStorage),
      storageSnapshot(window.sessionStorage),
    ].join('\n');

    for (const secret of LOG_AND_DOM_SENTINELS) {
      expect(logsAndDom).not.toContain(secret);
    }
    expect(logsAndDom).not.toContain('SECRET-');
    for (const secret of SECRET_SENTINELS) {
      expect(browserAndPreferenceStorage).not.toContain(secret);
    }
    for (const secret of NON_SCHEMA_STORAGE_SENTINELS) {
      expect(browserAndPreferenceStorage).not.toContain(secret);
    }
    expectApprovedPreferenceWrites(input.preferenceCalls);
    expect(storageSnapshot(window.localStorage)).toBe('');
    expect(storageSnapshot(window.sessionStorage)).toBe('');
  }

  return { expectNoSecretLeak, expectApprovedPreferenceWrites };
}
