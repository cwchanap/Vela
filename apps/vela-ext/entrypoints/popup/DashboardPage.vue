<template>
  <div class="dashboard-container" :class="{ dark: isDarkMode }">
    <div class="dashboard-card">
      <div class="dashboard-header">
        <div class="header-top">
          <h2>Vela Dictionary</h2>
          <div class="header-actions">
            <button
              @click="toggleTheme"
              class="icon-button"
              :title="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
            >
              {{ isDarkMode ? '☀️' : '🌙' }}
            </button>
            <button @click="handleLogout" class="icon-button" title="Logout">🚪</button>
          </div>
        </div>
        <p>Logged in as: {{ userEmail }}</p>
      </div>

      <div class="dashboard-content">
        <div class="instructions">
          <div class="instructions-header" @click="instructionsExpanded = !instructionsExpanded">
            <h3>How to save entries</h3>
            <button class="collapse-icon" type="button">
              {{ instructionsExpanded ? '▼' : '▶' }}
            </button>
          </div>
          <ol v-show="instructionsExpanded">
            <li>Select any text on a webpage</li>
            <li>Right-click to open the context menu</li>
            <li>Click "Save to My Dictionaries"</li>
          </ol>
        </div>

        <div class="my-dictionaries">
          <div class="section-header">
            <h3>Your Dictionary Entries</h3>
            <button @click="loadEntries" :disabled="loading" class="refresh-button">
              {{ loading ? 'Loading...' : 'Refresh' }}
            </button>
          </div>

          <div v-if="error" class="error-message">
            {{ error }}
          </div>

          <button @click="openWebapp" class="view-all-button" v-if="entries.length > 0">
            Open in Web App →
          </button>

          <div v-if="entries.length === 0 && !loading" class="empty-state">
            No dictionary entries yet. Start by selecting text on any webpage!
          </div>

          <div v-else class="entries-list">
            <div v-for="item in recentEntries" :key="item.sentence_id" class="entry-item">
              <div class="entry-header">
                <div class="entry-text">{{ item.sentence }}</div>
                <a
                  v-if="item.source_url"
                  :href="item.source_url"
                  target="_blank"
                  class="source-link"
                  title="Open source"
                >
                  🔗
                </a>
              </div>
              <div v-if="item.source_url" class="entry-meta">
                Source: <a :href="item.source_url" target="_blank">{{ item.source_url }}</a>
              </div>
              <div class="entry-date">
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
import { ref, onMounted, watch, computed } from 'vue';
import { getMyDictionaries } from '../utils/api';
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
const entries = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const isDarkMode = ref(false);
const instructionsExpanded = ref(false);

onMounted(async () => {
  const email = await getUserEmail();
  if (email) {
    userEmail.value = email;
  }

  // Load theme preference
  const savedTheme = await browser.storage.local.get('theme_preference');
  isDarkMode.value = savedTheme.theme_preference === 'dark';

  await loadEntries();
});

// Watch for theme changes and persist to storage
watch(isDarkMode, async (newValue) => {
  await browser.storage.local.set({ theme_preference: newValue ? 'dark' : 'light' });
});

async function loadEntries() {
  loading.value = true;
  error.value = '';

  try {
    let accessToken = await getValidAccessToken();

    try {
      const data = await getMyDictionaries(accessToken);
      entries.value = data;
    } catch (apiError: any) {
      // If unauthorized, try to refresh token and retry once
      if (
        apiError.message?.includes('Unauthorized') ||
        apiError.message?.includes('expired token')
      ) {
        try {
          accessToken = await refreshAccessToken();
          const data = await getMyDictionaries(accessToken);
          entries.value = data;
        } catch (refreshError) {
          throw refreshError; // Let outer catch handle it
        }
      } else {
        throw apiError;
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load dictionary entries';

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

function openWebapp() {
  // Use localhost in dev mode, production URL in production
  const isDev = import.meta.env.MODE === 'development';
  const baseUrl = isDev ? 'http://localhost:9000' : 'https://vela.cwchanap.dev';
  browser.tabs.create({ url: `${baseUrl}/my-dictionaries` });
}

// Computed property to show only first 5 entries
const recentEntries = computed(() => {
  return entries.value.slice(0, 5);
});
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
  width: 400px;
  height: 100%;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
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

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-button {
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

.icon-button:hover {
  background-color: var(--bg-hover);
  border-color: var(--border-hover);
}

.dashboard-header p {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text-tertiary);
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
  padding: 12px 16px;
  background-color: var(--bg-secondary);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.instructions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.instructions-header:hover {
  opacity: 0.8;
}

.instructions h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.collapse-icon {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.instructions ol {
  margin: 12px 0 0;
  padding-left: 20px;
}

.instructions li {
  margin: 6px 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.my-dictionaries {
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

.entries-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.entry-item {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entry-item:hover {
  border-color: var(--accent-color);
  background-color: var(--bg-hover);
}

.entry-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}

.entry-text {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  word-break: break-word;
  flex: 1;
}

.source-link {
  font-size: 16px;
  text-decoration: none;
  opacity: 0.6;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.source-link:hover {
  opacity: 1;
}

.entry-meta {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}

.entry-meta a {
  color: var(--accent-color);
  text-decoration: none;
  transition: opacity 0.2s;
}

.entry-meta a:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.entry-date {
  font-size: 12px;
  color: var(--text-secondary);
}

.view-all-button {
  width: 100%;
  padding: 12px;
  margin-bottom: 12px;
  background-color: var(--accent-color);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.view-all-button:hover {
  background-color: var(--accent-hover);
}
</style>
