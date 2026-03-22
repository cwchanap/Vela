<template>
  <div class="game-setup q-pa-md">
    <q-card class="q-pa-md" style="max-width: 500px">
      <q-card-section>
        <div class="text-h5 q-mb-md">Listening Practice</div>

        <!-- Loading TTS status -->
        <div v-if="ttsStatus === 'loading'" class="text-center q-py-md">
          <q-spinner-dots color="teal" size="md" />
        </div>

        <!-- TTS not configured — blocking state -->
        <q-banner v-else-if="ttsStatus === 'missing'" rounded class="bg-warning text-dark q-mb-md">
          <template #avatar>
            <q-icon name="warning" color="dark" />
          </template>
          Text-to-speech is required for this game. Please configure a TTS provider in Settings
          first.
          <template #action>
            <q-btn flat label="Go to Settings" color="dark" to="/settings" />
          </template>
        </q-banner>

        <!-- TTS settings fetch failed -->
        <q-banner v-else-if="ttsStatus === 'error'" rounded class="bg-negative text-white q-mb-md">
          <template #avatar>
            <q-icon name="error" color="white" />
          </template>
          Could not check text-to-speech configuration. Please try again.
          <template #action>
            <q-btn flat label="Retry" color="white" @click="recheckTtsStatus" />
          </template>
        </q-banner>

        <template v-else>
          <!-- Mode selection -->
          <div class="q-mb-lg">
            <div class="text-subtitle2 q-mb-sm">Question Mode</div>
            <q-btn-toggle
              v-model="mode"
              spread
              no-caps
              rounded
              unelevated
              toggle-color="teal"
              :options="[
                { label: 'Multiple Choice', value: 'multiple-choice' },
                { label: 'Dictation', value: 'dictation' },
              ]"
            />
            <div class="text-caption text-grey q-mt-xs">
              {{
                mode === 'multiple-choice'
                  ? 'Hear audio and select the English meaning'
                  : 'Hear audio and type what you heard in Japanese'
              }}
            </div>
          </div>

          <!-- Audio source selection -->
          <div class="q-mb-lg">
            <div class="text-subtitle2 q-mb-sm">Audio Source</div>
            <q-btn-toggle
              v-model="source"
              spread
              no-caps
              rounded
              unelevated
              toggle-color="teal"
              :options="[
                { label: 'Vocabulary Words', value: 'vocabulary' },
                { label: 'Sentences', value: 'sentences' },
              ]"
            />
          </div>

          <!-- JLPT level selection -->
          <jlpt-level-selector v-model="jlptLevels" class="q-mb-lg" />
        </template>
      </q-card-section>

      <q-card-actions v-if="ttsStatus === 'ready'" align="center">
        <q-btn
          label="Start Listening"
          color="teal"
          size="lg"
          :loading="isStarting"
          unelevated
          rounded
          @click="handleStart"
        />
      </q-card-actions>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ListeningMode, ListeningSource, ListeningConfig } from 'src/types/listening';
import type { JLPTLevel } from 'src/types/database';
import { getTTSSettings } from 'src/services/ttsService';
import JlptLevelSelector from 'src/components/games/JlptLevelSelector.vue';

defineProps<{
  isStarting: boolean;
}>();

const emit = defineEmits<{
  start: [config: ListeningConfig];
}>();

type TtsStatus = 'loading' | 'ready' | 'missing' | 'error';

const ttsStatus = ref<TtsStatus>('loading');
const mode = ref<ListeningMode>('multiple-choice');
const source = ref<ListeningSource>('vocabulary');
const jlptLevels = ref<JLPTLevel[]>([]);

onMounted(async () => {
  try {
    const settings = await getTTSSettings();
    ttsStatus.value = settings.hasApiKey ? 'ready' : 'missing';
  } catch (error) {
    console.error('Failed to fetch TTS settings:', error);
    ttsStatus.value = 'error';
  }
});

async function recheckTtsStatus() {
  ttsStatus.value = 'loading';
  try {
    const settings = await getTTSSettings();
    ttsStatus.value = settings.hasApiKey ? 'ready' : 'missing';
  } catch (error) {
    console.error('Failed to fetch TTS settings:', error);
    ttsStatus.value = 'error';
  }
}

function handleStart() {
  emit('start', {
    mode: mode.value,
    source: source.value,
    jlptLevels: jlptLevels.value,
  });
}
</script>

<style scoped>
.game-setup {
  width: 100%;
  max-width: 550px;
}
</style>
