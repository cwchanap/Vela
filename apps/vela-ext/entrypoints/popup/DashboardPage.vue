<template>
  <div class="dashboard-container">
    <div class="dashboard-header">
      <h2>Vela Dictionary</h2>
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
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getSavedSentences } from '../utils/api';
import { getAuthTokens, getUserEmail, clearAuthData } from '../utils/storage';

const emit = defineEmits<{
  logout: [];
}>();

const userEmail = ref('');
const sentences = ref<any[]>([]);
const loading = ref(false);
const error = ref('');

onMounted(async () => {
  const email = await getUserEmail();
  if (email) {
    userEmail.value = email;
  }
  await loadSentences();
});

async function loadSentences() {
  loading.value = true;
  error.value = '';

  try {
    const tokens = await getAuthTokens();
    if (!tokens) {
      throw new Error('Not authenticated');
    }

    const data = await getSavedSentences(tokens.accessToken);
    sentences.value = data;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sentences';
  } finally {
    loading.value = false;
  }
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
.dashboard-container {
  min-width: 400px;
  max-height: 600px;
  padding: 20px;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  overflow-y: auto;
}

.dashboard-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.dashboard-header h2 {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
}

.dashboard-header p {
  margin: 0 0 12px;
  font-size: 14px;
  color: #666;
}

.logout-button {
  padding: 6px 12px;
  background-color: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.logout-button:hover {
  background-color: #e0e0e0;
}

.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.instructions {
  padding: 16px;
  background-color: #f9f9f9;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.instructions h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.instructions ol {
  margin: 0;
  padding-left: 20px;
}

.instructions li {
  margin: 6px 0;
  font-size: 14px;
  color: #555;
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
  color: #1a1a1a;
}

.refresh-button {
  padding: 6px 12px;
  background-color: #4a90e2;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.refresh-button:hover:not(:disabled) {
  background-color: #357abd;
}

.refresh-button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.error-message {
  padding: 10px;
  background-color: #fee;
  border: 1px solid #fcc;
  border-radius: 6px;
  color: #c33;
  font-size: 14px;
}

.empty-state {
  padding: 20px;
  text-align: center;
  color: #999;
  font-size: 14px;
}

.sentences-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sentence-item {
  padding: 12px;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
}

.sentence-text {
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
  margin-bottom: 8px;
  line-height: 1.5;
}

.sentence-meta {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.sentence-meta a {
  color: #4a90e2;
  text-decoration: none;
}

.sentence-meta a:hover {
  text-decoration: underline;
}

.sentence-date {
  font-size: 12px;
  color: #999;
}
</style>
