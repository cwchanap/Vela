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
        <div class="col-12 col-md-8">
          <q-input
            v-model="model"
            label="Model"
            dense
            data-testid="llm-model-input"
            :hint="`Current provider: ${selectedProvider}`"
          />
        </div>
        <div class="col-12 col-md-4">
          <q-btn
            class="full-width"
            color="primary"
            label="Save"
            @click="save"
            data-testid="llm-save"
          />
        </div>
      </div>

      <div class="q-mt-md">
        <div class="text-caption text-grey-7 q-mb-xs">Recommended models</div>
        <div class="row q-col-gutter-sm">
          <div v-for="m in recommendedModels" :key="m" class="col-auto">
            <q-chip clickable outline color="primary" @click="applyRecommended(m)">{{ m }}</q-chip>
          </div>
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

// Keep local model buffer aligned when provider changes
watch(
  () => selectedProvider.value,
  () => {
    model.value = store.currentModel;
  },
);

const recommendedByProvider: Record<LLMProviderName, string[]> = {
  google: ['gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  openrouter: [
    'openai/gpt-oss-20b:free',
    'moonshotai/kimi-k2:free',
    'deepseek/deepseek-r1-0528:free',
    'z-ai/glm-4.5-air:free',
    'google/gemma-3-27b-it:free',
  ],
};

const recommendedModels = computed(() => recommendedByProvider[selectedProvider.value] || []);

const save = async () => {
  store.setModel(model.value.trim());
  await store.save();
  store.notifySaved();
};

const resetDefaults = async () => {
  await store.resetToDefaults();
  model.value = store.currentModel;
};

const activeSummary = computed(() => `${store.provider} • ${store.currentModel}`);

function applyRecommended(m: string) {
  model.value = m;
}
</script>

<style scoped></style>
