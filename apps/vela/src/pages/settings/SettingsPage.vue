<template>
  <q-page class="q-pa-md" data-testid="settings-page">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">App Settings</div>
    </div>

    <!-- Theme Settings -->
    <ThemeSection />

    <!-- LLM Settings -->
    <LlmProvidersSection />

    <!-- TTS Settings -->
    <TtsSection />
  </q-page>
</template>

<script setup lang="ts">
import ThemeSection from './components/ThemeSection.vue';
import LlmProvidersSection from './components/LlmProvidersSection.vue';
import TtsSection from './components/TtsSection.vue';
</script>
