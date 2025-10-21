<script setup lang="ts">
import { ref, onMounted } from 'vue';
import LoginPage from './LoginPage.vue';
import DashboardPage from './DashboardPage.vue';
import { isAuthenticated } from '../utils/storage';

const authenticated = ref(false);
const loading = ref(true);

onMounted(async () => {
  authenticated.value = await isAuthenticated();
  loading.value = false;
});

function handleLoginSuccess() {
  authenticated.value = true;
}

function handleLogout() {
  authenticated.value = false;
}
</script>

<template>
  <div v-if="loading" class="loading">Loading...</div>
  <LoginPage v-else-if="!authenticated" @login-success="handleLoginSuccess" />
  <DashboardPage v-else @logout="handleLogout" />
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
