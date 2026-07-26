<template>
  <q-header v-if="header" class="mobile-header">
    <q-toolbar>
      <q-btn
        flat
        round
        dense
        icon="arrow_back_ios_new"
        class="mobile-back-target mobile-touch-target"
        aria-label="Back"
        @click="back"
      />
      <q-toolbar-title>{{ header.title }}</q-toolbar-title>
    </q-toolbar>
  </q-header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { backOrFallback } from '../../router/mobile-navigation';

const route = useRoute();
const router = useRouter();
const header = computed(() => route.meta.mobileHeader);

async function back(): Promise<void> {
  const currentHeader = header.value;
  if (!currentHeader) return;

  try {
    await backOrFallback(router, currentHeader.fallback);
  } catch (error) {
    console.error('Mobile header navigation failed', error);
  }
}
</script>
