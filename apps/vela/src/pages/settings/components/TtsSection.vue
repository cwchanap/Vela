<template>
  <q-card flat bordered class="q-pa-md q-mb-lg">
    <div class="text-subtitle1 q-mb-sm">Text-to-Speech</div>
    <div class="text-caption text-grey q-mb-md">
      Configure a TTS provider for pronunciation features. Audio is AI-generated.
    </div>

    <div class="row q-col-gutter-md">
      <div class="col-12">
        <q-select
          v-model="ttsProvider"
          :options="ttsProviderOptions"
          label="Provider"
          dense
          emit-value
          map-options
          data-testid="tts-provider-select"
        />
      </div>
      <div class="col-12">
        <q-input
          v-model="ttsApiKeyInput"
          :type="showTtsApiKey ? 'text' : 'password'"
          :label="ttsApiKeyLabel"
          dense
          outlined
          clearable
          data-testid="tts-api-key-input"
          :hint="ttsApiKeyHint"
        >
          <template #append>
            <q-icon
              :name="showTtsApiKey ? 'visibility_off' : 'visibility'"
              class="cursor-pointer"
              @click="showTtsApiKey = !showTtsApiKey"
            />
          </template>
        </q-input>
      </div>
      <div class="col-12 col-md-6">
        <!-- ElevenLabs keeps a free-form voice ID; other providers use their official list. -->
        <q-input
          v-if="!ttsVoiceOptions"
          v-model="ttsVoiceId"
          label="Voice ID (optional)"
          dense
          outlined
          :hint="`Default: ${selectedProviderInfo.defaultVoice}`"
          data-testid="tts-voice-id-input"
        />
        <q-select
          v-else
          v-model="ttsVoiceId"
          :options="ttsVoiceOptions"
          label="Voice"
          dense
          emit-value
          map-options
          data-testid="tts-voice-id-input"
        />
      </div>
      <div class="col-12 col-md-6">
        <q-select
          v-model="ttsModel"
          :options="ttsModelOptions"
          label="Model"
          dense
          emit-value
          map-options
          data-testid="tts-model-input"
        />
      </div>
      <div class="col-12">
        <q-btn
          class="full-width"
          color="primary"
          label="Save TTS Settings"
          :disable="!canSaveTTS || !canSubmitTTS"
          @click="saveSettingsHandler"
          data-testid="tts-save"
        />
      </div>
    </div>

    <q-separator class="q-my-md" />

    <div class="row items-center">
      <div class="col">
        <div class="text-caption">{{ ttsStatusLabel }}</div>
      </div>
      <div class="col-auto">
        <q-badge v-if="hasSavedKeyForSelectedProvider" color="positive" outline>
          Configured
        </q-badge>
        <q-badge v-else color="grey" outline>Not configured</q-badge>
      </div>
    </div>
  </q-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAuthStore } from '../../../stores/auth';
import { Notify } from 'quasar';
import {
  resolveTtsSelection,
  TTS_PROVIDER_REGISTRY,
  TTS_PROVIDERS,
  type TtsProvider,
} from '@vela/common';
import {
  useTTSSettingsQuery,
  useUpdateTTSSettingsMutation,
} from '../../../composables/queries/useTTSQueries';

const authStore = useAuthStore();

const isAuthenticated = computed(() => authStore.isAuthenticated);
const currentUserId = computed(() => authStore.user?.id || authStore.session?.user?.id || null);
const canSaveTTS = computed(() => !!currentUserId.value);

// TTS Settings
const initialSelection = resolveTtsSelection('elevenlabs', null, null);
const ttsProvider = ref<TtsProvider>('elevenlabs');
const ttsApiKeyInput = ref('');
const ttsVoiceId = ref(initialSelection.voiceId);
const ttsModel = ref(initialSelection.model);
const showTtsApiKey = ref(false);

// TanStack Query hooks for TTS
const { data: ttsSettingsData } = useTTSSettingsQuery();
const { mutate: saveTTSSettings } = useUpdateTTSSettingsMutation();

// Computed from query data
const selectedProviderInfo = computed(() => TTS_PROVIDER_REGISTRY[ttsProvider.value]);

// A key only counts for the provider that currently owns it: a newly selected,
// unsaved provider must not be shown or treated as configured.
const hasSavedKeyForSelectedProvider = computed(() =>
  Boolean(
    ttsSettingsData.value?.hasApiKey && ttsSettingsData.value?.provider === ttsProvider.value,
  ),
);

const ttsProviderOptions = TTS_PROVIDERS.map((provider) => ({
  label: TTS_PROVIDER_REGISTRY[provider].label,
  value: provider,
}));

const ttsModelOptions = computed(() =>
  selectedProviderInfo.value.models.map(({ id, label }) => ({
    label: id === selectedProviderInfo.value.defaultModel ? `${label} (default)` : label,
    value: id,
  })),
);

// null means user-entered voice IDs (ElevenLabs).
const ttsVoiceOptions = computed(
  () => selectedProviderInfo.value.voices?.map((voice) => ({ label: voice, value: voice })) ?? null,
);

