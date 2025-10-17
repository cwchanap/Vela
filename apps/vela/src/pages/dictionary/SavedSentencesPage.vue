<template>
  <q-page class="q-pa-md">
    <div class="row q-mb-md">
      <div class="col">
        <h4 class="q-my-none">Saved Sentences</h4>
        <p class="text-grey-7">Sentences saved from the browser extension</p>
      </div>
      <div class="col-auto">
        <q-btn
          color="primary"
          icon="refresh"
          label="Refresh"
          :loading="loading"
          @click="loadSentences"
        />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && sentences.length === 0" class="text-center q-pa-xl">
      <q-spinner color="primary" size="3em" />
      <p class="text-grey-7 q-mt-md">Loading saved sentences...</p>
    </div>

    <!-- Error State -->
    <q-banner v-else-if="error" class="bg-negative text-white q-mb-md" rounded>
      <template #avatar>
        <q-icon name="error" color="white" />
      </template>
      {{ error }}
      <template #action>
        <q-btn flat color="white" label="Retry" @click="loadSentences" />
      </template>
    </q-banner>

    <!-- Empty State -->
    <q-card v-else-if="sentences.length === 0" flat bordered class="q-pa-xl text-center">
      <q-icon name="chat_bubble_outline" size="4em" color="grey-5" />
      <h6 class="q-mt-md q-mb-sm">No Saved Sentences Yet</h6>
      <p class="text-grey-7 q-mb-md">
        Install the Vela browser extension to save sentences from any webpage.
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

    <!-- Sentences List -->
    <div v-else class="sentences-grid">
      <q-card v-for="item in sentences" :key="item.sentence_id" flat bordered class="sentence-card">
        <q-card-section>
          <div class="sentence-text">{{ item.sentence }}</div>

          <div v-if="item.context" class="sentence-meta q-mt-sm">
            <q-icon name="description" size="xs" class="q-mr-xs" />
            <span class="text-grey-7">{{ item.context }}</span>
          </div>

          <div v-if="item.source_url" class="sentence-meta q-mt-xs">
            <q-icon name="link" size="xs" class="q-mr-xs" />
            <a :href="item.source_url" target="_blank" class="text-primary">
              {{ formatUrl(item.source_url) }}
            </a>
          </div>

          <div class="sentence-date q-mt-sm text-grey-6">
            <q-icon name="schedule" size="xs" class="q-mr-xs" />
            {{ formatDate(item.created_at) }}
          </div>
        </q-card-section>

        <q-card-actions align="right">
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

    <!-- Delete Confirmation Dialog -->
    <q-dialog v-model="deleteDialog">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Delete Sentence</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          Are you sure you want to delete this sentence?
          <div v-if="sentenceToDelete" class="q-mt-md q-pa-sm bg-grey-2 rounded-borders">
            <em>"{{ sentenceToDelete.sentence }}"</em>
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
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import {
  getSavedSentences,
  deleteSavedSentence,
  type SavedSentence,
} from 'src/services/savedSentencesService';

const $q = useQuasar();

const sentences = ref<SavedSentence[]>([]);
const loading = ref(false);
const error = ref('');
const deleteDialog = ref(false);
const deleting = ref(false);
const sentenceToDelete = ref<SavedSentence | null>(null);

onMounted(() => {
  loadSentences();
});

async function loadSentences() {
  loading.value = true;
  error.value = '';

  try {
    sentences.value = await getSavedSentences();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load saved sentences';
  } finally {
    loading.value = false;
  }
}

function confirmDelete(sentence: SavedSentence) {
  sentenceToDelete.value = sentence;
  deleteDialog.value = true;
}

async function handleDelete() {
  if (!sentenceToDelete.value) return;

  deleting.value = true;

  try {
    await deleteSavedSentence(sentenceToDelete.value.sentence_id);

    // Remove from list
    sentences.value = sentences.value.filter(
      (s) => s.sentence_id !== sentenceToDelete.value?.sentence_id,
    );

    $q.notify({
      type: 'positive',
      message: 'Sentence deleted successfully',
      position: 'top',
    });

    deleteDialog.value = false;
    sentenceToDelete.value = null;
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Failed to delete sentence',
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
</script>

<style scoped>
.sentences-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 16px;
}

.sentence-card {
  transition: box-shadow 0.2s;
}

.sentence-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.sentence-text {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.6;
  color: #1a1a1a;
}

.sentence-meta {
  display: flex;
  align-items: center;
  font-size: 13px;
}

.sentence-meta a {
  text-decoration: none;
}

.sentence-meta a:hover {
  text-decoration: underline;
}

.sentence-date {
  display: flex;
  align-items: center;
  font-size: 12px;
}
</style>
