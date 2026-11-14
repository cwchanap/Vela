<template>
  <div class="chat-model-picker" data-testid="chat-model-picker">
    <q-select
      v-model="selectValue"
      :options="options"
      :disable="disabled"
      option-disable="disabled"
      emit-value
      map-options
      dense
      outlined
      label="Model"
      class="chat-model-select"
      data-testid="chat-model-select"
    >
      <template #option="scope">
        <div
          v-if="isGroupStart(scope.index)"
          :key="`group-${scope.index}`"
          class="q-item__label q-item__label--header chat-model-group-label"
          data-testid="chat-model-group"
        >
          {{ providerLabel(scope.opt.provider) }}
        </div>
        <q-item
          :key="scope.index"
          v-bind="scope.itemProps"
          :class="{ 'q-virtual-scroll--with-prev': isGroupStart(scope.index) }"
        >
          <q-item-section>{{ scope.opt.label }}</q-item-section>
        </q-item>
      </template>
    </q-select>
    <q-input
      v-if="showCustomInput"
      v-model="customModelId"
      :disable="disabled"
      dense
      outlined
      label="Custom model ID"
      hint="OpenRouter model ID, e.g. vendor/model"
      class="chat-custom-model-input"
      data-testid="chat-custom-model-input"
      @keydown.enter.prevent="confirmCustom"
    >
      <template #append>
        <q-btn
          round
          dense
          flat
          icon="check"
          :disable="disabled || !customModelId.trim()"
          :aria-label="'Use this model'"
          data-testid="chat-custom-model-apply"
          @click="confirmCustom"
        />
      </template>
    </q-input>
    <q-select
      v-if="thinkingChoices.length"
      v-model="thinkingModelValue"
      :options="thinkingChoices"
      :disable="disabled"
      dense
      outlined
      emit-value
      map-options
      label="Thinking"
      class="chat-thinking-select"
      data-testid="chat-thinking-select"
    />
    <div
      v-if="currentUnavailable"
      class="chat-model-unavailable text-caption text-warning"
      data-testid="chat-model-unavailable"
    >
      Model unavailable — add an API key in Settings or retry the availability check.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LlmEffort, LlmModelPair, LlmProvider } from '@vela/common';
import { LLM_PROVIDER_REGISTRY } from '@vela/common';
import {
  OPENROUTER_CUSTOM_VALUE,
  decodeModelValue,
  effortOptions,
  isPairAvailable,
  pairToOptionValue,
  registryModel,
  type LlmModelOption,
} from 'src/utils/llmModelOptions';

const props = defineProps<{
  pair: LlmModelPair | null;
  options: LlmModelOption[];
  thinking?: LlmEffort | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:pair': [pair: LlmModelPair];
  'update:thinking': [effort: LlmEffort | null];
}>();

const isCustomSelected = computed(() => props.pair?.provider === 'openrouter');

// The custom entry also needs its input while the picked draft is still
// unconfirmed (no active OpenRouter pair yet).
const customDraftActive = ref(false);
const showCustomInput = computed(() => isCustomSelected.value || customDraftActive.value);

const customModelId = ref(props.pair?.provider === 'openrouter' ? props.pair.model : '');
const customApplyPending = ref(false);

const syncCustomFromPair = (pair: LlmModelPair | null) => {
  customApplyPending.value = false;
  if (pair?.provider === 'openrouter') {
    customModelId.value = pair.model;
  } else {
    customDraftActive.value = false;
    customModelId.value = '';
  }
};

watch(
  () => props.pair,
  (pair) => {
    syncCustomFromPair(pair);
  },
  { flush: 'sync' },
);

watch(
  () => props.disabled,
  (disabled, wasDisabled) => {
    // A pending cycle that ends without updating props.pair means the commit
    // failed/rejected: revert the unaccepted custom ID back to the active pair.
    if (wasDisabled && !disabled && customApplyPending.value) {
      syncCustomFromPair(props.pair);
    }
  },
  { flush: 'sync' },
);

const confirmCustom = () => {
  const model = customModelId.value.trim();
  if (!model) return;
  if (props.pair?.provider === 'openrouter' && props.pair.model === model) {
    customModelId.value = model;
    return;
  }
  customApplyPending.value = true;
  emit('update:pair', { provider: 'openrouter', model });
};

const selectValue = computed<string>({
  get: () => (props.pair ? pairToOptionValue(props.pair.provider, props.pair.model) : ''),
  set: (value) => {
    if (value === OPENROUTER_CUSTOM_VALUE) {
      // Free-form IDs need an explicit nonempty confirmation before activating.
      customDraftActive.value = true;
      customModelId.value = props.pair?.provider === 'openrouter' ? props.pair.model : '';
      return;
    }
    customDraftActive.value = false;
    const pair = decodeModelValue(value);
    if (pair) emit('update:pair', pair);
  },
});

// Default ('' → null) means the saved Settings override, else the registry default.
const thinkingChoices = computed(() => {
  const model = registryModel(props.pair);
  return model ? effortOptions(model) : [];
});

const thinkingModelValue = computed<LlmEffort | ''>({
  get: () => props.thinking ?? '',
  set: (value) => emit('update:thinking', (value || null) as LlmEffort | null),
});

const currentUnavailable = computed(
  () => !!props.pair && !isPairAvailable(props.options, props.pair),
);

// Provider sections render in the option slot at each group boundary; the
// single OpenRouter custom entry is its own section. The item after a header
// carries q-virtual-scroll--with-prev so Quasar's virtual scroll measures
// header+item as one logical option instead of shifting size/index accounting.
const isGroupStart = (index: number) =>
  index === 0 || props.options[index]!.provider !== props.options[index - 1]!.provider;
const providerLabel = (provider: LlmProvider) => LLM_PROVIDER_REGISTRY[provider].label;
</script>

<style scoped lang="scss">
.chat-model-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: wrap;
}

.chat-model-select {
  flex: 1 1 170px;
  min-width: 0;
}

.chat-custom-model-input {
  flex: 1 1 150px;
  min-width: 0;
}

.chat-thinking-select {
  flex: 0 1 120px;
  min-width: 0;
}

.chat-model-group-label {
  white-space: nowrap;
}

.chat-model-unavailable {
  flex: 1 1 100%;
}
</style>
