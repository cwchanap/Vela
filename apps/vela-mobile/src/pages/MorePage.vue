<template>
  <q-page class="flex flex-center">
    <div class="text-center q-pa-xl">
      <q-icon name="more_horiz" size="48px" color="primary" />
      <h2 class="text-h5 text-weight-medium q-mt-md">More</h2>
      <p class="text-body2 text-grey-6">Coming soon</p>
      <development-diagnostics-entry v-if="DevelopmentDiagnosticsEntry" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const DevelopmentDiagnosticsEntry = import.meta.env.DEV
  ? defineAsyncComponent(() => import('src/components/mobile/IosInteractionDiagnosticsEntry.vue'))
  : null;
</script>