// The input is clearable, so it can hold null at runtime despite the ref type.
const enteredApiKey = computed(() => (ttsApiKeyInput.value ?? '').trim());

const canSubmitTTS = computed(
  () => Boolean(enteredApiKey.value) || hasSavedKeyForSelectedProvider.value,
);

const ttsApiKeyLabel = computed(() => {
  if (ttsProvider.value === 'openai') return 'OpenAI API Key';
  if (ttsProvider.value === 'gemini') return 'Google AI API Key';
  return 'ElevenLabs API Key';
});

const ttsApiKeyHint = computed(() => {
  if (hasSavedKeyForSelectedProvider.value) {
    return `Leave blank to keep the saved ${selectedProviderInfo.value.label} key`;
  }
  if (ttsProvider.value === 'openai') return 'Your OpenAI API key (sk-...)';
  if (ttsProvider.value === 'gemini') return 'Your Google AI Studio API key';
  return 'Your ElevenLabs API key';
});

const ttsStatusLabel = computed(() => {
  if (!isAuthenticated.value) return 'Sign in to configure TTS settings';
  return hasSavedKeyForSelectedProvider.value
    ? `TTS configured: ${selectedProviderInfo.value.label}`
    : `No TTS API key saved for ${selectedProviderInfo.value.label}`;
});

// Hydration assigns ttsProvider; a stored selection must not be replaced by defaults.
let applyingStoredSettings = false;

// A provider switch starts from that provider's registry defaults instead of
// carrying a model/voice from another provider.
watch(
  ttsProvider,
  (provider) => {
    if (applyingStoredSettings) return;
    const selection = resolveTtsSelection(provider, null, null);
    ttsVoiceId.value = selection.voiceId;
    ttsModel.value = selection.model;
    // A key typed for the previous provider must not be submitted for this one.
    ttsApiKeyInput.value = '';
  },
  { flush: 'sync' },
);

// Snapshot of the settings last applied to the form, so a refetch does not
// clobber edits the user has made since. Starts at the initial defaults.
let appliedSettings: { provider: TtsProvider; voiceId: string; model: string } = initialSelection;

// Sync local form state with query data when it loads/changes
watch(
  () => ttsSettingsData.value,
  (data) => {
    if (!data) return;
    // The saved provider is authoritative; unknown values fall back to defaults.
    const provider = TTS_PROVIDERS.find((candidate) => candidate === data.provider) ?? 'elevenlabs';
    const selection = resolveTtsSelection(provider, data.model, data.voiceId);
    const hasUnsavedEdits =
      // A nonblank key is unsaved and belongs to the provider it was typed in,
      // so hydration must not switch providers underneath it.
      Boolean(enteredApiKey.value) ||
      appliedSettings.provider !== ttsProvider.value ||
      appliedSettings.voiceId !== ttsVoiceId.value ||
      appliedSettings.model !== ttsModel.value;
    if (hasUnsavedEdits) return;

    applyingStoredSettings = true;
    ttsProvider.value = selection.provider;
    applyingStoredSettings = false;
    ttsVoiceId.value = selection.voiceId;
    ttsModel.value = selection.model;
    appliedSettings = selection;
  },
  { immediate: true },
);

// Save TTS settings using mutation
const saveSettingsHandler = async () => {
  const userId = currentUserId.value;

  if (!userId) {
    Notify.create({
      type: 'negative',
      message: 'Please sign in to save TTS settings',
      position: 'top',
    });
    return;
  }

  const apiKey = enteredApiKey.value;

  // A blank key only retains the saved key of this same provider.
  if (!apiKey && !hasSavedKeyForSelectedProvider.value) {
    Notify.create({
      type: 'negative',
      message: 'Please enter an API key',
      position: 'top',
    });
    return;
  }

  // The post-save baseline must be what was submitted: the refs can change
  // while the request is in flight, and those edits are not saved.
  const submitted = {
    provider: ttsProvider.value,
    voiceId: ttsVoiceId.value,
    model: ttsModel.value,
    apiKey,
  };

  saveTTSSettings(
    {
      provider: submitted.provider,
      ...(submitted.apiKey ? { apiKey: submitted.apiKey } : {}),
      voiceId: submitted.voiceId || undefined,
      model: submitted.model || undefined,
    },
    {
      onSuccess: () => {
        appliedSettings = {
          provider: submitted.provider,
          voiceId: submitted.voiceId,
          model: submitted.model,
        };
        // Clear the key only while it is still the submitted one; a newer key
        // typed during the request is unsaved and must survive.
        if (enteredApiKey.value === submitted.apiKey) {
          ttsApiKeyInput.value = '';
        }
        Notify.create({
          type: 'positive',
          message: 'TTS settings saved successfully',
          position: 'top',
        });
      },
      onError: (error) => {
        console.error('Error saving TTS settings:', error);
        Notify.create({
          type: 'negative',
          message: error instanceof Error ? error.message : 'Failed to save TTS settings',
          position: 'top',
        });
      },
    },
  );
};
</script>

<style scoped>
/* Improve text contrast in dark mode */
body.body--dark .text-grey,
body.body--dark .text-caption {
  color: #b8b8b8 !important;
}
</style>
