<template>
  <q-page class="progress-page">
    <div class="progress-container">
      <!-- Page Header -->
      <div class="page-header">
        <h1 class="page-title">Learning Progress</h1>
        <p class="page-subtitle">Track your Japanese learning journey</p>
      </div>

      <!-- Main Progress Dashboard -->
      <div class="dashboard-section q-mb-lg">
        <ProgressDashboard />
      </div>

      <!-- Progress Content -->
      <div class="row q-col-gutter-lg">
        <!-- Progress Chart Section -->
        <div class="col-12 col-lg-8">
          <q-card class="full-height progress-card">
            <q-card-section>
              <div class="text-h6 q-mb-md">Progress Over Time</div>
              <div class="chart-wrapper">
                <ProgressChart
                  :data="chartData"
                  type="line"
                  :height="300"
                  data-key="experience"
                  color="primary"
                />
              </div>
            </q-card-section>
          </q-card>
        </div>

        <!-- Skills and Achievements Section -->
        <div class="col-12 col-lg-4">
          <div class="sidebar-content">
            <!-- Skill Categories -->
            <q-card class="q-mb-lg progress-card">
              <q-card-section>
                <div class="text-h6 q-mb-md">Skill Categories</div>
                <div class="skills-list">
                  <SkillCategoryCard
                    v-for="skill in skillCategories"
                    :key="skill.name"
                    :skill="skill"
                    :show-actions="false"
                    class="q-mb-sm"
                  />
                </div>
              </q-card-section>
            </q-card>

            <!-- Recent Achievements -->
            <q-card class="progress-card">
              <q-card-section>
                <div class="text-h6 q-mb-md">Recent Achievements</div>
                <div v-if="recentAchievements.length === 0" class="text-grey-7 text-center q-py-md">
                  No achievements yet. Keep learning to unlock them!
                </div>
                <div v-else class="achievements-list">
                  <AchievementItem
                    v-for="achievement in recentAchievements"
                    :key="achievement.id"
                    :achievement="achievement"
                    class="q-mb-sm"
                    @click="showAchievementDialog(achievement)"
                  />
                </div>
              </q-card-section>
            </q-card>
          </div>
        </div>
      </div>
    </div>

    <!-- Achievement Dialog -->
    <AchievementDialog v-model="achievementDialogOpen" :achievements="selectedAchievements" />
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useProgressStore } from 'src/stores/progress';
import { useAuthStore } from 'src/stores/auth';
import { storeToRefs } from 'pinia';
import ProgressDashboard from 'src/components/progress/ProgressDashboard.vue';
import ProgressChart from 'src/components/progress/ProgressChart.vue';
import SkillCategoryCard from 'src/components/progress/SkillCategoryCard.vue';
import AchievementItem from 'src/components/progress/AchievementItem.vue';
import AchievementDialog from 'src/components/progress/AchievementDialog.vue';
import type { Achievement } from 'src/services/progressService';

const progressStore = useProgressStore();
const authStore = useAuthStore();
const { skillCategories, recentAchievements, dailyProgressChart } = storeToRefs(progressStore);

// Dialog state
const achievementDialogOpen = ref(false);
const selectedAchievements = ref<Achievement[]>([]);

// Chart data for progress visualization
const chartData = computed(() => {
  return dailyProgressChart.value || [];
});

const showAchievementDialog = (achievement: Achievement) => {
  selectedAchievements.value = [achievement];
  achievementDialogOpen.value = true;
};

onMounted(async () => {
  // Load progress data when component mounts
  await progressStore.loadProgressAnalytics(authStore.user?.id || null);
});
</script>

<style lang="scss" scoped>
.progress-page {
  min-height: 100vh;
  padding: 24px;
  background: var(--bg-page);
}

.progress-container {
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.page-header {
  margin-bottom: 32px;
}

.page-title {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.page-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
}

.dashboard-section {
  max-width: 100%;
}

.chart-wrapper {
  width: 100%;
  overflow-x: auto;
}

.sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.skills-list,
.achievements-list {
  display: flex;
  flex-direction: column;
}

.full-height {
  height: 100%;
}

// Card styling scoped to progress cards
.progress-card {
  background: var(--bg-card);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
}

@media (max-width: 1024px) {
  .sidebar-content {
    flex-direction: row;
    gap: 1rem;
  }

  .sidebar-content > .q-card {
    flex: 1;
    margin-bottom: 0 !important;
  }
}

@media (max-width: 768px) {
  .progress-page {
    padding: 16px;
  }

  .page-title {
    font-size: 1.75rem;
  }

  .sidebar-content {
    flex-direction: column;
  }

  .sidebar-content > .q-card:first-child {
    margin-bottom: 1rem !important;
  }
}
</style>
