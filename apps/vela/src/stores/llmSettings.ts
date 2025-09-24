import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { LocalStorage, Notify } from 'quasar';
import type { LLMProviderName } from '../services/llm';
import { llmService } from '../services/llm';
import { useAuthStore } from './auth';
import type { UserPreferences } from '../types/shared';

export type ProviderModelMap = Partial<Record<LLMProviderName, string>>;
export type ProviderKeyMap = Partial<Record<LLMProviderName, string>>;

interface PersistedSettings {
  provider: LLMProviderName;
  models: ProviderModelMap;
  keys?: ProviderKeyMap;
}

const STORAGE_KEY = 'llm_settings_v1';

export const useLLMSettingsStore = defineStore('llmSettings', () => {
  // Internal defaults (no env)
  const DEFAULT_PROVIDER: LLMProviderName = 'google';
  const DEFAULT_MODELS: ProviderModelMap = {
    google: 'gemini-2.5-flash-lite',
    openrouter: 'openai/gpt-oss-20b:free',
  };

  // State
  const provider = ref<LLMProviderName>(DEFAULT_PROVIDER);
  const models = ref<ProviderModelMap>({ ...DEFAULT_MODELS });
  const keys = ref<ProviderKeyMap>({});

  // Getters
  const currentModel = computed(
    () =>
      models.value[provider.value] ||
      DEFAULT_MODELS[provider.value] ||
      DEFAULT_MODELS[DEFAULT_PROVIDER]!,
  );

  const currentApiKey = computed(() => keys.value[provider.value]);

  // Actions
  const setProvider = (name: LLMProviderName) => {
    provider.value = name;
    // ensure model exists for provider
    if (!models.value[name]) {
      models.value[name] = name === 'google' ? DEFAULT_MODELS.google! : DEFAULT_MODELS.openrouter!;
    }
    // apply to service
    llmService.setProvider(name, models.value[name]);
    llmService.setApiKey(keys.value[name]);
    persist();
  };

  const setModel = (model: string) => {
    models.value[provider.value] = model;
    llmService.setModel(model);
    persist();
  };

  const persist = () => {
    const data: PersistedSettings = {
      provider: provider.value,
      models: models.value,
      keys: keys.value,
    };
    LocalStorage.set(STORAGE_KEY, data);
  };

  // Profile integration
  const auth = useAuthStore();

  const applyToService = () => {
    llmService.setProvider(provider.value, currentModel.value);
    llmService.setModel(currentModel.value);
    llmService.setApiKey(currentApiKey.value);
  };

  const loadFromProfile = () => {
    const prefs: UserPreferences | undefined = auth.user?.preferences as
      | UserPreferences
      | undefined;
    if (!prefs) return false;
    const p = prefs.llm_provider;
    const m = prefs.llm_models;
    const k = (prefs as any).llm_keys as ProviderKeyMap | undefined;
    if (p) provider.value = p;
    if (m) models.value = { ...models.value, ...m };
    if (k) keys.value = { ...keys.value, ...k };
    applyToService();
    return !!p || !!m || !!k;
  };

  const saveToProfile = async () => {
    if (!auth.user) return false;
    const existing: UserPreferences =
      (auth.user.preferences as UserPreferences) || ({} as UserPreferences);
    const nextPrefs: UserPreferences = {
      ...existing,
      llm_provider: provider.value,
      llm_models: models.value,
      llm_keys: keys.value,
    };
    const ok = await auth.updateProfile({
      preferences: nextPrefs as unknown as Record<string, unknown>,
    });
    return ok;
  };

  const load = () => {
    // Try DB first
    const loadedFromDb = loadFromProfile();
    if (!loadedFromDb) {
      const data = LocalStorage.getItem<PersistedSettings>(STORAGE_KEY) || null;
      if (data && data.provider) {
        provider.value = data.provider;
        models.value = data.models || {};
        keys.value = data.keys || {};
      }
      applyToService();
    }
  };

  // Auto-load once store is created
  load();

  // Keep service in sync on changes (defensive)
  watch(provider, (p) => {
    llmService.setProvider(p, currentModel.value);
    llmService.setApiKey(currentApiKey.value);
  });
  watch(
    () => currentModel.value,
    (m) => {
      llmService.setModel(m);
    },
  );
  watch(
    () => currentApiKey.value,
    (k) => {
      llmService.setApiKey(k);
    },
  );

  // React to auth user availability to load profile-backed settings
  watch(
    () => auth.user?.id,
    () => {
      loadFromProfile();
    },
  );

  const notifySaved = () => {
    Notify.create({ type: 'positive', message: 'LLM settings saved' });
  };

  const resetToDefaults = async () => {
    provider.value = DEFAULT_PROVIDER;
    models.value = { ...DEFAULT_MODELS };
    keys.value = {};
    applyToService();
    persist();
    await saveToProfile();
  };

  const save = async () => {
    persist();
    await saveToProfile();
  };

  const setApiKey = (key?: string | null) => {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      delete keys.value[provider.value];
    } else {
      keys.value[provider.value] = trimmed;
    }
    applyToService();
    persist();
  };

  return {
    // state
    provider,
    models,
    keys,
    // getters
    currentModel,
    currentApiKey,
    // actions
    setProvider,
    setModel,
    setApiKey,
    persist,
    load,
    save,
    resetToDefaults,
    notifySaved,
  };
});
