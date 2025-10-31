<template>
  <q-page class="q-pa-md">
    <div class="row q-mb-md">
      <div class="col">
        <h4 class="q-my-none">My Dictionaries</h4>
        <p class="text-grey-7">
          Manage sentences saved to your dictionaries from the browser extension
        </p>
      </div>
      <div class="col-auto">
        <q-btn
          color="primary"
          icon="refresh"
          label="Refresh"
          :loading="loading"
          @click="loadEntries"
        />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && entries.length === 0" class="text-center q-pa-xl">
      <q-spinner color="primary" size="3em" />
      <p class="text-grey-7 q-mt-md">Loading dictionary entries...</p>
    </div>

    <!-- Error State -->
    <q-banner v-else-if="error" class="bg-negative text-white q-mb-md" rounded>
      <template #avatar>
        <q-icon name="error" color="white" />
      </template>
      {{ error }}
      <template #action>
        <q-btn flat color="white" label="Retry" @click="loadEntries" />
      </template>
    </q-banner>

    <!-- Empty State -->
    <q-card v-else-if="entries.length === 0" flat bordered class="q-pa-xl text-center">
      <q-icon name="chat_bubble_outline" size="4em" color="grey-5" />
      <h6 class="q-mt-md q-mb-sm">No Dictionary Entries Yet</h6>
      <p class="text-grey-7 q-mb-md">
        Install the Vela browser extension to save entries from any webpage.
      </p>
      <q-btn
        color="primary"
        label="Learn More"
        icon="extension"
        href="https://github.com/your-repo/vela-extension"
        target="_blank"
        flat
      />
    </q-card>

    <!-- Entries List -->
    <div v-else class="entries-grid">
      <q-card v-for="item in entries" :key="item.sentence_id" flat bordered class="entry-card">
        <q-card-section>
          <div class="row items-start q-mb-sm">
            <div class="col entry-text">{{ item.sentence }}</div>
            <q-btn
              flat
              round
              dense
              icon="volume_up"
              color="primary"
              size="sm"
              class="q-ml-sm"
              @click="handlePronounce(item)"
              data-testid="btn-pronounce-sentence"
            >
              <q-tooltip>Pronunciation</q-tooltip>
            </q-btn>
          </div>

          <div v-if="item.context" class="entry-meta q-mt-sm">
            <q-icon name="description" size="xs" class="q-mr-xs" />
            <span class="text-grey-7">{{ item.context }}</span>
          </div>

          <div v-if="item.source_url" class="entry-meta q-mt-xs">
            <q-icon name="link" size="xs" class="q-mr-xs" />
            <a :href="item.source_url" target="_blank" class="text-primary">
              {{ formatUrl(item.source_url) }}
            </a>
          </div>

          <div class="entry-date q-mt-sm text-grey-6">
            <q-icon name="schedule" size="xs" class="q-mr-xs" />
            {{ formatDate(item.created_at) }}
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn
            flat
            dense
            color="primary"
            icon="psychology"
            label="Ask AI"
            size="sm"
            @click="handleAskAI(item)"
          />
          <q-btn
            flat
            dense
            color="negative"
            icon="delete"
            label="Delete"
            size="sm"
            @click="confirmDelete(item)"
          />
        </q-card-actions>
      </q-card>
    </div>

    <!-- AI Analysis Dialog -->
    <q-dialog v-model="aiDialog" position="standard">
      <q-card style="min-width: 500px; max-width: 800px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">AI Sentence Analysis</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section v-if="analyzingSentence">
          <div class="sentence-display q-pa-md rounded-borders q-mb-md">
            <div class="text-weight-medium sentence-text">{{ analyzingSentence.sentence }}</div>
          </div>

          <div v-if="analyzing && !streamingText" class="text-center q-py-xl">
            <q-spinner color="primary" size="2em" />
            <p class="analyzing-text q-mt-md">Analyzing with AI...</p>
          </div>

          <div v-else-if="analysisError" class="q-pa-md bg-negative text-white rounded-borders">
            <q-icon name="error" class="q-mr-sm" />
            {{ analysisError }}
          </div>

          <div v-else-if="streamingText || analysisResult" class="analysis-content">
            <div class="analysis-text markdown-content" v-html="renderedMarkdown"></div>
            <q-separator v-if="!analyzing" class="q-my-md" />
            <div v-if="!analyzing" class="text-caption provider-info">
              Powered by {{ analysisResult?.provider }} ({{ analysisResult?.model }})
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Delete Confirmation Dialog -->
    <q-dialog v-model="deleteDialog">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Delete Entry</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          Are you sure you want to delete this entry?
          <div v-if="entryToDelete" class="q-mt-md q-pa-sm bg-grey-2 rounded-borders">
            <em>"{{ entryToDelete.sentence }}"</em>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="primary" v-close-popup />
          <q-btn flat label="Delete" color="negative" :loading="deleting" @click="handleDelete" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useQuasar } from 'quasar';
