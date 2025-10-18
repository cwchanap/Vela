<template>
  <div class="dashboard-container" :class="{ dark: isDarkMode }">
    <div class="dashboard-card">
      <div class="dashboard-header">
        <div class="header-top">
          <h2>Vela Dictionary</h2>
          <button
            @click="toggleTheme"
            class="theme-toggle"
            :title="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
          >
            {{ isDarkMode ? '☀️' : '🌙' }}
          </button>
        </div>
        <p>Logged in as: {{ userEmail }}</p>
        <button @click="handleLogout" class="logout-button">Logout</button>
      </div>

      <div class="dashboard-content">
        <div class="instructions">
          <h3>How to save sentences:</h3>
          <ol>
            <li>Select any text on a webpage</li>
            <li>Right-click to open the context menu</li>
            <li>Click "Save to Vela Dictionary"</li>
          </ol>
        </div>

        <div class="saved-sentences">
          <div class="section-header">
            <h3>Your Saved Sentences</h3>
            <button @click="loadSentences" :disabled="loading" class="refresh-button">
              {{ loading ? 'Loading...' : 'Refresh' }}
            </button>
          </div>

          <div v-if="error" class="error-message">
            {{ error }}
          </div>

          <div v-if="sentences.length === 0 && !loading" class="empty-state">
            No saved sentences yet. Start by selecting text on any webpage!
          </div>

          <div v-else class="sentences-list">
            <div v-for="item in sentences" :key="item.sentence_id" class="sentence-item">
              <div class="sentence-text">{{ item.sentence }}</div>
              <div v-if="item.source_url" class="sentence-meta">
                Source: <a :href="item.source_url" target="_blank">{{ item.source_url }}</a>
              </div>
              <div class="sentence-date">
                {{ formatDate(item.created_at) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { getSavedSentences } from '../utils/api';
import {
  getValidAccessToken,
  refreshAccessToken,
  getUserEmail,
  clearAuthData,
} from '../utils/storage';

const emit = defineEmits<{
  logout: [];
}>();

const userEmail = ref('');
const sentences = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const isDarkMode = ref(false);

onMounted(async () => {
  const email = await getUserEmail();
  if (email) {
    userEmail.value = email;
  }

  // Load theme preference
  const savedTheme = await browser.storage.local.get('theme_preference');
  isDarkMode.value = savedTheme.theme_preference === 'dark';

  await loadSentences();
});

// Watch for theme changes and persist to storage
watch(isDarkMode, async (newValue) => {
  await browser.storage.local.set({ theme_preference: newValue ? 'dark' : 'light' });
});

async function loadSentences() {
  loading.value = true;
  error.value = '';

  try {
    let accessToken = await getValidAccessToken();

    try {
      const data = await getSavedSentences(accessToken);
      sentences.value = data;
    } catch (apiError: any) {
      // If unauthorized, try to refresh token and retry once
      if (
        apiError.message?.includes('Unauthorized') ||
        apiError.message?.includes('expired token')
      ) {
        try {
          accessToken = await refreshAccessToken();
          const data = await getSavedSentences(accessToken);
          sentences.value = data;
        } catch (refreshError) {
          throw refreshError; // Let outer catch handle it
        }
      } else {
        throw apiError;
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sentences';

    // If session expired, log out the user
    if (err instanceof Error && err.message.includes('Session expired')) {
      setTimeout(() => {
        handleLogout();
      }, 2000);
    }
  } finally {
    loading.value = false;
  }
}

function toggleTheme() {
  isDarkMode.value = !isDarkMode.value;
}

async function handleLogout() {
  await clearAuthData();
  emit('logout');
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}
</script>

<style scoped>
/* CSS Variables for theming */
.dashboard-container {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-hover: #f5f5f5;
  --text-primary: #1a1a1a;
  --text-secondary: #333;
  --text-tertiary: #666;
  --text-muted: #888;
  --border-color: #ddd;
  --border-hover: #ccc;
  --accent-color: #4a90e2;
  --accent-hover: #357abd;
  --error-bg: #fee;
  --error-border: #fcc;
  --error-text: #c33;
}

.dashboard-container.dark {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2a2a2a;
  --bg-hover: #353535;
  --text-primary: #e4e4e4;
  --text-secondary: #d0d0d0;
  --text-tertiary: #a0a0a0;
  --text-muted: #808080;
  --border-color: #404040;
  --border-hover: #505050;
  --accent-color: #5ba3f5;
  --accent-hover: #4a90e2;
  --error-bg: #3d1a1a;
  --error-border: #5c2828;
  --error-text: #ff6b6b;
}

.dashboard-container {
  min-width: 400px;
  max-height: 600px;
  height: 100vh;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dashboard-card {
  background-color: var(--bg-primary);
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dashboard-header {
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.dashboard-header h2 {
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
  border-color: var(--border-hover);
}

.dashboard-header p {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text-tertiary);
}

.logout-button {
  padding: 8px 16px;
  background-color: var(--bg-primary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.logout-button:hover {
  background-color: var(--bg-hover);
  border-color: var(--border-hover);
}

.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.instructions {
  padding: 16px;
  background-color: var(--bg-secondary);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.instructions h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.instructions ol {
  margin: 0;
  padding-left: 20px;
}

.instructions li {
  margin: 6px 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.saved-sentences {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.refresh-button {
  padding: 6px 12px;
  background-color: var(--accent-color);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.refresh-button:hover:not(:disabled) {
  background-color: var(--accent-hover);
}

.refresh-button:disabled {
  background-color: var(--border-color);
  cursor: not-allowed;
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

.empty-state {
  padding: 32px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}

.sentences-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sentence-item {
  padding: 14px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  transition: all 0.2s;
}

.sentence-item:hover {
  border-color: var(--accent-color);
  background-color: var(--bg-hover);
}

.sentence-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 8px;
  line-height: 1.5;
}

.sentence-meta {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.sentence-meta a {
  color: var(--accent-color);
  text-decoration: none;
  transition: opacity 0.2s;
}

.sentence-meta a:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.sentence-date {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
