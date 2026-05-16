<script setup lang="ts">
import { ref, onMounted } from 'vue';
import LoginPage from './LoginPage.vue';
import DashboardPage from './DashboardPage.vue';
import { isAuthenticated } from '../utils/storage';
import { importWebappSession } from '../utils/webappSession';

const authenticated = ref(false);
const loading = ref(true);

onMounted(async () => {
  try {
    authenticated.value = await isAuthenticated();
    if (!authenticated.value) {
      authenticated.value = await importWebappSession();
      if (authenticated.value) {
        // Notify the background script so it can flush any queued offline saves.
        browser.runtime.sendMessage({ type: 'LOGIN_SUCCESS' }).catch(() => {
          // Background may not be listening during tests or development reloads.
        });
      }
    }
  } catch (error: unknown) {
    console.error('[Vela] Failed to initialise session:', error);
  } finally {
    loading.value = false;
  }
});

function handleLoginSuccess() {
  authenticated.value = true;
  // Notify the background script so it can flush any queued offline saves.
  browser.runtime.sendMessage({ type: 'LOGIN_SUCCESS' }).catch(() => {
    // Ignore — background may not be listening (e.g. during development).
  });
}

function handleSessionExpired() {
  authenticated.value = false;
}
</script>

<template>
  <div v-if="loading" class="loading">Loading...</div>
  <LoginPage v-else-if="!authenticated" @login-success="handleLoginSuccess" />
  <DashboardPage v-else @session-expired="handleSessionExpired" />
</template>

<style scoped>
.loading {
  width: 400px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: #a0a0a0;
  background-color: #1e1e1e;
}
</style>
