<template>
  <q-list>
    <q-item
      clickable
      class="mobile-touch-target"
      :data-testid="TTS_PRONUNCIATION_ENTRY_TEST_ID"
      @click="openDiagnostics"
    >
      <q-item-section avatar><q-icon name="record_voice_over" /></q-item-section>
      <q-item-section>
        <q-item-label>{{ TTS_PRONUNCIATION_DIAGNOSTIC_LABEL }}</q-item-label>
        <q-item-label caption>Authenticated Japanese TTS playback</q-item-label>
      </q-item-section>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import {
  TTS_PRONUNCIATION_DIAGNOSTIC_LABEL,
  TTS_PRONUNCIATION_DIAGNOSTIC_PATH,
  TTS_PRONUNCIATION_ENTRY_TEST_ID,
} from 'src/diagnostics/tts-pronunciation-contract';
import { pushMobileRoute } from 'src/router/mobile-navigation';

const router = useRouter();

function openDiagnostics(): void {
  void pushMobileRoute(router, TTS_PRONUNCIATION_DIAGNOSTIC_PATH).catch((error: unknown) => {
    console.error('Opening pronunciation diagnostics failed', error);
  });
}
</script>
