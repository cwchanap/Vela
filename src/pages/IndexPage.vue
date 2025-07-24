<template>
  <q-page class="dashboard-page">
    <div class="container">
      <!-- Welcome Header -->
      <div class="welcome-header q-mb-lg">
        <div class="text-h4 text-primary">Welcome back, {{ authStore.userName }}! 👋</div>
        <div class="text-subtitle1 text-grey-7">
          Ready to continue your Japanese learning journey?
        </div>
      </div>

      <!-- Quick Stats -->
      <div class="row q-gutter-md q-mb-lg">
        <div class="col-12 col-sm-6 col-md-3">
          <q-card class="stat-card">
            <q-card-section class="text-center">
              <q-icon name="trending_up" size="2rem" color="positive" />
              <div class="text-h5 q-mt-sm">{{ authStore.userLevel }}</div>
              <div class="text-caption text-grey-6">Current Level</div>
            </q-card-section>
          </q-card>
        </div>

        <div class="col-12 col-sm-6 col-md-3">
          <q-card class="stat-card">
            <q-card-section class="text-center">
              <q-icon name="stars" size="2rem" color="warning" />
              <div class="text-h5 q-mt-sm">{{ authStore.userExperience }}</div>
              <div class="text-caption text-grey-6">Total XP</div>
            </q-card-section>
          </q-card>
        </div>

        <div class="col-12 col-sm-6 col-md-3">
          <q-card class="stat-card">
            <q-card-section class="text-center">
              <q-icon name="local_fire_department" size="2rem" color="deep-orange" />
              <div class="text-h5 q-mt-sm">{{ authStore.userStreak }}</div>
              <div class="text-caption text-grey-6">Day Streak</div>
            </q-card-section>
          </q-card>
        </div>

        <div class="col-12 col-sm-6 col-md-3">
          <q-card class="stat-card">
            <q-card-section class="text-center">
              <q-icon name="schedule" size="2rem" color="info" />
              <div class="text-h5 q-mt-sm">{{ todayStudyTime }}</div>
              <div class="text-caption text-grey-6">Minutes Today</div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="row q-gutter-lg">
        <div class="col-12 col-md-8">
          <q-card>
            <q-card-section>
              <div class="text-h6 q-mb-md">Quick Start</div>
              <div class="text-subtitle2 text-grey-6 q-mb-md">
                Choose an activity to continue learning
              </div>

              <div class="row q-gutter-md">
                <div class="col-12 col-sm-6">
                  <q-card
                    class="action-card cursor-pointer"
                    @click="handleComingSoon('Vocabulary Game')"
                  >
                    <q-card-section class="text-center">
                      <q-icon name="quiz" size="3rem" color="primary" />
                      <div class="text-h6 q-mt-sm">Vocabulary Game</div>
                      <div class="text-caption text-grey-6">
                        Learn new Japanese words with interactive flashcards
                      </div>
                      <q-chip
                        size="sm"
                        color="grey-4"
                        text-color="grey-7"
                        label="Coming Soon"
                        class="q-mt-sm"
                      />
                    </q-card-section>
                  </q-card>
                </div>

                <div class="col-12 col-sm-6">
                  <q-card
                    class="action-card cursor-pointer"
                    @click="handleComingSoon('Sentence Game')"
                  >
                    <q-card-section class="text-center">
                      <q-icon name="reorder" size="3rem" color="secondary" />
                      <div class="text-h6 q-mt-sm">Sentence Game</div>
                      <div class="text-caption text-grey-6">
                        Practice grammar with sentence building exercises
                      </div>
                      <q-chip
                        size="sm"
                        color="grey-4"
                        text-color="grey-7"
                        label="Coming Soon"
                        class="q-mt-sm"
                      />
                    </q-card-section>
                  </q-card>
                </div>

                <div class="col-12 col-sm-6">
                  <q-card class="action-card cursor-pointer" @click="handleComingSoon('AI Tutor')">
                    <q-card-section class="text-center">
                      <q-icon name="psychology" size="3rem" color="positive" />
                      <div class="text-h6 q-mt-sm">AI Tutor</div>
                      <div class="text-caption text-grey-6">
                        Get personalized help from your AI learning assistant
                      </div>
                      <q-chip
                        size="sm"
                        color="grey-4"
                        text-color="grey-7"
                        label="Coming Soon"
                        class="q-mt-sm"
                      />
                    </q-card-section>
                  </q-card>
                </div>

                <div class="col-12 col-sm-6">
                  <q-card
                    class="action-card cursor-pointer"
                    @click="handleComingSoon('Drawing Practice')"
                  >
                    <q-card-section class="text-center">
                      <q-icon name="draw" size="3rem" color="warning" />
                      <div class="text-h6 q-mt-sm">Drawing Practice</div>
                      <div class="text-caption text-grey-6">
                        Practice writing Japanese characters with stroke order
                      </div>
                      <q-chip
                        size="sm"
                        color="grey-4"
                        text-color="grey-7"
                        label="Coming Soon"
                        class="q-mt-sm"
                      />
                    </q-card-section>
                  </q-card>
                </div>
              </div>
            </q-card-section>
          </q-card>
        </div>

        <div class="col-12 col-md-4">
          <q-card>
            <q-card-section>
              <div class="text-h6 q-mb-md">Daily Goal</div>

              <div class="text-center q-mb-md">
                <q-circular-progress
                  :value="dailyProgress"
                  size="120px"
                  :thickness="0.15"
                  color="primary"
                  track-color="grey-3"
                  class="q-ma-md"
                >
                  <div class="text-h6">{{ Math.round(dailyProgress) }}%</div>
                </q-circular-progress>
              </div>

              <div class="text-center">
                <div class="text-subtitle2">{{ todayStudyTime }} / {{ dailyGoal }} minutes</div>
                <div class="text-caption text-grey-6">
                  {{ dailyGoal - todayStudyTime }} minutes to go!
                </div>
              </div>

              <q-btn
                color="primary"
                label="Start Learning"
                class="full-width q-mt-md"
                @click="handleComingSoon('Learning Session')"
              />
            </q-card-section>
          </q-card>

          <!-- Recent Achievements -->
          <q-card class="q-mt-md">
            <q-card-section>
              <div class="text-h6 q-mb-md">Recent Achievements</div>

              <div v-if="achievements.length === 0" class="text-center q-py-md">
                <q-icon name="emoji_events" size="2rem" color="grey-5" />
                <div class="text-subtitle2 text-grey-6 q-mt-sm">No achievements yet</div>
                <div class="text-caption text-grey-5">
                  Start learning to earn your first achievement!
                </div>
              </div>

              <q-list v-else separator>
                <q-item v-for="achievement in achievements" :key="achievement.id">
                  <q-item-section avatar>
                    <q-icon :name="achievement.icon" :color="achievement.color" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>{{ achievement.title }}</q-item-label>
                    <q-item-label caption>{{ achievement.description }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '../stores/auth';
import type { UserPreferences } from '../services/supabase';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}

