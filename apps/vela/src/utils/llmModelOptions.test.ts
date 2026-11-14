import { describe, it, expect } from 'vitest';
import { LLM_PROVIDER_REGISTRY, LLM_PROVIDERS } from '@vela/common';
import {
  OPENROUTER_CUSTOM_VALUE,
  buildLlmModelOptions,
  confirmedServerKeyProviders,
  decodeModelValue,
  effortOptions,
  encodeModelPair,
  isPairAvailable,
  llmPairOption,
  pairToOptionValue,
  registryModel,
  registryModels,
} from './llmModelOptions';

describe('pair encoding', () => {
  it('encodes provider/model pairs with the double-colon separator', () => {
    expect(encodeModelPair('google', 'gemini-3.8-flash')).toBe('google::gemini-3.8-flash');
    expect(pairToOptionValue('google', 'gemini-3.8-flash')).toBe('google::gemini-3.8-flash');
  });

  it('maps every OpenRouter pair to the single custom entry', () => {
    expect(pairToOptionValue('openrouter', 'acme/model:free')).toBe(OPENROUTER_CUSTOM_VALUE);
    expect(OPENROUTER_CUSTOM_VALUE).toBe('openrouter::__custom__');
  });

  it('decodes values back into pairs', () => {
    expect(decodeModelValue('openai::gpt-6.1-sol')).toEqual({
      provider: 'openai',
      model: 'gpt-6.1-sol',
    });
    expect(decodeModelValue('openrouter::__custom__')).toEqual({
      provider: 'openrouter',
      model: '__custom__',
    });
  });

  it('rejects malformed or unknown-provider values', () => {
    expect(decodeModelValue('no-separator')).toBeNull();
    expect(decodeModelValue('::model')).toBeNull();
    expect(decodeModelValue('bogus::model')).toBeNull();
    expect(decodeModelValue('')).toBeNull();
  });

  it('keeps extra separators inside the model id', () => {
    expect(decodeModelValue('anthropic::weird::id')).toEqual({
      provider: 'anthropic',
      model: 'weird::id',
    });
  });
});

describe('registry helpers', () => {
  it('returns the registry model list and empty list for free-form providers', () => {
    expect(registryModels('anthropic')).toEqual(LLM_PROVIDER_REGISTRY.anthropic.models);
    expect(registryModels('openrouter')).toEqual([]);
  });

  it('finds a registry model for a known pair and null otherwise', () => {
    expect(registryModel({ provider: 'google', model: 'gemini-4-argon' })).toEqual(
      LLM_PROVIDER_REGISTRY.google.models?.[1] ?? null,
    );
    expect(registryModel({ provider: 'openrouter', model: 'acme/custom' })).toBeNull();
    expect(registryModel({ provider: 'google', model: 'not-in-registry' })).toBeNull();
    expect(registryModel(null)).toBeNull();
  });

  it('builds Default plus native effort options in provider order', () => {
    const model = LLM_PROVIDER_REGISTRY.anthropic.models![0]!;
    expect(effortOptions(model)).toEqual([
      { label: 'Default', value: '' },
      ...model.efforts.map((effort) => ({ label: effort, value: effort })),
    ]);
  });
});

describe('confirmedServerKeyProviders', () => {
  it('parses valid providers and drops unknown entries', () => {
    expect(
      confirmedServerKeyProviders(
        { serverKeyProviders: ['google', 'bogus', 'openrouter'] },
        {
          isAuthenticated: true,
          isError: false,
        },
      ),
    ).toEqual(['google', 'openrouter']);
  });

  it('returns nothing when unauthenticated', () => {
    expect(
      confirmedServerKeyProviders(
        { serverKeyProviders: ['google'] },
        {
          isAuthenticated: false,
          isError: false,
        },
      ),
    ).toEqual([]);
  });

  it('returns nothing when the capabilities lookup failed', () => {
    expect(
      confirmedServerKeyProviders(
        { serverKeyProviders: ['google'] },
        {
          isAuthenticated: true,
          isError: true,
        },
      ),
    ).toEqual([]);
  });

  it('returns nothing without data', () => {
    expect(
      confirmedServerKeyProviders(undefined, { isAuthenticated: true, isError: false }),
    ).toEqual([]);
  });
});