import { storeToRefs } from 'pinia';
import { fetchAuthSession } from 'aws-amplify/auth';
import { config } from 'src/config';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  getMyDictionaries,
  deleteDictionaryEntry,
  type MyDictionaryEntry,
  type SentenceAnalysis,
} from 'src/services/myDictionariesService';
import { useLLMSettingsStore } from 'src/stores/llmSettings';
import { useAuthStore } from 'src/stores/auth';
import { generatePronunciation, playAudio } from 'src/services/ttsService';

const $q = useQuasar();
const llmSettings = useLLMSettingsStore();
const authStore = useAuthStore();
const { provider, currentModel, currentApiKey } = storeToRefs(llmSettings);
const { user, isAuthenticated } = storeToRefs(authStore);

const entries = ref<MyDictionaryEntry[]>([]);
const loading = ref(false);
const error = ref('');
const deleteDialog = ref(false);
const deleting = ref(false);
const entryToDelete = ref<MyDictionaryEntry | null>(null);

// AI Analysis state
const aiDialog = ref(false);
const analyzing = ref(false);
const analyzingSentence = ref<MyDictionaryEntry | null>(null);
const analysisResult = ref<SentenceAnalysis | null>(null);
const analysisError = ref('');
const streamingText = ref('');

// Configure marked options
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Computed property to render markdown with XSS protection
const renderedMarkdown = computed(() => {
  const text = streamingText.value || analysisResult.value?.analysis || '';
  if (!text) return '';
  const rawHtml = marked.parse(text) as string;
  // Sanitize HTML to prevent XSS attacks from LLM output or user input
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'del',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'a',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
});

onMounted(() => {
  loadEntries();
});

async function loadEntries() {
  loading.value = true;
  error.value = '';

  try {
    entries.value = await getMyDictionaries();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load dictionary entries';
  } finally {
    loading.value = false;
  }
}

function confirmDelete(entry: MyDictionaryEntry) {
  entryToDelete.value = entry;
  deleteDialog.value = true;
}

async function handleDelete() {
  if (!entryToDelete.value) return;

  deleting.value = true;

  try {
    await deleteDictionaryEntry(entryToDelete.value.sentence_id);

    // Remove from list
    entries.value = entries.value.filter(
      (entry) => entry.sentence_id !== entryToDelete.value?.sentence_id,
    );

    $q.notify({
      type: 'positive',
      message: 'Dictionary entry deleted successfully',
      position: 'top',
    });

    deleteDialog.value = false;
    entryToDelete.value = null;
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Failed to delete dictionary entry',
      position: 'top',
    });
  } finally {
    deleting.value = false;
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today at ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return (
      'Yesterday at ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
  } else if (diffDays < 7) {
    return diffDays + ' days ago';
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function formatUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

async function handleAskAI(entry: MyDictionaryEntry) {
  analyzingSentence.value = entry;
  analysisResult.value = null;
  analysisError.value = '';
  streamingText.value = '';
  aiDialog.value = true;
  analyzing.value = true;

  try {
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();

    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${config.api.url}my-dictionaries/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sentence: entry.sentence,
        provider: provider.value,
        model: currentModel.value,
        apiKey: currentApiKey.value,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to analyze sentence');
    }

    // Handle SSE streaming
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body');
    }

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.type === 'metadata') {
              analysisResult.value = {
                sentence: data.sentence,
                analysis: '',
                provider: data.provider,
                model: data.model,
              };
            } else if (data.type === 'chunk') {
              streamingText.value += data.text;
            } else if (data.type === 'done') {
              analyzing.value = false;
              if (analysisResult.value) {
                analysisResult.value.analysis = streamingText.value;
              }
            } else if (data.type === 'error') {
              throw new Error(data.error);
            }
          } catch (e) {
            console.error('Error parsing SSE data:', e);
          }
        }
      }
    }
  } catch (err) {
    analysisError.value = err instanceof Error ? err.message : 'Failed to analyze sentence';
    $q.notify({
      type: 'negative',
      message: analysisError.value,
      position: 'top',
    });
    analyzing.value = false;
  }
}

async function handlePronounce(entry: MyDictionaryEntry) {
  // Check if authenticated and has a valid session
  if (!isAuthenticated.value || !authStore.session?.user?.id) {
    $q.notify({
      type: 'warning',
      message: 'Please sign in to use pronunciation features',
      position: 'top',
    });
    return;
  }

  try {
    // Use sentence_id as vocabulary ID for TTS caching
    // Get user ID from session if profile hasn't loaded yet
    const userId = user.value?.id || authStore.session.user.id;
    const { audioUrl } = await generatePronunciation(entry.sentence_id, entry.sentence, userId);
    await playAudio(audioUrl);
  } catch (err) {
    console.error('Pronunciation error:', err);
    $q.notify({
      type: 'negative',
      message:
        err instanceof Error
          ? err.message
          : 'Failed to play pronunciation. Please check your TTS settings.',
      position: 'top',
    });
  }
}
</script>

