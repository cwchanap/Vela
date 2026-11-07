<template>
  <q-expansion-item
    v-model="expanded"
    expand-separator
    :label="label"
    :data-testid="`llm-card-${provider}`"
  >
    <div class="q-pa-sm q-gutter-md">
      <q-input
        v-model="draftKey"
        :type="showKey ? 'text' : 'password'"
        :label="`${label} API Key`"
        dense
        outlined
        clearable
        :data-testid="`llm-key-input-${provider}`"
        :hint="
          hasKey ? 'A saved key exists for this provider' : 'Enter your API key for this provider'
        "
      >
        <template #append>
          <q-icon
            :name="showKey ? 'visibility_off' : 'visibility'"
            class="cursor-pointer"
            @click="showKey = !showKey"
          />
        </template>
      </q-input>

      <div class="row items-center">
        <q-badge v-if="hasKey" color="positive" outline>Key saved</q-badge>
        <q-badge v-else color="grey" outline>No key saved</q-badge>
      </div>

      <template v-if="providerModels.length">
        <div
          v-for="model in providerModels"
          :key="model.id"
          class="row items-center q-col-gutter-sm"
        >
          <div class="col text-body2">{{ model.id }}</div>
          <div class="col-auto">
            <q-select
              v-model="draftEfforts[model.id]"
              :options="effortOptions(model)"
              label="Thinking"
              dense
              emit-value
              map-options
              :data-testid="`llm-effort-${model.id}`"
            />
          </div>
        </div>
        <div class="text-caption text-grey">High and above may time out in My Dictionaries.</div>
      </template>
      <div v-else class="text-caption text-grey">Free-form model IDs; no thinking controls.</div>

      <div>
        <q-btn
          color="primary"
          label="Save"
          :loading="saving"
          :disable="!isAuthenticated"
          :data-testid="`llm-save-${provider}`"
          @click="save"
        />
      </div>
    </div>
  </q-expansion-item>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Notify } from 'quasar';
import {
  LLM_PROVIDER_REGISTRY,
  type LlmEffort,
  type LlmModelInfo,
  type LlmProvider,
} from '@vela/common';
import { useLLMSettingsStore, type LlmThinkingPatch } from 'src/stores/llmSettings';
import { useAuthStore } from 'src/stores/auth';

const props = defineProps<{ provider: LlmProvider }>();

const store = useLLMSettingsStore();
const authStore = useAuthStore();

const label = computed(() => LLM_PROVIDER_REGISTRY[props.provider].label);
const providerModels = computed<readonly LlmModelInfo[]>(
  () => LLM_PROVIDER_REGISTRY[props.provider].models ?? [],
);
const hasKey = computed(() => !!store.llm.keys[props.provider]);
const isAuthenticated = computed(() => authStore.isAuthenticated);

const expanded = ref(false);
const showKey = ref(false);
const saving = ref(false);

// '' is the "Default" effort sentinel — no stored override.
type EffortDraft = LlmEffort | '';

const readSavedSlice = () => ({
  key: store.llm.keys[props.provider] ?? '',
  efforts: providerModels.value.map((m) => (store.llm.thinking[m.id] ?? '') as EffortDraft),
});

// Drafts initialize from the saved slice; rows with no override stay on
// "Default" rather than being prefilled with registry defaults.
let lastSlice = readSavedSlice();
const draftKey = ref(lastSlice.key);
const draftEfforts = ref<Record<string, EffortDraft>>(
  Object.fromEntries(providerModels.value.map((m, i) => [m.id, lastSlice.efforts[i] ?? ''])),
);

// Resync a draft field only when its own saved value changed: another card's
// save or expansion never touches this card's unsaved drafts, while sign-out,
// account switch, and preference hydration still refresh them.
watch(
  () => store.llm,
  () => {
    const next = readSavedSlice();
    if (next.key !== lastSlice.key) draftKey.value = next.key;
    providerModels.value.forEach((model, i) => {
      const effort = next.efforts[i] ?? '';
      if (effort !== lastSlice.efforts[i]) draftEfforts.value[model.id] = effort;
    });
    lastSlice = next;
  },
  { deep: true },
);

const effortOptions = (model: LlmModelInfo) => [
  { label: 'Default', value: '' },
  ...model.efforts.map((effort) => ({ label: effort, value: effort })),
];

const save = async () => {
  const patch: LlmThinkingPatch = {};
  for (const model of providerModels.value) {
    patch[model.id] = draftEfforts.value[model.id] || null;
  }
  saving.value = true;
  try {
    const ok = await store.saveProvider(props.provider, draftKey.value, patch);
    if (ok) {
      Notify.create({
        type: 'positive',
        message: `${label.value} settings saved`,
        position: 'top',
      });
    } else {
      Notify.create({
        type: 'negative',
        message: `Failed to save ${label.value} settings`,
        position: 'top',
      });
    }
  } finally {
    saving.value = false;
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
