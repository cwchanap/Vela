<template>
  <q-page class="progress-page">
    <div class="progress-container">
      <!-- Page Header -->
      <div class="page-header q-mb-lg">
        <div class="text-h4 q-mb-sm">Learning Progress</div>
        <div class="text-subtitle1 text-grey-7">Track your Japanese learning journey</div>
      </div>

      <!-- Main Progress Dashboard -->
      <div class="dashboard-section q-mb-lg">
        <ProgressDashboard />
      </div>

      <!-- Progress Content -->
      <div class="row q-col-gutter-lg">
        <!-- Progress Chart Section -->
        <div class="col-12 col-lg-8">
          <q-card class="full-height">
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
            <q-card class="q-mb-lg">
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
            <q-card>
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
import { storeToRefs } from 'pinia';
import ProgressDashboard from 'src/components/progress/ProgressDashboard.vue';
import ProgressChart from 'src/components/progress/ProgressChart.vue';
import SkillCategoryCard from 'src/components/progress/SkillCategoryCard.vue';
import AchievementItem from 'src/components/progress/AchievementItem.vue';
import AchievementDialog from 'src/components/progress/AchievementDialog.vue';
import type { Achievement } from 'src/services/progressService';

const progressStore = useProgressStore();
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
  await progressStore.loadProgressAnalytics();
});
</script>

<style lang="scss" scoped>
.progress-page {
  padding: 1.5rem;
}

.progress-container {
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.page-header {
  text-align: center;
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

@media (max-width: 1280px) {
  .progress-page {
    padding: 1rem;
  }

  .progress-container {
    max-width: 1200px;
  }
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
    padding: 0.75rem;
  }

  .page-header {
    margin-bottom: 1rem;
  }

  .text-h4 {
    font-size: 1.75rem;
  }

  .sidebar-content {
    flex-direction: column;
  }

  .sidebar-content > .q-card:first-child {
    margin-bottom: 1rem !important;
  }
}

@media (max-width: 600px) {
  .text-h4 {
    font-size: 1.5rem;
  }
}
</style>