const router = useRouter();
const $q = useQuasar();
const authStore = useAuthStore();

const preferences = computed((): UserPreferences => {
  return (
    authStore.user?.preferences || {
      dailyGoal: 30,
      difficulty: 'Beginner',
      notifications: true,
      todayStudyTime: 0,
    }
  );
});

const dailyGoal = computed(() => preferences.value.dailyGoal);
const todayStudyTime = computed(() => preferences.value.todayStudyTime || 0);

const dailyProgress = computed(() => {
  if (dailyGoal.value === 0) return 0;
  return Math.min((todayStudyTime.value / dailyGoal.value) * 100, 100);
});

// Mock achievements - in real app, this would come from API
const achievements = ref<Achievement[]>([]);

const handleComingSoon = (feature: string) => {
  $q.notify({
    type: 'info',
    message: `${feature} is coming soon! Stay tuned for updates.`,
    timeout: 3000,
  });
};

onMounted(async () => {
  // Ensure auth store is initialized
  if (!authStore.isInitialized) {
    await authStore.initialize();
  }

  // Redirect to login if not authenticated
  if (!authStore.isAuthenticated) {
    void router.push('/auth/login');
  }
});
</script>

<style scoped>
.dashboard-page {
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
}

.container {
  width: 100%;
}

.welcome-header {
  text-align: center;
  padding: 2rem 0;
}

.stat-card {
  transition: transform 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
}

.action-card {
  transition: all 0.2s ease;
  border: 2px solid transparent;
}

.action-card:hover {
  transform: translateY(-2px);
  border-color: var(--q-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

@media (max-width: 600px) {
  .dashboard-page {
    padding: 0.5rem;
  }

  .welcome-header {
    padding: 1rem 0;
  }

  .text-h4 {
    font-size: 1.5rem;
  }
}
</style>
