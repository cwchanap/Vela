<template>
  <div id="q-app">
    <!-- Loading screen while initializing authentication -->
    <div v-if="!authStore.isInitialized" class="loading-screen">
      <div class="loading-content">
        <q-spinner-dots size="3rem" color="primary" />
        <div class="text-h6 q-mt-md">{{ config.app.name }}</div>
        <div class="text-subtitle2 text-grey-6">Initializing...</div>
      </div>
    </div>

    <!-- Main app content -->
    <router-view v-else />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { validateConfig, config } from 'src/config';
import { useAuthStore } from 'src/stores/auth';

const authStore = useAuthStore();

onMounted(async () => {
  // Validate configuration on app startup
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration validation failed:', error);
  }

  // Initialize authentication
  await authStore.initialize();
});
</script>

<style scoped>
.loading-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  z-index: 9999;
}

.loading-content {
  text-align: center;
  color: white;
}
</style>
