<template>
  <div class="progress-dashboard">
    <!-- Level and Experience Section -->
    <div class="row q-gutter-md q-mb-lg">
      <q-card class="col-12 col-md-4">
        <q-card-section>
          <div class="text-h6 q-mb-md text-dark">Current Level</div>
          <div class="text-center">
            <div class="level-circle">
              <div class="text-h3 text-primary">{{ progressStore.learningStats.level }}</div>
              <div class="text-caption text-dark">Level</div>
            </div>
            <q-linear-progress
              :value="progressStore.currentLevelProgress / 100"
              color="primary"
              size="8px"
              class="q-mt-md"
            />
            <div class="text-caption q-mt-xs text-dark">
              {{ progressStore.learningStats.experience }} /
              {{ progressStore.learningStats.experienceToNextLevel }} XP
            </div>
          </div>
        </q-card-section>
      </q-card>

      <q-card class="col-12 col-md-4">
        <q-card-section>
          <div class="text-h6 q-mb-md text-dark">Learning Streak</div>
          <div class="text-center">
            <q-icon
              name="whatshot"
              :color="
                (progressStore.analytics?.learningStreak?.current_streak ?? 0) > 0
                  ? 'orange'
                  : 'grey'
              "
              size="64px"
            />
            <div class="text-h4 q-mt-sm">
              {{ progressStore.analytics?.learningStreak.current_streak || 0 }} days
            </div>
            <div class="text-caption text-dark">
              Best: {{ progressStore.analytics?.learningStreak.longest_streak || 0 }} days
            </div>
          </div>
        </q-card-section>
      </q-card>

      <q-card class="col-12 col-md-4">
        <q-card-section>
          <div class="text-h6 q-mb-md text-dark">Today's Progress</div>
          <div v-if="todayProgress">
            <div class="progress-stat">
              <q-icon name="book" color="primary" />
              <span>{{ todayProgress.vocabulary_studied }} words studied</span>
            </div>
            <div class="progress-stat">
              <q-icon name="school" color="secondary" />
              <span>{{ todayProgress.sentences_completed }} sentences completed</span>
            </div>
            <div class="progress-stat">
              <q-icon name="timer" color="accent" />
              <span>{{ todayProgress.time_spent_minutes }} minutes</span>
            </div>
            <div class="progress-stat">
              <q-icon name="star" color="warning" />
              <span>{{ todayProgress.experience_gained }} XP earned</span>
            </div>
          </div>
          <div v-else class="text-center text-dark">
            <q-icon name="schedule" size="48px" />
            <div class="q-mt-sm">Start learning today!</div>
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Progress Charts Section -->
    <div class="row q-gutter-md q-mb-lg">
      <q-card class="col-12 col-md-6">
        <q-card-section>
          <div class="text-h6 q-mb-md text-dark">Weekly Progress</div>
          <ProgressChart
            :data="progressStore.weeklyProgressChart"
            type="line"
            :height="200"
            data-key="experience"
            color="primary"
          />
        </q-card-section>
      </q-card>

      <q-card class="col-12 col-md-6">
        <q-card-section>
          <div class="text-h6 q-mb-md text-dark">Monthly Overview</div>
          <ProgressChart
            :data="progressStore.monthlyProgressChart"
            type="bar"
            :height="200"
            data-key="vocabulary"
            color="secondary"
          />
        </q-card-section>
      </q-card>
    </div>

    <!-- Spaced Repetition Stats Section -->
    <div class="row q-gutter-md q-mb-lg">
      <div class="col-12 col-md-6">
        <SrsStatsCard />
      </div>
    </div>

    <!-- Skill Categories Section -->
    <div class="row q-gutter-md q-mb-lg">
      <q-card class="col-12">
        <q-card-section>
          <div class="text-h6 q-mb-md text-dark">Skill Progress</div>
          <div class="row q-gutter-md">
            <div
              v-for="skill in progressStore.skillCategories"
              :key="skill.id"
              class="col-12 col-sm-6 col-md-4"
            >
              <SkillCategoryCard :skill="skill" />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Recent Achievements Section -->
    <div class="row q-gutter-md">
      <q-card class="col-12 col-md-6">
        <q-card-section>
          <div class="text-h6 q-mb-md text-dark">Recent Achievements</div>
          <div v-if="progressStore.recentAchievements.length > 0">
            <AchievementItem
              v-for="achievement in progressStore.recentAchievements"
              :key="achievement.id"
              :achievement="achievement"
              class="q-mb-sm"
            />
          </div>
          <div v-else class="text-center text-dark q-py-lg">
            <q-icon name="emoji_events" size="48px" />
            <div class="q-mt-sm text-dark">No achievements yet</div>
            <div class="text-caption text-dark">Keep learning to earn your first achievement!</div>
          </div>
        </q-card-section>
      </q-card>

      <q-card class="col-12 col-md-6">
        <q-card-section>
          <div class="text-h6 q-mb-md text-dark">Learning Statistics</div>
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-value text-primary">
                {{ progressStore.analytics?.wordsLearned || 0 }}
              </div>
              <div class="stat-label">Words Learned</div>
            </div>
            <div class="stat-item">
              <div class="stat-value text-secondary">
                {{ progressStore.analytics?.sentencesCompleted || 0 }}
              </div>
              <div class="stat-label">Sentences Completed</div>
            </div>
            <div class="stat-item">
              <div class="stat-value text-accent">
                {{ Math.round(progressStore.analytics?.averageAccuracy || 0) }}%
              </div>
              <div class="stat-label">Average Accuracy</div>
            </div>
            <div class="stat-item">
              <div class="stat-value text-warning">
                {{ Math.round((progressStore.analytics?.totalTimeSpent || 0) / 60) }}
              </div>
              <div class="stat-label">Hours Studied</div>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Achievement Notification Dialog -->
    <AchievementDialog
      v-model="showAchievementDialog"
      :achievements="progressStore.newAchievements"
      @close="progressStore.dismissNewAchievements"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useProgressStore } from 'src/stores/progress';
