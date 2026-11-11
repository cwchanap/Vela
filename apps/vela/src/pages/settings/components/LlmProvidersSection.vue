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
      <template v-if="!hasSelectionKey && hasSelectionServerKey">
        — Chat uses the server key; My Dictionaries requires your own
        {{ selectionProviderLabel }} API key</template
      >
      <template
        v-else-if="!hasSelectionKey && isAuthenticated && capabilitiesQuery.isPending?.value"
      >
        — Checking server key availability…</template
      >
      <template v-else-if="!hasSelectionKey && !capabilitiesQuery.isError.value">
        — No API key saved for {{ selectionProviderLabel }}</template
      >
    </div>
    <div
      v-if="isAuthenticated && capabilitiesQuery.isError.value"
      class="text-caption text-warning"
      role="alert"
    >
      Server key availability could not be checked.
      <q-btn
        flat
        dense
        label="Retry"
        data-testid="retry-capabilities"
        @click="capabilitiesQuery.refetch()"
      />
    </div>
    <div v-if="serverKeyProviderLabels.length" class="text-caption text-grey">
      Server key available for chat: {{ serverKeyProviderLabels.join(', ') }}. My Dictionaries uses
      only your saved API keys.
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
import {
  OPENROUTER_CUSTOM_VALUE,
  buildLlmModelOptions,
  confirmedServerKeyProviders,
  decodeModelValue,
  llmPairOption,
  pairToOptionValue,
} from '../../../utils/llmModelOptions';
import { useLlmCapabilitiesQuery } from '../../../composables/queries/useLlmCapabilitiesQuery';
import LlmProviderCard from './LlmProviderCard.vue';

const store = useLLMSettingsStore();
const authStore = useAuthStore();
const isAuthenticated = computed(() => authStore.isAuthenticated);
const capabilitiesQuery = useLlmCapabilitiesQuery();

const serverKeyProviders = computed<LlmProvider[]>(() =>
  confirmedServerKeyProviders(capabilitiesQuery.data.value, {
    isAuthenticated: isAuthenticated.value,
    isError: capabilitiesQuery.isError.value,
  }),
);
const serverKeyProviderLabels = computed(() =>
  serverKeyProviders.value.map((provider) => LLM_PROVIDER_REGISTRY[provider].label),
);

const defaultOptions = computed(() => {
  const options = buildLlmModelOptions(store.llm.keys, serverKeyProviders.value);
  const { provider, model } = store.llm.defaultModel;
  const currentValue = pairToOptionValue(provider, model);
  if (!options.some((option) => option.value === currentValue)) {
    options.push(llmPairOption(provider, model));
  }
  const draft = draftPairValue.value;
  if (!options.some((option) => option.value === draft)) {
    const draftPair = decodeModelValue(draft);
    if (draftPair) options.push(llmPairOption(draftPair.provider, draftPair.model));
  }
  return options;
});

const draftPairValue = ref(
  pairToOptionValue(store.llm.defaultModel.provider, store.llm.defaultModel.model),
);
const customModelId = ref(
  store.llm.defaultModel.provider === 'openrouter' ? store.llm.defaultModel.model : '',
);
const savingDefault = ref(false);
let activeDefaultSave: symbol | null = null;

watch(
  () => [store.llm.defaultModel, authStore.user?.id, authStore.sessionGeneration] as const,
  ([dm, userId, generation], [prevDm, prevUserId, prevGeneration]) => {
    const sessionChanged = userId !== prevUserId || generation !== prevGeneration;
    const pairChanged = dm.provider !== prevDm.provider || dm.model !== prevDm.model;
    if (!sessionChanged && !pairChanged) return;
    if (sessionChanged) {
      activeDefaultSave = null;
      savingDefault.value = false;
    } else if (
      activeDefaultSave ||
      draftPairValue.value !== pairToOptionValue(prevDm.provider, prevDm.model) ||
      (prevDm.provider === 'openrouter' && customModelId.value !== prevDm.model)
    ) {
      return;
    }
    draftPairValue.value = pairToOptionValue(dm.provider, dm.model);
    customModelId.value = dm.provider === 'openrouter' ? dm.model : '';
  },
  { deep: true },
);

const isCustomSelected = computed(() => draftPairValue.value === OPENROUTER_CUSTOM_VALUE);

const selectionProviderLabel = computed(
  () => LLM_PROVIDER_REGISTRY[store.llm.defaultModel.provider].label,
);
const selectionLabel = computed(
  () => `${selectionProviderLabel.value} • ${store.llm.defaultModel.model}`,
);
const hasSelectionKey = computed(() => !!store.llm.keys[store.llm.defaultModel.provider]);
const hasSelectionServerKey = computed(() =>
  serverKeyProviders.value.includes(store.llm.defaultModel.provider),
);

const saveDefault = async () => {
  let pair: { provider: LlmProvider; model: string };
  if (draftPairValue.value === OPENROUTER_CUSTOM_VALUE) {
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
  const generation = authStore.sessionGeneration;
  const submittedValue = draftPairValue.value;
  const submittedModel = customModelId.value;
  const saveToken = Symbol('default-save');
  activeDefaultSave = saveToken;
  savingDefault.value = true;
  try {
    const ok = await store.saveDefault(pair);
    if (authStore.sessionGeneration !== generation) return;
    if (ok) {
      if (draftPairValue.value === submittedValue && customModelId.value === submittedModel) {
        const dm = store.llm.defaultModel;
        draftPairValue.value = pairToOptionValue(dm.provider, dm.model);
        customModelId.value = dm.provider === 'openrouter' ? dm.model : '';
      }
      Notify.create({ type: 'positive', message: 'Default model saved', position: 'top' });
    } else {
      Notify.create({
        type: 'negative',
        message: authStore.error || 'Failed to save default model',
        position: 'top',
      });
    }
  } finally {
    if (activeDefaultSave === saveToken) {
      activeDefaultSave = null;
      savingDefault.value = false;
    }
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
