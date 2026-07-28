import { describe, expect, it } from 'vitest';
import {
  createOAuthTransactionStore,
  type OAuthTransactionPreferences,
} from './oauth-transaction-store';
import {
  MOBILE_OAUTH_TRANSACTION_KEY,
  MOBILE_OAUTH_TRANSACTION_TTL_MS,
  type OAuthTransaction,
} from './mobile-auth-contract';

const now = 1_000_000;

const transaction: OAuthTransaction = {
  state: 'state-value',
  codeVerifier: 'verifier-value',
  nonce: 'nonce-value',
  createdAt: now - 1,
};

class FakePreferences implements OAuthTransactionPreferences {
  value: string | null = null;
  readonly calls: string[] = [];
  onRemove: (() => Promise<void>) | undefined;

  async get({ key }: { key: string }): Promise<{ value: string | null }> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.calls.push('get');
    return { value: this.value };
  }

  async set({ key, value }: { key: string; value: string }): Promise<void> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.calls.push('set');
    this.value = value;
  }

  async remove({ key }: { key: string }): Promise<void> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.calls.push('remove:start');
    await this.onRemove?.();
    this.calls.push('remove:complete');
    this.value = null;
  }
}

function storedTransaction(overrides: Partial<OAuthTransaction> = {}): string {
  return JSON.stringify({ ...transaction, ...overrides });
}

