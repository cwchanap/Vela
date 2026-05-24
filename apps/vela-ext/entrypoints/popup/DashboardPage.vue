<template>
  <div class="vela-popup dashboard">
    <div class="ambient" aria-hidden="true">
      <div class="blob blob-a"></div>
    </div>

    <header class="dash-header">
      <div class="brand-cluster">
        <span class="brand-mark" aria-hidden="true">辞</span>
        <div class="brand-text">
          <span class="brand-name">Vela</span>
          <span class="brand-sub">Dictionary</span>
        </div>
      </div>
      <div v-if="userEmail" class="user-pill" :title="userEmail">
        <span class="user-dot"></span>
        <span class="user-email">{{ userEmail }}</span>
      </div>
    </header>

    <main class="dash-body">
      <section class="instructions" :class="{ expanded: instructionsExpanded }">
        <button
          type="button"
          class="instructions-header"
          @click="instructionsExpanded = !instructionsExpanded"
        >
          <span class="instructions-kanji" aria-hidden="true">選</span>
          <span class="instructions-title">How to save entries</span>
          <span class="instructions-chevron" :class="{ open: instructionsExpanded }">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </button>
        <ol v-show="instructionsExpanded" class="instructions-list">
          <li><span class="step-num">1</span>Select any text on a webpage</li>
          <li><span class="step-num">2</span>Right-click to open the context menu</li>
          <li><span class="step-num">3</span>Click <em>"Add vocab to Vela"</em></li>
        </ol>
      </section>

      <section class="entries-section">
        <div class="section-head">
          <div class="section-title">
            <h2>Your Dictionary</h2>
            <span
              v-if="pendingCount > 0"
              class="pending-badge"
              :title="`${pendingCount} sentence(s) waiting to sync`"
            >
              {{ pendingCount }} pending
            </span>
          </div>
          <button @click="loadEntries" :disabled="loading" class="refresh-btn" type="button">
            <span class="refresh-icon" :class="{ spinning: loading }">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M21 12a9 9 0 11-3.51-7.12M21 4v5h-5"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span>{{ loading ? 'Loading' : 'Refresh' }}</span>
          </button>
        </div>

        <div v-if="error" class="error-banner">
          <span class="error-dot"></span>
          {{ error }}
        </div>

        <button v-if="entries.length > 0" @click="openWebapp" class="view-all-btn" type="button">
          <span>Open in Web App</span>
          <span class="btn-arrow">↗</span>
        </button>

        <div v-if="entries.length === 0 && !loading" class="empty-state">
          <span class="empty-kanji" aria-hidden="true">空</span>
          <p class="empty-title">No entries yet</p>
          <p class="empty-copy">
            Select text on any webpage and right-click to start your dictionary.
          </p>
        </div>

        <div v-else class="entries-list">
          <article v-for="item in recentEntries" :key="item.sentence_id" class="entry">
            <div class="entry-head">
              <p class="entry-sentence">{{ item.sentence }}</p>
              <a
                v-if="item.source_url"
                :href="item.source_url"
                target="_blank"
                class="source-link"
                title="Open source"
                aria-label="Open source page"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10 14L21 3M21 3H15M21 3V9M21 13V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H11"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </a>
            </div>
            <div v-if="item.source_url" class="entry-source">
              <span class="source-label">Source</span>
              <a :href="item.source_url" target="_blank">{{ item.source_url }}</a>
            </div>
            <div class="entry-meta">
              <span class="entry-date">{{ formatDate(item.created_at) }}</span>
            </div>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { getMyDictionaries } from '../utils/api';
import { getValidIdToken, refreshIdToken, getUserEmail } from '../utils/storage';
import { getPendingQueueCount } from '../utils/pendingQueue';

const emit = defineEmits<{
  sessionExpired: [];
}>();

const userEmail = ref('');
const entries = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const instructionsExpanded = ref(false);
const pendingCount = ref(0);

function isPendingQueueMessage(message: unknown): message is { type: 'PENDING_QUEUE_UPDATED' } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'PENDING_QUEUE_UPDATED'
  );
}

async function refreshPendingCount() {
  pendingCount.value = await getPendingQueueCount();
}

function handleRuntimeMessage(message: unknown) {
  if (!isPendingQueueMessage(message)) return;
  void refreshPendingCount();
}

onMounted(async () => {
  const email = await getUserEmail();
  if (email) {
    userEmail.value = email;
  }

  browser.runtime.onMessage.addListener(handleRuntimeMessage);
  await loadEntries();
});

onUnmounted(() => {
  browser.runtime.onMessage.removeListener(handleRuntimeMessage);
});

