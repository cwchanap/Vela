<template>
  <q-page class="q-pa-md">
    <!-- Page Header -->
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">Profile Settings</div>
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
      <div class="text-subtitle2 text-grey-7 q-mb-md">Please sign in to view your profile</div>
      <q-btn color="primary" label="Sign In" @click="$router.push('/auth/login')" />
    </div>

    <!-- Profile Content -->
    <div v-else class="profile-content">
      <!-- Content Grid -->
      <div class="content-grid">
        <!-- Left Column: Stats and Activity -->
        <div class="left-column">
          <!-- Learning Statistics Card -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle1 q-mb-md">Learning Statistics</div>

              <div class="stats-grid">
                <div class="stat-box">
                  <div class="stat-value">{{ authStore.userLevel }}</div>
                  <div class="stat-label">Level</div>
                </div>
                <div class="stat-box">
                  <div class="stat-value">{{ authStore.userExperience }}</div>
                  <div class="stat-label">Total XP</div>
                </div>
                <div class="stat-box">
                  <div class="stat-value">{{ authStore.userStreak }}</div>
                  <div class="stat-label">Day Streak</div>
                </div>
                <div class="stat-box">
                  <div class="stat-value">{{ nextLevelXP }}</div>
                  <div class="stat-label">Next Level</div>
                </div>
              </div>

              <div class="progress-section">
                <div class="progress-header">
                  <span class="text-caption">Level {{ authStore.userLevel }} Progress</span>
                  <span class="text-caption text-weight-medium">
                    {{ currentLevelXP }} / {{ xpPerLevel }} XP
                  </span>
                </div>
                <q-linear-progress :value="levelProgress" color="primary" size="10px" rounded />
              </div>
            </q-card-section>
          </q-card>

          <!-- Recent Activity Card -->
          <q-card flat bordered>
            <q-card-section>
              <div class="text-subtitle1 q-mb-md">Recent Activity</div>

              <div v-if="recentActivity.length === 0" class="text-center q-py-md">
                <q-icon name="history" size="2.5rem" color="grey-5" />
                <div class="text-body2 text-grey-7 q-mt-sm">No recent activity</div>
                <div class="text-caption text-grey-6">Start learning to see your progress</div>
              </div>

              <q-list v-else>
                <q-item v-for="activity in recentActivity" :key="activity.id" class="q-px-none">
                  <q-item-section avatar>
                    <q-avatar :color="activity.color" text-color="white" size="40px">
                      <q-icon :name="activity.icon" />
                    </q-avatar>
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-medium">{{ activity.title }}</q-item-label>
                    <q-item-label caption>{{ activity.description }}</q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-item-label caption class="text-grey-7">{{ activity.time }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </div>

        <!-- Right Column: User Profile Card -->
        <div class="profile-card-wrapper">
          <UserProfile />
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

<style scoped lang="scss">
.profile-content {
  width: 100%;
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;

  @media (min-width: 1024px) {
    grid-template-columns: 1fr 400px;
    gap: 1.5rem;
  }
}

.left-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.profile-card-wrapper {
  width: 100%;
}

// Stats Section
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-box {
  text-align: center;
  padding: 1.25rem 1rem;
  background: rgba(var(--q-primary-rgb), 0.05);
  border-radius: 12px;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(var(--q-primary-rgb), 0.08);
    transform: translateY(-2px);
  }
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--q-primary);
  line-height: 1;
  margin-bottom: 0.5rem;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--q-grey-7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.progress-section {
  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    color: var(--q-grey-7);
  }
}

// Mobile Adjustments
@media (max-width: 1023px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .stats-grid {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }

  .stat-box {
    padding: 1rem;
  }

  .stat-value {
    font-size: 1.75rem;
  }
}
</style>
