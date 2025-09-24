<template>
  <q-page class="q-pa-md" data-testid="settings-page">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">App Settings</div>
    </div>

    <q-card flat bordered class="q-pa-md q-mb-lg">
      <div class="text-subtitle1 q-mb-sm">LLM Provider</div>
      <q-select
        v-model="selectedProvider"
        :options="providerOptions"
        label="Provider"
        dense
        emit-value
        map-options
        data-testid="llm-provider-select"
      />

      <div class="row q-col-gutter-md q-mt-sm">
        <div class="col-12 col-md-6">
          <q-select
            v-model="model"
            :options="modelOptions"
            label="Model"
            dense
            options-dense
            use-input
            fill-input
            input-debounce="0"
            new-value-mode="add-unique"
            data-testid="llm-model-input"
            :hint="`Current provider: ${selectedProvider}`"
          />
        </div>
        <div class="col-12 col-md-6">
          <q-input
            v-model="apiKeyInput"
            :type="showApiKey ? 'text' : 'password'"
            label="API Key (optional)"
            dense
            outlined
            clearable
            data-testid="llm-api-key-input"
            :hint="apiKeyHint"
          >
            <template #append>
              <q-icon
                :name="showApiKey ? 'visibility_off' : 'visibility'"
                class="cursor-pointer"
                @click="showApiKey = !showApiKey"
              />
            </template>
          </q-input>
          <div class="row q-col-gutter-sm q-mt-xs">
            <div class="col-auto">
              <q-btn flat size="sm" label="Use server key" @click="clearApiKey" />
            </div>
            <div class="col-auto">
              <q-badge v-if="hasCustomKey" color="positive" outline>Using your key</q-badge>
              <q-badge v-else color="grey" outline>Using server key</q-badge>
            </div>
          </div>
        </div>
        <div class="col-12 col-md-4 q-mt-sm">
          <q-btn
            class="full-width"
            color="primary"
            label="Save"
            @click="save"
            data-testid="llm-save"
          />
        </div>
      </div>

      <q-separator class="q-my-md" />

      <div class="row items-center q-col-gutter-sm">
        <div class="col-12 col-md-auto">
          <q-btn flat label="Reset to defaults" color="secondary" @click="resetDefaults" />
        </div>
        <div class="col-12 col-md">
          <div class="text-caption">Active: {{ activeSummary }}</div>
        </div>
      </div>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LLMProviderName } from '../../services/llm';
import { useLLMSettingsStore } from '../../stores/llmSettings';

const store = useLLMSettingsStore();

const providerOptions = [
  { label: 'Google (Gemini API)', value: 'google' },
  { label: 'OpenRouter', value: 'openrouter' },
] as { label: string; value: LLMProviderName }[];

// Bind provider via computed to store; model uses local buffer and commits on save
const selectedProvider = computed<LLMProviderName>({
  get: () => store.provider,
  set: (v) => store.setProvider(v),
});
const model = ref<string>(store.currentModel);
const apiKeyInput = ref<string>(store.currentApiKey || '');
const showApiKey = ref(false);

// Keep local model buffer aligned when provider changes
watch(
  () => selectedProvider.value,
  () => {
    model.value = store.currentModel;
    apiKeyInput.value = store.currentApiKey || '';
  },
);

// Free-form dropdown options; start with the current model and allow user-typed entries
const modelOptions = ref<string[]>([store.currentModel]);

// Keep options including the current model when provider (and thus currentModel) changes
watch(
  () => selectedProvider.value,
  () => {
    model.value = store.currentModel;
    if (!modelOptions.value.includes(store.currentModel)) {
      modelOptions.value.unshift(store.currentModel);
    }
  },
);

const save = async () => {
  store.setModel(model.value.trim());
  store.setApiKey(apiKeyInput.value);
  await store.save();
  store.notifySaved();
};

const resetDefaults = async () => {
  await store.resetToDefaults();
  model.value = store.currentModel;
  apiKeyInput.value = store.currentApiKey || '';
};

const activeSummary = computed(() => `${store.provider} • ${store.currentModel}`);

const hasCustomKey = computed(() => !!store.currentApiKey);
const apiKeyHint = computed(() =>
  hasCustomKey.value
    ? 'Your personal API key will be used for this provider'
    : 'Optional: enter your own API key. Leave blank to use the server key',
);

const clearApiKey = () => {
  apiKeyInput.value = '';
};
</script>

<style scoped></style>