import { useAuthStore } from 'src/stores/auth';
import ProgressChart from './ProgressChart.vue';
import SkillCategoryCard from './SkillCategoryCard.vue';
import AchievementItem from './AchievementItem.vue';
import AchievementDialog from './AchievementDialog.vue';
import SrsStatsCard from './SrsStatsCard.vue';

const progressStore = useProgressStore();
const authStore = useAuthStore();
const showAchievementDialog = ref(false);

const todayProgress = computed(() => progressStore.getTodayProgress());

// Watch for new achievements
watch(
  () => progressStore.newAchievements,
  (newAchievements) => {
    if (newAchievements.length > 0) {
      showAchievementDialog.value = true;
    }
  },
  { deep: true },
);

onMounted(async () => {
  await progressStore.loadProgressAnalytics(authStore.user?.id || null);
});
</script>

<style scoped lang="scss">
.progress-dashboard {
  padding: 16px;
  color: #333;

  .text-h6 {
    color: #333;
  }

  .text-caption {
    color: #666;
  }

  .text-h4 {
    color: #333;
  }

  .progress-stat span {
    color: #333;
  }

  .text-center {
    color: #333;
  }
}

.level-circle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 120px;
  border: 3px solid var(--q-primary);
  border-radius: 50%;
  margin: 0 auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: black;

  .text-h3 {
    font-weight: bold;
    margin-bottom: 4px;
  }
}

.progress-stat {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: #333;

  .q-icon {
    font-size: 20px;
    margin-right: 8px;
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.stat-item {
  text-align: center;
  padding: 16px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.02);
}

.stat-value {
  font-size: 2rem;
  font-weight: 600;
  line-height: 1;
}

.stat-label {
  font-size: 0.875rem;
  color: #666;
  margin-top: 4px;
}
</style>
