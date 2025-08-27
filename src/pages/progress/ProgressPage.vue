<template>
  <q-page class="progress-page q-pa-md">
    <div class="page-header q-mb-lg">
      <div class="text-h4 q-mb-sm">Learning Progress</div>
      <div class="text-subtitle1 text-grey-7">Track your Japanese learning journey</div>
    </div>

    <div class="progress-content">
      <!-- Main Progress Dashboard -->
      <ProgressDashboard class="q-mb-lg" />

      <div class="row q-col-gutter-lg">
        <!-- Progress Chart Section -->
        <div class="col-12 col-md-8">
          <q-card class="progress-chart-card">
            <q-card-section>
              <div class="text-h6 q-mb-md">Progress Over Time</div>
              <ProgressChart
                :data="chartData"
                type="line"
                :height="300"
                data-key="experience"
                color="primary"
              />
            </q-card-section>
          </q-card>
        </div>

        <!-- Skills and Achievements Section -->
        <div class="col-12 col-md-4">
          <div class="column q-gutter-md">
            <!-- Skill Categories -->
            <q-card>
              <q-card-section>
                <div class="text-h6 q-mb-md">Skill Categories</div>
                <div class="column q-gutter-sm">
                  <SkillCategoryCard
                    v-for="skill in skillCategories"
                    :key="skill.name"
                    :skill="skill"
                    :show-actions="false"
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
                <div v-else class="column q-gutter-sm">
                  <AchievementItem
                    v-for="achievement in recentAchievements"
                    :key="achievement.id"
                    :achievement="achievement"
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
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  text-align: center;
}

.progress-content {
  width: 100%;
}

.progress-chart-card {
  height: fit-content;
}

@media (max-width: 768px) {
  .progress-page {
    padding: 1rem 0.5rem;
  }

  .page-header {
    margin-bottom: 1rem;
  }

  .text-h4 {
    font-size: 1.5rem;
  }
}
</style>
