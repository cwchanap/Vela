<template>
  <div class="login-container" :class="{ dark: isDarkMode }">
    <div class="login-card">
      <div class="login-header">
        <div class="header-top">
          <h2>Sign in on Vela</h2>
          <button
            @click="toggleTheme"
            class="theme-toggle"
            type="button"
            :title="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
          >
            {{ isDarkMode ? '☀️' : '🌙' }}
          </button>
        </div>
        <p>Save Japanese sentences to your dictionary</p>
      </div>

      <div class="session-panel">
        <p class="session-copy">Sign in with the Vela web app, then return here.</p>
        <a class="login-url" :href="loginUrl" @click.prevent="handleOpenWebappLogin">
          {{ loginUrl }}
        </a>

        <div v-if="error" class="error-message">
          {{ error }}
        </div>

        <div class="web-session-actions">
          <button
            type="button"
            class="open-webapp-button"
            :disabled="webSessionLoading"
            @click="handleOpenWebappLogin"
          >
            Open Vela Login
          </button>
          <button
            type="button"
            class="web-session-button"
            :disabled="webSessionLoading"
            @click="handleUseWebappSession"
          >
            {{ webSessionLoading ? 'Checking...' : 'Refresh Session' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { getWebappLoginUrl, importWebappSession, openWebappLogin } from '../utils/webappSession';

const emit = defineEmits<{
  loginSuccess: [];
}>();

const webSessionLoading = ref(false);
const error = ref('');
const isDarkMode = ref(false);
const loginUrl = getWebappLoginUrl();

onMounted(async () => {
  // Load theme preference
  const savedTheme = await browser.storage.local.get('theme_preference');
  isDarkMode.value = savedTheme.theme_preference === 'dark';
});

// Watch for theme changes and persist to storage
watch(isDarkMode, async (newValue) => {
  await browser.storage.local.set({ theme_preference: newValue ? 'dark' : 'light' });
});

function toggleTheme() {
  isDarkMode.value = !isDarkMode.value;
}

async function handleOpenWebappLogin() {
  error.value = '';
  await openWebappLogin();
}

async function handleUseWebappSession() {
  webSessionLoading.value = true;
  error.value = '';

  try {
    const imported = await importWebappSession();
    if (imported) {
      emit('loginSuccess');
      return;
    }

    error.value = 'Sign in at the URL above, then return here and refresh the session.';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to import web app session';
  } finally {
    webSessionLoading.value = false;
  }
}
</script>

<style scoped>
/* CSS Variables for theming */
.login-container {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-hover: #f5f5f5;
  --text-primary: #1a1a1a;
  --text-secondary: #333;
  --text-tertiary: #666;
  --border-color: #ddd;
  --accent-color: #4a90e2;
  --accent-hover: #357abd;
  --error-bg: #fee;
  --error-border: #fcc;
  --error-text: #c33;
}

.login-container.dark {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2a2a2a;
  --bg-hover: #353535;
  --text-primary: #e4e4e4;
  --text-secondary: #d0d0d0;
  --text-tertiary: #a0a0a0;
  --border-color: #404040;
  --accent-color: #5ba3f5;
  --accent-hover: #4a90e2;
  --error-bg: #3d1a1a;
  --error-border: #5c2828;
  --error-text: #ff6b6b;
}

.login-container {
  min-width: 320px;
  width: 400px;
  height: 100%;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
}

.login-card {
  background: var(--bg-primary);
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 20px;
}

.login-header {
  margin-bottom: 24px;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.login-header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.theme-toggle {
  padding: 6px 12px;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1;
}

.theme-toggle:hover {
  background-color: var(--bg-hover);
}

.login-header p {
  margin: 0;
  font-size: 14px;
  color: var(--text-tertiary);
  text-align: center;
}

.session-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.session-copy {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.login-url {
  display: block;
  padding: 10px 12px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--accent-color);
  font-size: 13px;
  line-height: 1.35;
  text-decoration: none;
  word-break: break-all;
}

.login-url:hover {
  background-color: var(--bg-hover);
}

.error-message {
  padding: 12px;
  background-color: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 6px;
  color: var(--error-text);
  font-size: 14px;
}

.web-session-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.web-session-button,
.open-webapp-button {
  padding: 10px 8px;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.web-session-button:hover:not(:disabled),
.open-webapp-button:hover:not(:disabled) {
  background-color: var(--bg-hover);
}

.web-session-button:disabled,
.open-webapp-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