<style scoped>
.entries-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 16px;
}

.entry-card {
  transition: box-shadow 0.2s;
}

.entry-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.entry-text {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.6;
  color: #1a1a1a;
}

.entry-meta {
  display: flex;
  align-items: center;
  font-size: 13px;
}

.entry-meta a {
  text-decoration: none;
}

.entry-meta a:hover {
  text-decoration: underline;
}

.entry-date {
  display: flex;
  align-items: center;
  font-size: 12px;
}

.sentence-display {
  font-size: 18px;
  line-height: 1.6;
  background-color: #f5f5f5;
}

.sentence-text {
  color: #1a1a1a;
}

.analyzing-text {
  color: #757575;
}

.analysis-content {
  font-size: 15px;
}

.analysis-text {
  color: #424242;
}

.provider-info {
  color: #757575;
}

.entry-text {
  color: #1a1a1a;
}

/* Dark mode support */
body.body--dark .sentence-display {
  background-color: rgba(255, 255, 255, 0.05);
}

body.body--dark .sentence-text {
  color: #e0e0e0;
}

body.body--dark .analyzing-text {
  color: #b8b8b8;
}

body.body--dark .analysis-text {
  color: #e0e0e0;
}

body.body--dark .provider-info {
  color: #b8b8b8;
}

body.body--dark .entry-text {
  color: #e0e0e0;
}

/* Markdown content styling */
.markdown-content {
  line-height: 1.8;
}

.markdown-content h1,
.markdown-content h2,
.markdown-content h3,
.markdown-content h4,
.markdown-content h5,
.markdown-content h6 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
  color: #1a1a1a;
}

.markdown-content h1 {
  font-size: 1.8em;
  border-bottom: 2px solid #e0e0e0;
  padding-bottom: 0.3em;
}

.markdown-content h2 {
  font-size: 1.5em;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0.3em;
}

.markdown-content h3 {
  font-size: 1.3em;
}

.markdown-content h4 {
  font-size: 1.1em;
}

.markdown-content p {
  margin-bottom: 1em;
}

.markdown-content ul,
.markdown-content ol {
  margin-bottom: 1em;
  padding-left: 2em;
}

.markdown-content li {
  margin-bottom: 0.5em;
}

.markdown-content code {
  background-color: #f5f5f5;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
  color: #d73a49;
}

.markdown-content pre {
  background-color: #f5f5f5;
  padding: 1em;
  border-radius: 6px;
  overflow-x: auto;
  margin-bottom: 1em;
}

.markdown-content pre code {
  background-color: transparent;
  padding: 0;
  color: #1a1a1a;
}

.markdown-content blockquote {
  border-left: 4px solid #ddd;
  padding-left: 1em;
  margin-left: 0;
  color: #666;
  font-style: italic;
}

.markdown-content strong {
  font-weight: 600;
  color: #1a1a1a;
}

.markdown-content em {
  font-style: italic;
}

.markdown-content a {
  color: #1976d2;
  text-decoration: none;
}

.markdown-content a:hover {
  text-decoration: underline;
}

.markdown-content hr {
  border: none;
  border-top: 1px solid #e0e0e0;
  margin: 1.5em 0;
}

.markdown-content table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 1em;
}

.markdown-content th,
.markdown-content td {
  border: 1px solid #ddd;
  padding: 0.5em;
  text-align: left;
}

.markdown-content th {
  background-color: #f5f5f5;
  font-weight: 600;
}

/* Dark mode markdown styling */
body.body--dark .markdown-content h1,
body.body--dark .markdown-content h2,
body.body--dark .markdown-content h3,
body.body--dark .markdown-content h4,
body.body--dark .markdown-content h5,
body.body--dark .markdown-content h6 {
  color: #e0e0e0;
}

body.body--dark .markdown-content h1 {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

body.body--dark .markdown-content h2 {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

body.body--dark .markdown-content code {
  background-color: rgba(255, 255, 255, 0.05);
  color: #ff7b72;
}

body.body--dark .markdown-content pre {
  background-color: rgba(255, 255, 255, 0.05);
}

body.body--dark .markdown-content pre code {
  color: #e0e0e0;
}

body.body--dark .markdown-content blockquote {
  border-left-color: rgba(255, 255, 255, 0.2);
  color: #b8b8b8;
}

body.body--dark .markdown-content strong {
  color: #e0e0e0;
}

body.body--dark .markdown-content a {
  color: #64b5f6;
}

body.body--dark .markdown-content hr {
  border-top-color: rgba(255, 255, 255, 0.1);
}

body.body--dark .markdown-content th,
body.body--dark .markdown-content td {
  border-color: rgba(255, 255, 255, 0.1);
}

body.body--dark .markdown-content th {
  background-color: rgba(255, 255, 255, 0.05);
}
</style>
