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
          <div class="entry-text">{{ item.sentence }}</div>

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
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import {
  getMyDictionaries,
  deleteDictionaryEntry,
  type MyDictionaryEntry,
} from 'src/services/myDictionariesService';

const $q = useQuasar();

const entries = ref<MyDictionaryEntry[]>([]);
const loading = ref(false);
const error = ref('');
const deleteDialog = ref(false);
const deleting = ref(false);
const entryToDelete = ref<MyDictionaryEntry | null>(null);

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
</style>
