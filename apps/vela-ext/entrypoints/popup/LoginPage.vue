<template>
  <div class="login-container" :class="{ dark: isDarkMode }">
    <div class="login-card">
      <div class="login-header">
        <div class="header-top">
          <h2>Vela Login</h2>
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

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            placeholder="your@email.com"
            required
            :disabled="loading"
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            placeholder="Enter your password"
            required
            :disabled="loading"
          />
        </div>

        <div v-if="error" class="error-message">
          {{ error }}
        </div>

        <button type="submit" class="login-button" :disabled="loading">
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { signIn } from '../utils/api';
import { saveAuthTokens } from '../utils/storage';

const emit = defineEmits<{
  loginSuccess: [];
}>();

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const isDarkMode = ref(false);

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

async function handleLogin() {
  if (!email.value || !password.value) {
    error.value = 'Please enter both email and password';
    return;
  }

  loading.value = true;
  error.value = '';

  try {
    const tokens = await signIn(email.value, password.value);
    await saveAuthTokens(tokens, email.value);
    emit('loginSuccess');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Login failed';
  } finally {
    loading.value = false;
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
  --border-focus: #4a90e2;
  --accent-color: #4a90e2;
  --accent-hover: #357abd;
  --error-bg: #fee;
  --error-border: #fcc;
  --error-text: #c33;
  --input-disabled-bg: #f5f5f5;
}

.login-container.dark {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2a2a2a;
  --bg-hover: #353535;
  --text-primary: #e4e4e4;
  --text-secondary: #d0d0d0;
  --text-tertiary: #a0a0a0;
  --border-color: #404040;
  --border-focus: #5ba3f5;
  --accent-color: #5ba3f5;
  --accent-hover: #4a90e2;
  --error-bg: #3d1a1a;
  --error-border: #5c2828;
  --error-text: #ff6b6b;
  --input-disabled-bg: #2a2a2a;
}

.login-container {
  min-width: 320px;
  height: 100vh;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  display: flex;
  flex-direction: column;
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

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group input {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  transition: border-color 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: var(--border-focus);
}

.form-group input:disabled {
  background-color: var(--input-disabled-bg);
  cursor: not-allowed;
  opacity: 0.6;
}

.form-group input::placeholder {
  color: var(--text-tertiary);
  opacity: 0.6;
}

.error-message {
  padding: 12px;
  background-color: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 6px;
  color: var(--error-text);
  font-size: 14px;
}

.login-button {
  padding: 12px;
  background-color: var(--accent-color);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.login-button:hover:not(:disabled) {
  background-color: var(--accent-hover);
}

.login-button:disabled {
  background-color: var(--border-color);
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
