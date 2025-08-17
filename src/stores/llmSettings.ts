import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { LocalStorage, Notify } from 'quasar';
import { config } from '../config';
import type { LLMProviderName } from '../services/llm';
import { llmService } from '../services/llm';

export type ProviderModelMap = Partial<Record<LLMProviderName, string>>;

interface PersistedSettings {
  provider: LLMProviderName;
  models: ProviderModelMap;
}

const STORAGE_KEY = 'llm_settings_v1';

export const useLLMSettingsStore = defineStore('llmSettings', () => {
  // Defaults from env config
  const defaultProvider = (config.ai.defaultProvider || 'google') as LLMProviderName;
  const defaultModel = config.ai.defaultModel || 'gemini-2.5-flash-lite';

  // State
  const provider = ref<LLMProviderName>(defaultProvider);
  const models = ref<ProviderModelMap>({ [defaultProvider]: defaultModel });

  // Getters
  const currentModel = computed(() => models.value[provider.value] || defaultModel);

  // Actions
  const setProvider = (name: LLMProviderName) => {
    provider.value = name;
    // ensure model exists for provider
    if (!models.value[name]) {
      models.value[name] =
        name === 'google' ? 'gemini-2.5-flash-lite' : 'anthropic/claude-3.5-haiku';
    }
    // apply to service
    llmService.setProvider(name, models.value[name]);
    persist();
  };

  const setModel = (model: string) => {
    models.value[provider.value] = model;
    llmService.setModel(model);
    persist();
  };

  const persist = () => {
    const data: PersistedSettings = { provider: provider.value, models: models.value };
    LocalStorage.set(STORAGE_KEY, data);
  };

  const load = () => {
    const data = LocalStorage.getItem<PersistedSettings>(STORAGE_KEY) || null;
    if (data && data.provider) {
      provider.value = data.provider;
      models.value = data.models || {};
    }
    // Apply to llmService on load
    llmService.setProvider(provider.value, currentModel.value);
  };

  // Auto-load once store is created
  load();

  // Keep service in sync on changes (defensive)
  watch(provider, (p) => {
    llmService.setProvider(p, currentModel.value);
  });
  watch(
    () => currentModel.value,
    (m) => {
      llmService.setModel(m);
    },
  );

  const notifySaved = () => {
    Notify.create({ type: 'positive', message: 'LLM settings saved' });
  };

  return {
    // state
    provider,
    models,
    // getters
    currentModel,
    // actions
    setProvider,
    setModel,
    persist,
    load,
    notifySaved,
  };
});
