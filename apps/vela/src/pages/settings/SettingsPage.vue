<template>
  <q-page class="q-pa-md" data-testid="settings-page">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">App Settings</div>
    </div>

    <!-- Theme Settings -->
    <q-card flat bordered class="q-pa-md q-mb-lg">
      <div class="text-subtitle1 q-mb-sm">Theme</div>
      <div class="row items-center">
        <div class="col">
          <div class="text-body2">Dark Mode</div>
          <div class="text-caption text-grey">
            {{ themeStore.isDark ? 'Dark theme is enabled' : 'Light theme is enabled' }}
          </div>
        </div>
        <div class="col-auto">
          <q-toggle
            v-model="darkModeEnabled"
            color="primary"
            data-testid="dark-mode-toggle"
            @update:model-value="toggleDarkMode"
          />
        </div>
      </div>
      <q-separator class="q-my-md" />
      <div class="row items-center q-col-gutter-sm">
        <div class="col-12 col-md-auto">
          <q-btn
            flat
            label="Save to profile"
            color="primary"
            :disable="!isAuthenticated"
            @click="saveThemeToProfile"
          />
        </div>
        <div class="col-12 col-md">
          <div class="text-caption">
            {{
              isAuthenticated
                ? 'Save your theme preference to your profile'
                : 'Sign in to save theme preference'
            }}
          </div>
        </div>
      </div>
    </q-card>

    <!-- LLM Settings -->
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
            label="API Key"
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

    <!-- TTS Settings -->
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
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LLMProviderName } from '../../services/llm';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useThemeStore } from '../../stores/theme';
import { useAuthStore } from '../../stores/auth';
import { Notify } from 'quasar';
import {
  getTTSSettings as fetchTTSSettings,
  saveTTSSettings as updateTTSSettings,
  clearAudioUrlCache,
} from '../../services/ttsService';

const store = useLLMSettingsStore();
const themeStore = useThemeStore();
const authStore = useAuthStore();

const isAuthenticated = computed(() => authStore.isAuthenticated);
const currentUserId = computed(() => authStore.user?.id || authStore.session?.user?.id || null);
const canSaveTTS = computed(() => !!currentUserId.value);
const darkModeEnabled = ref(themeStore.isDark);

const toggleDarkMode = () => {
  themeStore.toggle();
  darkModeEnabled.value = themeStore.isDark;
};

const saveThemeToProfile = async () => {
  await themeStore.saveToUserPreferences();
  Notify.create({
    type: 'positive',
    message: 'Theme preference saved to your profile',
    position: 'top',
  });
};

const providerOptions = [
  { label: 'Google (Gemini API)', value: 'google' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'Chutes.ai', value: 'chutes' },
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
    : 'Enter your API key for this provider',
);

// TTS Settings
const ttsProvider = ref<string>('elevenlabs');
const ttsApiKeyInput = ref('');
const ttsVoiceId = ref('');
const ttsModel = ref('');
const showTtsApiKey = ref(false);
const hasTTSKey = ref(false);

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
  }
});

// Load TTS settings on mount
const loadTTSSettings = async () => {
  if (!currentUserId.value) return;
  try {
    const data = await fetchTTSSettings();
    hasTTSKey.value = data.hasApiKey;
    ttsProvider.value = data.provider || 'elevenlabs';
    ttsVoiceId.value = data.voiceId || '';
    ttsModel.value = data.model || '';
  } catch (error) {
    console.error('Failed to load TTS settings:', error);
  }
};

// Save TTS settings
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

  try {
    await updateTTSSettings(
      userId,
      ttsProvider.value,
      ttsApiKeyInput.value,
      ttsVoiceId.value || undefined,
      ttsModel.value || undefined,
    );

    hasTTSKey.value = true;
    clearAudioUrlCache();
    Notify.create({
      type: 'positive',
      message: 'TTS settings saved successfully',
      position: 'top',
    });
  } catch (error) {
    console.error('Error saving TTS settings:', error);
    Notify.create({
      type: 'negative',
      message: error instanceof Error ? error.message : 'Failed to save TTS settings',
      position: 'top',
    });
  }
};

// Load TTS settings when authenticated
watch(
  () => currentUserId.value,
  (userId) => {
    if (userId) {
      loadTTSSettings();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
/* Improve text contrast in dark mode */
body.body--dark .text-grey,
body.body--dark .text-caption {
  color: #b8b8b8 !important;
}
</style>