describe('buildLlmModelOptions', () => {
  it('lists registry models only for providers with a user key', () => {
    const options = buildLlmModelOptions({ openai: 'key' });
    expect(options.map((option) => option.value)).toEqual(
      LLM_PROVIDER_REGISTRY.openai.models!.map((model) => `openai::${model.id}`),
    );
    expect(options.every((option) => !option.label.includes('server key'))).toBe(true);
    expect(options.every((option) => option.provider === 'openai')).toBe(true);
  });

  it('lists server-key providers with the server key suffix', () => {
    const options = buildLlmModelOptions({}, ['google', 'openrouter']);
    expect(options.some((option) => option.value === 'google::gemini-3.8-flash')).toBe(true);
    expect(options.some((option) => option.label.includes('server key'))).toBe(true);
    expect(options.some((option) => option.value === OPENROUTER_CUSTOM_VALUE)).toBe(true);
    expect(options.some((option) => option.value.startsWith('anthropic::'))).toBe(false);
  });

  it('prefers the plain label when a user key exists even with a server key', () => {
    const options = buildLlmModelOptions({ google: 'key' }, ['google']);
    expect(options.every((option) => !option.label.includes('server key'))).toBe(true);
  });

  it('offers a single custom OpenRouter entry regardless of key source', () => {
    const withUserKey = buildLlmModelOptions({ openrouter: 'key' }).filter(
      (option) => option.provider === 'openrouter',
    );
    const withServerKey = buildLlmModelOptions({}, ['openrouter']).filter(
      (option) => option.provider === 'openrouter',
    );
    expect(withUserKey).toHaveLength(1);
    expect(withServerKey).toHaveLength(1);
    expect(withUserKey[0]!.value).toBe(OPENROUTER_CUSTOM_VALUE);
    expect(withServerKey[0]!.value).toBe(OPENROUTER_CUSTOM_VALUE);
    expect(withUserKey[0]!.label).not.toContain('server key');
    expect(withServerKey[0]!.label).toContain('server key');
  });

  it('returns nothing when no provider is usable', () => {
    expect(buildLlmModelOptions({}, [])).toEqual([]);
    expect(buildLlmModelOptions({}, [])).toHaveLength(0);
  });

  it('walks providers in registry order', () => {
    const options = buildLlmModelOptions(
      Object.fromEntries(LLM_PROVIDERS.map((provider) => [provider, 'key'])),
    );
    const providersInOrder = [...new Set(options.map((option) => option.provider))];
    expect(providersInOrder).toEqual([...LLM_PROVIDERS]);
  });
});

describe('llmPairOption', () => {
  it('labels registry pairs with the provider display label', () => {
    const option = llmPairOption('anthropic', 'claude-opus-5-5');
    expect(option).toEqual({
      label: 'Anthropic — claude-opus-5-5',
      value: 'anthropic::claude-opus-5-5',
      provider: 'anthropic',
    });
  });

  it('labels OpenRouter pairs as the custom entry', () => {
    const option = llmPairOption('openrouter', 'acme/custom');
    expect(option.label).toBe('OpenRouter (custom ID)');
    expect(option.value).toBe(OPENROUTER_CUSTOM_VALUE);
    expect(option.provider).toBe('openrouter');
  });
});

describe('isPairAvailable', () => {
  it('accepts pairs whose option is present and not disabled', () => {
    const options = buildLlmModelOptions({ google: 'key', openrouter: 'key' });
    expect(isPairAvailable(options, { provider: 'google', model: 'gemini-3.8-flash' })).toBe(true);
    // The free-form OpenRouter custom entry is available like any other.
    expect(isPairAvailable(options, { provider: 'openrouter', model: 'acme/custom' })).toBe(true);
  });

  it('rejects pairs whose only option is the display-only disabled one', () => {
    const options = [
      ...buildLlmModelOptions({ google: 'key' }),
      { ...llmPairOption('anthropic', 'claude-opus-5-5'), disabled: true },
    ];
    expect(isPairAvailable(options, { provider: 'anthropic', model: 'claude-opus-5-5' })).toBe(
      false,
    );
  });

  it('rejects pairs that are not among the options at all', () => {
    const options = buildLlmModelOptions({ google: 'key' });
    expect(isPairAvailable(options, { provider: 'openai', model: 'gpt-6.1-sol' })).toBe(false);
    // A retired/unknown registry id under a keyed provider is unavailable.
    expect(isPairAvailable(options, { provider: 'google', model: 'retired-model' })).toBe(false);
  });
});
