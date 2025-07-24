<template>
  <q-page class="profile-page">
    <div class="container">
      <!-- Page Header -->
      <div class="page-header q-mb-lg">
        <q-btn flat round icon="arrow_back" @click="$router.back()" class="q-mr-md" />
        <div>
          <div class="text-h5">Profile Settings</div>
          <div class="text-subtitle2 text-grey-6">Manage your account and learning preferences</div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="authStore.isLoading && !authStore.user" class="text-center q-py-xl">
        <q-spinner-dots size="3rem" color="primary" />
        <div class="text-subtitle1 q-mt-md">Loading profile...</div>
      </div>

      <!-- Not Authenticated -->
      <div v-else-if="!authStore.isAuthenticated" class="text-center q-py-xl">
        <q-icon name="person_off" size="4rem" color="grey-5" />
        <div class="text-h6 q-mt-md">Not Signed In</div>
        <div class="text-subtitle2 text-grey-6 q-mb-md">Please sign in to view your profile</div>
        <q-btn color="primary" label="Sign In" @click="$router.push('/auth/login')" />
      </div>

      <!-- Profile Content -->
      <div v-else class="profile-content">
        <UserProfile />

        <!-- Additional Profile Sections -->
        <div class="row q-gutter-lg q-mt-lg">
          <!-- Learning Statistics -->
          <div class="col-12 col-md-6">
            <q-card>
              <q-card-section>
                <div class="text-h6 q-mb-md">Learning Statistics</div>

                <div class="stats-grid">
                  <div class="stat-item">
                    <div class="stat-value">{{ authStore.userLevel }}</div>
                    <div class="stat-label">Current Level</div>
                  </div>

                  <div class="stat-item">
                    <div class="stat-value">{{ authStore.userExperience }}</div>
                    <div class="stat-label">Total XP</div>
                  </div>

                  <div class="stat-item">
                    <div class="stat-value">{{ authStore.userStreak }}</div>
                    <div class="stat-label">Day Streak</div>
                  </div>

                  <div class="stat-item">
                    <div class="stat-value">{{ nextLevelXP }}</div>
                    <div class="stat-label">XP to Next Level</div>
                  </div>
                </div>

                <!-- Progress Bar -->
                <div class="q-mt-md">
                  <div class="text-caption text-grey-6 q-mb-xs">
                    Level {{ authStore.userLevel }} Progress
                  </div>
                  <q-linear-progress :value="levelProgress" color="primary" size="8px" rounded />
                  <div class="text-caption text-grey-6 q-mt-xs">
                    {{ currentLevelXP }} / {{ xpPerLevel }} XP
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </div>

          <!-- Recent Activity -->
          <div class="col-12 col-md-6">
            <q-card>
              <q-card-section>
                <div class="text-h6 q-mb-md">Recent Activity</div>

                <div v-if="recentActivity.length === 0" class="text-center q-py-md">
                  <q-icon name="history" size="2rem" color="grey-5" />
                  <div class="text-subtitle2 text-grey-6 q-mt-sm">No recent activity</div>
                  <div class="text-caption text-grey-5">
                    Start learning to see your progress here
                  </div>
                </div>

                <q-list v-else separator>
                  <q-item v-for="activity in recentActivity" :key="activity.id" class="q-px-none">
                    <q-item-section avatar>
                      <q-icon :name="activity.icon" :color="activity.color" />
                    </q-item-section>

                    <q-item-section>
                      <q-item-label>{{ activity.title }}</q-item-label>
                      <q-item-label caption>{{ activity.description }}</q-item-label>
                    </q-item-section>

                    <q-item-section side>
                      <q-item-label caption>{{ activity.time }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="quick-actions q-mt-lg">
          <q-card>
            <q-card-section>
              <div class="text-h6 q-mb-md">Quick Actions</div>

              <div class="row q-gutter-md">
                <q-btn
                  color="primary"
                  icon="play_arrow"
                  label="Start Learning"
                  @click="$router.push('/games')"
                />

                <q-btn
                  color="secondary"
                  icon="chat"
                  label="AI Tutor"
                  @click="$router.push('/chat')"
                />

                <q-btn
                  color="positive"
                  icon="analytics"
                  label="View Progress"
                  @click="$router.push('/progress')"
                />

                <q-btn
                  color="info"
                  icon="settings"
                  label="Settings"
                  @click="$router.push('/settings')"
                />
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useAuthStore } from '../../stores/auth';
import UserProfile from '../../components/auth/UserProfile.vue';

// Composables
const authStore = useAuthStore();

// Computed
const xpPerLevel = 1000; // XP required per level

const currentLevelXP = computed(() => {
  return authStore.userExperience % xpPerLevel;
});

const nextLevelXP = computed(() => {
  return xpPerLevel - currentLevelXP.value;
});

const levelProgress = computed(() => {
  return currentLevelXP.value / xpPerLevel;
});

// Mock recent activity data (in real app, this would come from API)
const recentActivity = computed(() => [
  {
    id: 1,
    title: 'Vocabulary Game Completed',
    description: 'Scored 85% on Hiragana basics',
    time: '2 hours ago',
    icon: 'quiz',
    color: 'primary',
  },
  {
    id: 2,
    title: 'AI Chat Session',
    description: 'Practiced greetings for 15 minutes',
    time: '1 day ago',
    icon: 'chat',
    color: 'secondary',
  },
  {
    id: 3,
    title: 'Level Up!',
    description: 'Reached Level 3',
    time: '3 days ago',
    icon: 'star',
    color: 'positive',
  },
]);

onMounted(async () => {
  // Initialize auth store if not already done
  if (!authStore.isInitialized) {
    await authStore.initialize();
  }
});
</script>

<style scoped>
.profile-page {
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
}

.container {
  width: 100%;
}

.profile-content {
  width: 100%;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.stat-item {
  text-align: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--q-primary);
}

.stat-label {
  font-size: 0.875rem;
  color: var(--q-dark);
  margin-top: 0.25rem;
}

.quick-actions .q-btn {
  margin-right: 0.5rem;
  margin-bottom: 0.5rem;
}

@media (max-width: 600px) {
  .profile-page {
    padding: 0.5rem;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .quick-actions .q-btn {
    width: 100%;
    margin-right: 0;
  }
}
</style>