async function loadEntries() {
  loading.value = true;
  error.value = '';

  try {
    let idToken = await getValidIdToken();

    try {
      const data = await getMyDictionaries(idToken);
      entries.value = data;
    } catch (apiError: any) {
      if (
        apiError.message?.includes('Unauthorized') ||
        apiError.message?.includes('expired token')
      ) {
        idToken = await refreshIdToken();

        if (!idToken) {
          throw new Error('Session expired. Please log in again.');
        }

        const data = await getMyDictionaries(idToken);
        entries.value = data;
      } else {
        throw apiError;
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load dictionary entries';

    if (err instanceof Error && isAuthenticationError(err)) {
      setTimeout(() => {
        emit('sessionExpired');
      }, 2000);
    }
  } finally {
    await refreshPendingCount();
    loading.value = false;
  }
}

function isAuthenticationError(error: Error): boolean {
  return [
    'Session expired',
    'Not authenticated',
    'No refresh token available',
    'No ID token available',
  ].some((message) => error.message.includes(message));
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' · ' + date.toLocaleTimeString();
}

function openWebapp() {
  const isDev = import.meta.env.MODE === 'development';
  const baseUrl = isDev ? 'http://localhost:9000' : 'https://vela.cwchanap.dev';
  browser.tabs.create({ url: `${baseUrl}/my-dictionaries` });
}

const recentEntries = computed(() => {
  return entries.value.slice(0, 5);
});
</script>

<style scoped>
.vela-popup.dashboard {
  position: relative;
  width: 400px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 90% -5%, rgba(123, 97, 255, 0.16), transparent 50%), var(--bg-page);
  overflow: hidden;
}

/* Ambient */
.ambient {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.22;
  will-change: transform;
}

.blob-a {
  width: 240px;
  height: 240px;
  background: var(--color-primary);
  top: -90px;
  right: -90px;
  animation: vela-blob-drift 14s ease-in-out infinite;
}

/* Header */
.dash-header {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(180deg, rgba(28, 26, 50, 0.4), transparent);
}

.brand-cluster {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-sakura) 130%);
  color: white;
  font-family: var(--font-jp);
  font-weight: 700;
  font-size: 1.1rem;
  box-shadow: 0 4px 14px rgba(123, 97, 255, 0.4);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.05;
}

.brand-name {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.brand-sub {
  font-family: var(--font-display);
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--color-primary-soft);
}

.user-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 8px;
  border-radius: 999px;
  background: var(--glass-bg-subtle);
  border: 1px solid var(--glass-border);
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-secondary);
  max-width: 180px;
}

.user-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 0 3px rgba(0, 204, 136, 0.18);
  flex-shrink: 0;
}

.user-email {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Body */
.dash-body {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 18px 18px;
  overflow-y: auto;
}

/* Instructions */
.instructions {
  background: var(--glass-bg-subtle);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: background 0.25s ease;
}

.instructions.expanded {
  background: var(--glass-bg);
}

.instructions-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.instructions-kanji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: rgba(123, 97, 255, 0.15);
  color: var(--color-primary-soft);
  font-family: var(--font-jp);
  font-weight: 700;
  font-size: 0.85rem;
}

.instructions-title {
  flex: 1;
  font-family: var(--font-display);
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-primary);
}

.instructions-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition:
    transform 0.25s ease,
    color 0.2s ease;
}

.instructions-chevron.open {
  transform: rotate(180deg);
  color: var(--color-primary-soft);
}

.instructions-list {
  list-style: none;
  margin: 0;
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  animation: vela-fade-up 0.25s ease-out both;
}

.instructions-list li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.instructions-list em {
  font-style: normal;
  color: var(--color-primary-soft);
  font-weight: 600;
}

.step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(123, 97, 255, 0.18);
  color: var(--color-primary-soft);
  font-family: var(--font-display);
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
}

/* Section head */
.entries-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.section-title h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.005em;
  color: var(--text-primary);
}

.pending-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(255, 107, 163, 0.18), rgba(123, 97, 255, 0.18));
  border: 1px solid rgba(255, 107, 163, 0.3);
  color: var(--color-sakura);
  font-family: var(--font-display);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.refresh-btn:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--color-primary-soft);
  background: var(--bg-elevated);
}

.refresh-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.refresh-icon {
  display: inline-flex;
  align-items: center;
  color: var(--color-primary-soft);
}

.refresh-icon.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Error banner */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255, 84, 112, 0.1);
  border: 1px solid rgba(255, 84, 112, 0.3);
  border-radius: var(--radius-md);
  color: var(--color-error);
  font-size: 0.8rem;
  line-height: 1.4;
}

.error-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-error);
  box-shadow: 0 0 0 3px rgba(255, 84, 112, 0.15);
}

/* View-all */
.view-all-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 14px;
  background: linear-gradient(
    135deg,
    var(--color-primary) 0%,
    #9b7bff 50%,
    var(--color-sakura) 130%
  );
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow:
    var(--shadow-button),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.25s ease;
}

.view-all-btn:hover {
  transform: translateY(-2px);
  box-shadow:
    0 10px 28px rgba(123, 97, 255, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.btn-arrow {
  font-size: 1rem;
  transition: transform 0.2s ease;
}

.view-all-btn:hover .btn-arrow {
  transform: translate(2px, -2px);
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 28px 16px 20px;
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg-subtle);
}

.empty-kanji {
  font-family: var(--font-jp);
  font-weight: 300;
  font-size: 3.2rem;
  line-height: 1;
  color: var(--color-primary);
  opacity: 0.35;
  margin-bottom: 6px;
}

.empty-title {
  margin: 4px 0 4px;
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-copy {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-tertiary);
  max-width: 28ch;
  line-height: 1.45;
}

/* Entries list */
.entries-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entry {
  position: relative;
  padding: 11px 12px;
  background: var(--glass-bg-subtle);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;
}

.entry:hover {
  border-color: var(--border-strong);
  background: var(--glass-bg);
  transform: translateY(-1px);
}

.entry-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.entry-sentence {
  margin: 0;
  flex: 1;
  font-family: var(--font-jp);
  font-weight: 500;
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--text-primary);
  word-break: break-word;
}

.source-link {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: rgba(255, 107, 163, 0.1);
  color: var(--color-sakura);
  transition:
    background 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.source-link:hover {
  background: rgba(255, 107, 163, 0.2);
  color: var(--color-sakura);
  transform: translate(1px, -1px);
}

.entry-source {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.7rem;
  color: var(--text-tertiary);
  word-break: break-all;
  line-height: 1.35;
}

.source-label {
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-primary-soft);
}

.entry-source a {
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.2s ease;
}

.entry-source a:hover {
  color: var(--color-primary-soft);
  text-decoration: underline;
}

.entry-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.entry-date {
  font-size: 0.68rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
</style>
