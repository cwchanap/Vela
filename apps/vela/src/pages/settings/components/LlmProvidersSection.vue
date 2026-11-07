<template>
  <q-card flat bordered class="q-pa-md q-mb-lg">
    <div class="text-subtitle1 q-mb-sm">LLM Providers</div>

    <div class="row q-col-gutter-md items-end">
      <div class="col-12 col-md-6">
        <q-select
          v-model="draftPairValue"
          :options="defaultOptions"
          label="Default model"
          dense
          emit-value
          map-options
          data-testid="llm-default-model-select"
        />
      </div>
      <div v-if="isCustomSelected" class="col-12 col-md-6">
        <q-input
          v-model="customModelId"
          label="Custom model ID"
          dense
          outlined
          data-testid="llm-default-model-input"
          hint="OpenRouter model ID, e.g. vendor/model"
        />
      </div>
      <div class="col-12 col-md-4">
        <q-btn
          color="primary"
          label="Save default"
          :loading="savingDefault"
          :disable="!isAuthenticated"
          data-testid="llm-default-save"
          @click="saveDefault"
        />
      </div>
    </div>

    <div class="text-caption q-mt-sm" :class="hasSelectionKey ? 'text-grey' : 'text-warning'">
      Active: {{ selectionLabel }}
      <template v-if="!hasSelectionKey">
        — No API key saved for {{ selectionProviderLabel }}</template
      >
    </div>
    <div v-if="!isAuthenticated" class="text-caption text-grey">Sign in to save LLM settings</div>

    <q-separator class="q-my-md" />

    <LlmProviderCard v-for="provider in LLM_PROVIDERS" :key="provider" :provider="provider" />
  </q-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Notify } from 'quasar';
import { LLM_PROVIDER_REGISTRY, LLM_PROVIDERS, type LlmProvider } from '@vela/common';
import { useLLMSettingsStore } from 'src/stores/llmSettings';
import { useAuthStore } from 'src/stores/auth';
import LlmProviderCard from './LlmProviderCard.vue';

const store = useLLMSettingsStore();
const authStore = useAuthStore();
const isAuthenticated = computed(() => authStore.isAuthenticated);

// Sentinel marking "OpenRouter (custom ID)" in the Default model select; the
// free-form ID itself lives in the adjacent input, never inside the card.
const CUSTOM_VALUE = 'openrouter::__custom__';
const encode = (provider: LlmProvider, model: string) => `${provider}::${model}`;

const pairToValue = (provider: LlmProvider, model: string) =>
  provider === 'openrouter' ? CUSTOM_VALUE : encode(provider, model);

// Until the Task 3 capability query exists, a provider's models are eligible
// only when the user saved a key for it. The current pair always stays
// visible even when it is not eligible — deleting a key must not silently
// reselect the default.
const defaultOptions = computed(() => {
  const options: { label: string; value: string }[] = [];
  for (const provider of LLM_PROVIDERS) {
    if (!store.llm.keys[provider]) continue;
    const registry = LLM_PROVIDER_REGISTRY[provider];
    if (registry.models) {
      for (const model of registry.models) {
        options.push({
          label: `${registry.label} — ${model.id}`,
          value: encode(provider, model.id),
        });
      }
    } else {
      options.push({ label: 'OpenRouter (custom ID)', value: CUSTOM_VALUE });
    }
  }
  const { provider, model } = store.llm.defaultModel;
  const currentValue = pairToValue(provider, model);
  if (!options.some((option) => option.value === currentValue)) {
    options.push(
      provider === 'openrouter'
        ? { label: 'OpenRouter (custom ID)', value: CUSTOM_VALUE }
        : { label: `${LLM_PROVIDER_REGISTRY[provider].label} — ${model}`, value: currentValue },
    );
  }
  return options;
});

const draftPairValue = ref(
  pairToValue(store.llm.defaultModel.provider, store.llm.defaultModel.model),
);
const customModelId = ref(
  store.llm.defaultModel.provider === 'openrouter' ? store.llm.defaultModel.model : '',
);
const savingDefault = ref(false);

// The selector draft tracks the persisted pair: sign-out, account switch and
// hydration reset it, while a key deletion never rewrites the pair itself.
watch(
  () => store.llm.defaultModel,
  (dm) => {
    draftPairValue.value = pairToValue(dm.provider, dm.model);
    if (dm.provider === 'openrouter') {
      customModelId.value = dm.model;
    }
  },
  { deep: true },
);

const isCustomSelected = computed(() => draftPairValue.value === CUSTOM_VALUE);

const selectionProviderLabel = computed(
  () => LLM_PROVIDER_REGISTRY[store.llm.defaultModel.provider].label,
);
const selectionLabel = computed(
  () => `${selectionProviderLabel.value} • ${store.llm.defaultModel.model}`,
);
const hasSelectionKey = computed(() => !!store.llm.keys[store.llm.defaultModel.provider]);

const saveDefault = async () => {
  let pair: { provider: LlmProvider; model: string };
  if (draftPairValue.value === CUSTOM_VALUE) {
    const model = customModelId.value.trim();
    if (!model) {
      Notify.create({
        type: 'negative',
        message: 'Enter a model ID before saving',
        position: 'top',
      });
      return;
    }
    pair = { provider: 'openrouter', model };
  } else {
    const separator = draftPairValue.value.indexOf('::');
    pair = {
      provider: draftPairValue.value.slice(0, separator) as LlmProvider,
      model: draftPairValue.value.slice(separator + 2),
    };
  }
  savingDefault.value = true;
  try {
    const ok = await store.saveDefault(pair);
    if (ok) {
      Notify.create({ type: 'positive', message: 'Default model saved', position: 'top' });
    } else {
      Notify.create({
        type: 'negative',
        message: 'Failed to save default model',
        position: 'top',
      });
    }
  } finally {
    savingDefault.value = false;
  }
};
</script>

<style scoped>
/* Improve text contrast in dark mode */
body.body--dark .text-grey,
body.body--dark .text-caption {
  color: #b8b8b8 !important;
}
</style>
