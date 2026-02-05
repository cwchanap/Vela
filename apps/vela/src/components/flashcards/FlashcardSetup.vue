<template>
  <q-card class="setup-card q-pa-md">
    <q-card-section>
      <div class="text-h5 q-mb-md">Flashcard Review</div>

      <!-- Study Mode Selection -->
      <div class="q-mb-lg">
        <div class="text-subtitle2 q-mb-sm">Study Mode</div>
        <q-btn-toggle
          v-model="studyMode"
          spread
          no-caps
          rounded
          unelevated
          toggle-color="primary"
          :options="[
            { label: 'Due for Review', value: 'srs' },
            { label: 'Cram All', value: 'cram' },
          ]"
          class="mode-toggle"
        />
        <div class="text-caption text-grey q-mt-xs">
          {{
            studyMode === 'srs'
              ? 'Review words due based on spaced repetition'
              : 'Practice all vocabulary regardless of schedule'
          }}
        </div>
      </div>

      <!-- Card Direction -->
      <div class="q-mb-lg">
        <div class="text-subtitle2 q-mb-sm">Card Direction</div>
        <q-btn-toggle
          v-model="cardDirection"
          spread
          no-caps
          rounded
          unelevated
          toggle-color="primary"
          :options="[
            { label: 'Japanese → English', value: 'jp-to-en' },
            { label: 'English → Japanese', value: 'en-to-jp' },
          ]"
          class="direction-toggle"
        />
        <div class="text-caption text-grey q-mt-xs">
          {{
            cardDirection === 'jp-to-en'
              ? 'See Japanese, recall English meaning'
              : 'See English, type Japanese answer'
          }}
        </div>
      </div>

      <!-- JLPT Level Selection -->
      <div class="q-mb-lg">
        <jlpt-level-selector v-model="jlptLevels" />
      </div>

      <!-- Furigana Toggle -->
      <div class="q-mb-lg">
        <q-toggle v-model="showFurigana" label="Show Furigana" color="primary" />
        <div class="text-caption text-grey q-mt-xs">
          Display hiragana reading above kanji characters
        </div>
      </div>

      <!-- Due Count Info -->
      <div v-if="studyMode === 'srs' && isAuthenticated" class="due-info q-mb-md">
        <div v-if="dueCountError" class="text-negative">
          <q-icon name="error" class="q-mr-xs" />
          <span>{{ dueCountError }}</span>
        </div>
        <div v-else>
          <q-icon name="schedule" color="primary" class="q-mr-xs" />
          <span v-if="dueCount > 0" class="text-primary text-weight-medium">
            {{ dueCount }} words due for review
          </span>
          <span v-else class="text-grey"> No words due for review </span>
        </div>
      </div>

      <!-- Not Authenticated Warning -->
      <div v-if="!isAuthenticated" class="auth-warning q-mb-md">
        <q-banner rounded class="bg-warning text-white">
          <template v-slot:avatar>
            <q-icon name="warning" />
          </template>
          Sign in to track your progress with spaced repetition.
        </q-banner>
      </div>
    </q-card-section>

    <q-card-actions align="center">
      <q-btn
        @click="handleStart"
        :label="startButtonLabel"
        color="primary"
        size="lg"
        :loading="isLoading"
        :disable="studyMode === 'srs' && dueCount === 0 && !dueCountError"
        data-testid="btn-start-session"
      />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { flashcardService } from 'src/services/flashcardService';
import JlptLevelSelector from 'src/components/games/JlptLevelSelector.vue';
import type { JLPTLevel } from 'src/types/database';
import type { StudyMode, CardDirection } from 'src/stores/flashcards';

const emit = defineEmits<{
  (
    _e: 'start',
    _config: {
      studyMode: StudyMode;
      cardDirection: CardDirection;
      jlptLevels: JLPTLevel[];
      showFurigana: boolean;
    },
  ): void;
}>();

const authStore = useAuthStore();

const studyMode = ref<StudyMode>('srs');
const cardDirection = ref<CardDirection>('jp-to-en');
const jlptLevels = ref<JLPTLevel[]>([]);
const showFurigana = ref(true);
const dueCount = ref(0);
const dueCountError = ref<string | null>(null);
const isLoading = ref(false);

const isAuthenticated = computed(() => authStore.isAuthenticated);

// Monotonically increasing request ID to prevent race conditions
let requestId = 0;

const startButtonLabel = computed(() => {
  if (studyMode.value === 'srs') {
    if (dueCountError.value) {
      return 'Retry';
    }
    if (dueCount.value > 0) {
      return `Review ${Math.min(dueCount.value, 20)} Words`;
    }
    return 'No Words Due';
  }
  return 'Start Cram Session';
});

async function fetchDueCount() {
  if (!isAuthenticated.value) {
    dueCount.value = 0;
    dueCountError.value = null;
    return;
  }

  // Capture current request ID and increment for next request
  const currentRequestId = ++requestId;
  dueCountError.value = null;

  try {
    const jlptFilter = jlptLevels.value.length > 0 ? jlptLevels.value : undefined;
    const stats = await flashcardService.getStats(jlptFilter);

    // Only update if this is still the latest request (prevents race conditions)
    if (currentRequestId === requestId) {
      dueCount.value = stats.due_today;
      dueCountError.value = null;
    }
  } catch (error) {
    console.error('Failed to fetch due count:', error);

    // Only update if this is still the latest request (prevents race conditions)
    if (currentRequestId === requestId) {
      dueCountError.value = 'Unable to check due items. Please try again.';
      // Don't reset dueCount to 0 - keep previous value or show error
    }
  }
}

function handleStart() {
  if (studyMode.value === 'srs' && dueCountError.value) {
    fetchDueCount();
    return;
  }

  emit('start', {
    studyMode: studyMode.value,
    cardDirection: cardDirection.value,
    jlptLevels: jlptLevels.value,
    showFurigana: showFurigana.value,
  });
}

// Fetch due count on mount and when filters change
onMounted(() => {
  fetchDueCount();
});

watch([() => authStore.isAuthenticated, jlptLevels], () => {
  fetchDueCount();
});

// Expose methods for parent and tests
defineExpose({
  setLoading: (loading: boolean) => {
    isLoading.value = loading;
  },
  fetchDueCount,
});
</script>

<style scoped>
.setup-card {
  width: 100%;
  max-width: 450px;
}

.mode-toggle,
.direction-toggle {
  width: 100%;
}

.due-info {
  display: flex;
  align-items: center;
  font-size: 0.95rem;
}

.auth-warning {
  font-size: 0.9rem;
}
</style>