describe('OAuth transaction store', () => {
  it('reports missing when no transaction has been persisted', async () => {
    const preferences = new FakePreferences();

    await expect(createOAuthTransactionStore(preferences, () => now).load()).resolves.toEqual({
      kind: 'missing',
    });
    expect(preferences.calls).toEqual(['get']);
  });

  it('clears malformed JSON and reports it as corrupt', async () => {
    const preferences = new FakePreferences();
    preferences.value = '{not json';

    await expect(createOAuthTransactionStore(preferences, () => now).load()).resolves.toEqual({
      kind: 'corrupt',
    });
    expect(preferences.calls).toEqual(['get', 'remove:start', 'remove:complete']);
    expect(preferences.value).toBeNull();
  });

  it.each([
    [
      'missing state',
      { codeVerifier: transaction.codeVerifier, nonce: transaction.nonce, createdAt: now },
    ],
    ['empty verifier', { ...transaction, codeVerifier: '' }],
    ['numeric nonce', { ...transaction, nonce: 42 }],
    ['string timestamp', { ...transaction, createdAt: String(now) }],
  ])('clears a transaction with %s', async (_description, persisted) => {
    const preferences = new FakePreferences();
    preferences.value = JSON.stringify(persisted);

    await expect(createOAuthTransactionStore(preferences, () => now).load()).resolves.toEqual({
      kind: 'corrupt',
    });
    expect(preferences.value).toBeNull();
  });

  it.each([
    [
      'a non-finite timestamp',
      '{"state":"state-value","codeVerifier":"verifier-value","nonce":"nonce-value","createdAt":1e999}',
    ],
    ['a future timestamp', storedTransaction({ createdAt: now + 1 })],
  ])('clears %s as corrupt', async (_description, persisted) => {
    const preferences = new FakePreferences();
    preferences.value = persisted;

    await expect(createOAuthTransactionStore(preferences, () => now).load()).resolves.toEqual({
      kind: 'corrupt',
    });
    expect(preferences.value).toBeNull();
  });

  it.each([
    [
      'id token',
      '{"state":"state-value","codeVerifier":"verifier-value","nonce":"nonce-value","createdAt":999999,"idToken":"secret"}',
    ],
    [
      'access token',
      '{"state":"state-value","codeVerifier":"verifier-value","nonce":"nonce-value","createdAt":999999,"accessToken":"secret"}',
    ],
    [
      'authorization code',
      '{"state":"state-value","codeVerifier":"verifier-value","nonce":"nonce-value","createdAt":999999,"code":"secret"}',
    ],
    [
      'prototype-shaped property',
      '{"state":"state-value","codeVerifier":"verifier-value","nonce":"nonce-value","createdAt":999999,"__proto__":{"idToken":"secret"}}',
    ],
  ])('clears an entry with an extra %s', async (_description, persisted) => {
    const preferences = new FakePreferences();
    preferences.value = persisted;

    await expect(createOAuthTransactionStore(preferences, () => now).load()).resolves.toEqual({
      kind: 'corrupt',
    });
    expect(preferences.value).toBeNull();
  });

  it('rejects transaction fields inherited from Object.prototype', async () => {
    Object.defineProperties(Object.prototype, {
      state: { configurable: true, value: transaction.state },
      codeVerifier: { configurable: true, value: transaction.codeVerifier },
      nonce: { configurable: true, value: transaction.nonce },
      createdAt: { configurable: true, value: transaction.createdAt },
    });
    const preferences = new FakePreferences();
    preferences.value = '{}';

    try {
      await expect(createOAuthTransactionStore(preferences, () => now).load()).resolves.toEqual({
        kind: 'corrupt',
      });
      expect(preferences.value).toBeNull();
    } finally {
      delete (Object.prototype as Record<string, unknown>).state;
      delete (Object.prototype as Record<string, unknown>).codeVerifier;
      delete (Object.prototype as Record<string, unknown>).nonce;
      delete (Object.prototype as Record<string, unknown>).createdAt;
    }
  });

  it('clears a transaction exactly at the TTL boundary and reports it as expired', async () => {
    const preferences = new FakePreferences();
    preferences.value = storedTransaction({ createdAt: now - MOBILE_OAUTH_TRANSACTION_TTL_MS });

    await expect(createOAuthTransactionStore(preferences, () => now).load()).resolves.toEqual({
      kind: 'expired',
    });
    expect(preferences.value).toBeNull();
  });

  it('loads a transaction that is still within the TTL', async () => {
    const preferences = new FakePreferences();
    preferences.value = storedTransaction({ createdAt: now - MOBILE_OAUTH_TRANSACTION_TTL_MS + 1 });

    await expect(createOAuthTransactionStore(preferences, () => now).load()).resolves.toEqual({
      kind: 'active',
      transaction: { ...transaction, createdAt: now - MOBILE_OAUTH_TRANSACTION_TTL_MS + 1 },
    });
    expect(preferences.calls).toEqual(['get']);
  });

  it('awaits removing the prior entry before persisting a replacement', async () => {
    const preferences = new FakePreferences();
    let releaseRemoval: (() => void) | undefined;
    const removal = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    preferences.onRemove = () => removal;
    const store = createOAuthTransactionStore(preferences, () => now);
    const replacement = { ...transaction, state: 'replacement-state' };

    const replacing = store.replace(replacement);
    await Promise.resolve();

    expect(preferences.calls).toEqual(['remove:start']);
    releaseRemoval?.();
    await replacing;

    expect(preferences.calls).toEqual(['remove:start', 'remove:complete', 'set']);
    expect(JSON.parse(preferences.value ?? '')).toEqual(replacement);
  });

  it('persists only the four transaction fields', async () => {
    const preferences = new FakePreferences();
    const store = createOAuthTransactionStore(preferences, () => now);

    await store.replace(transaction);

    const persisted = JSON.parse(preferences.value ?? '') as Record<string, unknown>;
    expect(Object.keys(persisted).sort()).toEqual(['codeVerifier', 'createdAt', 'nonce', 'state']);
    expect(persisted).not.toHaveProperty('code');
    expect(persisted).not.toHaveProperty('accessToken');
    expect(persisted).not.toHaveProperty('idToken');
    expect(persisted).not.toHaveProperty('refreshToken');
  });

  it('clears the stored transaction', async () => {
    const preferences = new FakePreferences();
    preferences.value = storedTransaction();

    await createOAuthTransactionStore(preferences, () => now).clear();

    expect(preferences.calls).toEqual(['remove:start', 'remove:complete']);
    expect(preferences.value).toBeNull();
  });
});
