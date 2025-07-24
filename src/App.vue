<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { validateConfig } from 'src/config';

onMounted(() => {
  // Validate configuration on app startup
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration validation failed:', error);
  }
});
</script>
