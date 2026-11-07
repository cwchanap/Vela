<template>
  <q-card flat bordered class="q-pa-md q-mb-lg">
    <div class="text-subtitle1 q-mb-sm">Text-to-Speech</div>
    <div class="text-caption text-grey q-mb-md">
      Configure a TTS provider for pronunciation features
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
        <!-- ElevenLabs: free-text voice ID -->
        <q-input
          v-if="ttsProvider === 'elevenlabs'"
          v-model="ttsVoiceId"
          label="Voice ID (optional)"
          dense
          outlined
          hint="Default: ErXwobaYiN019PkySvjV"
          data-testid="tts-voice-id-input"
        />
        <!-- OpenAI: preset voice dropdown -->
        <q-select
          v-else-if="ttsProvider === 'openai'"
          v-model="ttsVoiceId"
          :options="openaiVoiceOptions"
          label="Voice"
          dense
          emit-value
          map-options
          data-testid="tts-voice-id-input"
        />
        <!-- Gemini: preset voice dropdown -->
        <q-select
          v-else-if="ttsProvider === 'gemini'"
          v-model="ttsVoiceId"
          :options="geminiVoiceOptions"
          label="Voice"
          dense
          emit-value
          map-options
          data-testid="tts-voice-id-input"
        />
      </div>
      <!-- Model: only shown for ElevenLabs (OpenAI/Gemini models are fixed) -->
      <div class="col-12 col-md-6">
        <q-input
          v-if="ttsProvider === 'elevenlabs'"
          v-model="ttsModel"
          label="Model (optional)"
          dense
          outlined
          hint="Default: eleven_multilingual_v2"
          data-testid="tts-model-input"
        />
      </div>
      <div class="col-12">
        <q-btn
          class="full-width"
          color="primary"
          label="Save TTS Settings"
          :disable="!canSaveTTS || !ttsApiKeyInput"
          @click="saveSettingsHandler"
          data-testid="tts-save"
        />
      </div>
    </div>

    <q-separator class="q-my-md" />

    <div class="row items-center">
      <div class="col">
        <div class="text-caption">
          {{
            isAuthenticated
              ? hasTTSKey
                ? `TTS configured: ${ttsProvider}`
                : 'No TTS API key configured'
              : 'Sign in to configure TTS settings'
          }}
        </div>
      </div>
      <div class="col-auto">
        <q-badge v-if="hasTTSKey" color="positive" outline>Configured</q-badge>
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
  useTTSSettingsQuery,
  useUpdateTTSSettingsMutation,
} from '../../../composables/queries/useTTSQueries';

const authStore = useAuthStore();

const isAuthenticated = computed(() => authStore.isAuthenticated);
const currentUserId = computed(() => authStore.user?.id || authStore.session?.user?.id || null);
const canSaveTTS = computed(() => !!currentUserId.value);

// TTS Settings
const ttsProvider = ref<string>('elevenlabs');
const ttsApiKeyInput = ref('');
const ttsVoiceId = ref('');
const ttsModel = ref('');
const showTtsApiKey = ref(false);

// TanStack Query hooks for TTS
const { data: ttsSettingsData } = useTTSSettingsQuery();
const { mutate: saveTTSSettings } = useUpdateTTSSettingsMutation();

// Computed from query data
const hasTTSKey = computed(() => ttsSettingsData.value?.hasApiKey ?? false);

const ttsProviderOptions = [
  { label: 'ElevenLabs', value: 'elevenlabs' },
  { label: 'OpenAI (tts-1)', value: 'openai' },
  { label: 'Google Gemini (gemini-2.5-flash-preview-tts)', value: 'gemini' },
];

const openaiVoiceOptions = [
  { label: 'Alloy', value: 'alloy' },
  { label: 'Echo', value: 'echo' },
  { label: 'Fable', value: 'fable' },
  { label: 'Onyx', value: 'onyx' },
  { label: 'Nova', value: 'nova' },
  { label: 'Shimmer', value: 'shimmer' },
];

const geminiVoiceOptions = [
  { label: 'Kore', value: 'Kore' },
  { label: 'Puck', value: 'Puck' },
  { label: 'Charon', value: 'Charon' },
  { label: 'Fenrir', value: 'Fenrir' },
  { label: 'Aoede', value: 'Aoede' },
  { label: 'Leda', value: 'Leda' },
  { label: 'Orus', value: 'Orus' },
  { label: 'Zephyr', value: 'Zephyr' },
  { label: 'Callirrhoe', value: 'Callirrhoe' },
  { label: 'Autonoe', value: 'Autonoe' },
  { label: 'Enceladus', value: 'Enceladus' },
  { label: 'Iocaste', value: 'Iocaste' },
];

const ttsApiKeyLabel = computed(() => {
  if (ttsProvider.value === 'openai') return 'OpenAI API Key';
  if (ttsProvider.value === 'gemini') return 'Google AI API Key';
  return 'ElevenLabs API Key';
});

const ttsApiKeyHint = computed(() => {
  if (ttsProvider.value === 'openai') return 'Your OpenAI API key (sk-...)';
  if (ttsProvider.value === 'gemini') return 'Your Google AI Studio API key';
  return 'Your ElevenLabs API key';
});

// Set provider-appropriate defaults when provider changes
watch(ttsProvider, (newProvider) => {
  if (newProvider === 'openai') {
    if (!openaiVoiceOptions.find((o) => o.value === ttsVoiceId.value)) {
      ttsVoiceId.value = 'alloy';
    }
    ttsModel.value = 'tts-1';
  } else if (newProvider === 'gemini') {
    if (!geminiVoiceOptions.find((o) => o.value === ttsVoiceId.value)) {
      ttsVoiceId.value = 'Kore';
    }
    ttsModel.value = 'gemini-2.5-flash-preview-tts';
  } else if (newProvider === 'elevenlabs') {
    // Clear voice/model if they contain values from other providers
    const openaiVoices = openaiVoiceOptions.map((o) => o.value);
    const geminiVoices = geminiVoiceOptions.map((o) => o.value);
    if (openaiVoices.includes(ttsVoiceId.value) || geminiVoices.includes(ttsVoiceId.value)) {
      ttsVoiceId.value = '';
    }
    if (ttsModel.value === 'tts-1' || ttsModel.value === 'gemini-2.5-flash-preview-tts') {
      ttsModel.value = '';
    }
  }
});

// Sync local form state with query data when it loads/changes
watch(
  () => ttsSettingsData.value,
  (data) => {
    if (data) {
      // Only overwrite voice/model when API returns non-null values
      // to preserve provider watcher defaults
      if (data.voiceId != null) {
        ttsVoiceId.value = data.voiceId;
      }
      if (data.model != null) {
        ttsModel.value = data.model;
      }
      // Set provider last so its watch applies appropriate defaults
      // for voice/model when API returns null
      ttsProvider.value = data.provider || 'elevenlabs';
    }
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

  if (!ttsApiKeyInput.value) {
    Notify.create({
      type: 'negative',
      message: 'Please enter an API key',
      position: 'top',
    });
    return;
  }

  saveTTSSettings(
    {
      provider: ttsProvider.value,
      apiKey: ttsApiKeyInput.value,
      voiceId: ttsVoiceId.value || undefined,
      model: ttsModel.value || undefined,
    },
    {
      onSuccess: () => {
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
