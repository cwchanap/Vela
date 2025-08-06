<template>
  <q-page class="q-pa-md dashboard-page">
    <div class="row items-center q-mb-lg">
      <q-avatar size="100px" class="q-mr-md">
        <img :src="user?.avatar_url || 'https://cdn.quasar.dev/img/boy-avatar.png'" />
      </q-avatar>
      <div class="flex-1">
        <h4 class="text-h4 q-ma-none text-dark">Welcome back, {{ userName }}!</h4>
        <p class="text-subtitle1 text-grey-7">Let's continue your Japanese learning journey.</p>
        <div class="user-level-info q-mt-sm">
          <q-chip
            :color="levelColor"
            text-color="white"
            :label="`Level ${progressStore.learningStats.level}`"
            icon="star"
          />
          <q-chip
            color="warning"
            text-color="white"
            :label="`${progressStore.learningStats.experience} XP`"
            icon="bolt"
            class="q-ml-sm"
          />
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="row q-gutter-md q-mb-lg">
      <q-card
        class="col-12 col-sm-6 col-md-3 quick-action-card"
        clickable
        @click="$router.push('/games/vocabulary')"
      >
        <q-card-section class="text-center">
          <q-icon name="book" color="primary" size="48px" />
          <div class="text-h6 q-mt-sm">Vocabulary</div>
          <div class="text-caption text-dark">Practice Japanese words</div>
        </q-card-section>
      </q-card>

      <q-card
        class="col-12 col-sm-6 col-md-3 quick-action-card"
        clickable
        @click="$router.push('/games/sentence')"
      >
        <q-card-section class="text-center">
          <q-icon name="school" color="secondary" size="48px" />
          <div class="text-h6 q-mt-sm">Grammar</div>
          <div class="text-caption text-dark">Build sentences</div>
        </q-card-section>
      </q-card>

      <q-card
        class="col-12 col-sm-6 col-md-3 quick-action-card"
        clickable
        @click="showProgressDialog = true"
      >
        <q-card-section class="text-center">
          <q-icon name="analytics" color="accent" size="48px" />
          <div class="text-h6 q-mt-sm">Progress</div>
          <div class="text-caption text-dark">View detailed stats</div>
        </q-card-section>
      </q-card>

      <q-card class="col-12 col-sm-6 col-md-3 quick-action-card" clickable>
        <q-card-section class="text-center">
          <q-icon name="chat" color="info" size="48px" />
          <div class="text-h6 q-mt-sm">AI Tutor</div>
          <div class="text-caption text-dark">Get help & practice</div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Progress Overview -->
    <ProgressDashboard />

    <!-- Progress Details Dialog -->
    <q-dialog v-model="showProgressDialog" maximized>
      <q-card>
        <q-bar class="bg-primary text-white">
          <div class="text-h6">Detailed Progress Analytics</div>
          <q-space />
          <q-btn dense flat icon="close" @click="showProgressDialog = false" />
        </q-bar>
        <q-card-section class="q-pa-none" style="height: calc(100vh - 50px); overflow-y: auto">
          <ProgressDashboard />
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { useProgressStore } from 'src/stores/progress';
import { storeToRefs } from 'pinia';
import ProgressDashboard from 'src/components/progress/ProgressDashboard.vue';

const authStore = useAuthStore();
const progressStore = useProgressStore();
const { user, userName } = storeToRefs(authStore);

const showProgressDialog = ref(false);

const levelColor = computed(() => {
  const level = progressStore.learningStats.level;
  if (level >= 25) return 'purple';
  if (level >= 15) return 'deep-orange';
  if (level >= 10) return 'orange';
  if (level >= 5) return 'green';
  return 'blue';
});

onMounted(async () => {
  // Load progress analytics when dashboard is mounted
  await progressStore.loadProgressAnalytics();
});
</script>

<style scoped lang="scss">
.text-h4 {
  font-weight: 600;
}

.user-level-info {
  .q-chip {
    font-weight: 600;
  }
}

.quick-action-card {
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  cursor: pointer;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  }

  .q-icon {
    transition: transform 0.2s ease;
  }

  &:hover .q-icon {
    transform: scale(1.1);
  }
}

.flex-1 {
  flex: 1;
}

// Ensure proper text contrast on dashboard
.dashboard-page {
  color: #333;

  .text-h4,
  .text-h5,
  .text-h6 {
    color: #333;
  }

  .text-caption {
    color: #666;
  }

  .progress-stat {
    color: #333;
  }
}
</style>
