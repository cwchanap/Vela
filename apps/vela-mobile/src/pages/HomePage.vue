<template>
  <q-page class="flex flex-center">
    <div class="text-center q-pa-xl">
      <h1 class="text-h3 text-weight-bold text-primary q-mb-sm">
        {{ config.app.name }}
      </h1>
      <p class="text-subtitle1 text-grey-7 q-mb-md">Version {{ config.app.version }}</p>
      <q-chip :color="config.app.isDev ? 'orange' : 'green'" text-color="white" size="sm">
        {{ config.app.isDev ? 'Development' : 'Production' }}
      </q-chip>
      <p class="text-caption text-grey-6 q-mt-lg">M1 Scaffold</p>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { config } from 'src/config';
</script>
