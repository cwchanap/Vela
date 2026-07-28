import {
  MOBILE_OAUTH_TRANSACTION_KEY,
  MOBILE_OAUTH_TRANSACTION_TTL_MS,
  type OAuthTransaction,
} from './mobile-auth-contract';

export type LoadedOAuthTransaction =
  | { kind: 'missing' }
  | { kind: 'corrupt' }
  | { kind: 'expired' }
  | { kind: 'active'; transaction: OAuthTransaction };

export type OAuthTransactionStore = {
  replace(transaction: OAuthTransaction): Promise<void>;
  load(): Promise<LoadedOAuthTransaction>;
  clear(): Promise<void>;
};

export type OAuthTransactionPreferences = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseTransaction(value: string, now: number): LoadedOAuthTransaction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { kind: 'corrupt' };
  }

  if (
    !isRecord(parsed) ||
    !isNonEmptyString(parsed.state) ||
    !isNonEmptyString(parsed.codeVerifier) ||
    !isNonEmptyString(parsed.nonce) ||
    typeof parsed.createdAt !== 'number' ||
    !Number.isFinite(parsed.createdAt) ||
    parsed.createdAt > now
  ) {
    return { kind: 'corrupt' };
  }

  const transaction: OAuthTransaction = {
    state: parsed.state,
    codeVerifier: parsed.codeVerifier,
    nonce: parsed.nonce,
    createdAt: parsed.createdAt,
  };

  if (now - transaction.createdAt >= MOBILE_OAUTH_TRANSACTION_TTL_MS) {
    return { kind: 'expired' };
  }

  return { kind: 'active', transaction };
}

export function createOAuthTransactionStore(
  preferences: OAuthTransactionPreferences,
  now: () => number,
): OAuthTransactionStore {
  return {
    async replace(transaction) {
      await preferences.remove({ key: MOBILE_OAUTH_TRANSACTION_KEY });
      await preferences.set({
        key: MOBILE_OAUTH_TRANSACTION_KEY,
        value: JSON.stringify({
          state: transaction.state,
          codeVerifier: transaction.codeVerifier,
          nonce: transaction.nonce,
          createdAt: transaction.createdAt,
        }),
      });
    },

    async load() {
      const { value } = await preferences.get({ key: MOBILE_OAUTH_TRANSACTION_KEY });
      if (value === null) {
        return { kind: 'missing' };
      }

      const result = parseTransaction(value, now());
      if (result.kind === 'corrupt' || result.kind === 'expired') {
        await preferences.remove({ key: MOBILE_OAUTH_TRANSACTION_KEY });
      }
      return result;
    },

    async clear() {
      await preferences.remove({ key: MOBILE_OAUTH_TRANSACTION_KEY });
    },
  };
}
