<template>
  <q-page class="modern-dashboard-page">
    <div class="dashboard-container">
      <!-- Modern Welcome Header with Animations -->
      <div class="modern-welcome-header q-mb-xl">
        <div class="welcome-content glass-card">
          <div class="welcome-text">
            <h1 class="welcome-title gradient-text">
              Welcome back, {{ authStore.userName }}!
              <span class="wave-emoji floating">👋</span>
            </h1>
            <p class="welcome-subtitle">Ready to continue your Japanese learning journey?</p>
          </div>
          <div class="welcome-decoration">
            <div class="floating-circle circle-1"></div>
            <div class="floating-circle circle-2"></div>
            <div class="floating-circle circle-3"></div>
          </div>
        </div>
      </div>

      <!-- Modern Stats Grid with Glassmorphism -->
      <div class="stats-grid q-mb-xl">
        <div class="stat-card modern-card glass-card" data-aos="fade-up" data-aos-delay="100">
          <div class="stat-content">
            <div class="stat-icon-wrapper level-gradient">
              <q-icon name="trending_up" size="2.5rem" class="text-white" />
            </div>
            <div class="stat-info">
              <div class="stat-number gradient-text">{{ authStore.userLevel }}</div>
              <div class="stat-label">Current Level</div>
            </div>
          </div>
        </div>

        <div class="stat-card modern-card glass-card" data-aos="fade-up" data-aos-delay="200">
          <div class="stat-content">
            <div class="stat-icon-wrapper xp-gradient">
              <q-icon name="stars" size="2.5rem" class="text-white" />
            </div>
            <div class="stat-info">
              <div class="stat-number gradient-text">{{ authStore.userExperience }}</div>
              <div class="stat-label">Total XP</div>
            </div>
          </div>
        </div>

        <div class="stat-card modern-card glass-card" data-aos="fade-up" data-aos-delay="300">
          <div class="stat-content">
            <div class="stat-icon-wrapper streak-gradient">
              <q-icon name="local_fire_department" size="2.5rem" class="text-white" />
            </div>
            <div class="stat-info">
              <div class="stat-number gradient-text">{{ authStore.userStreak }}</div>
              <div class="stat-label">Day Streak</div>
            </div>
          </div>
        </div>

        <div class="stat-card modern-card glass-card" data-aos="fade-up" data-aos-delay="400">
          <div class="stat-content">
            <div class="stat-icon-wrapper time-gradient">
              <q-icon name="schedule" size="2.5rem" class="text-white" />
            </div>
            <div class="stat-info">
              <div class="stat-number gradient-text">{{ todayStudyTime }}</div>
              <div class="stat-label">Minutes Today</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Modern Quick Actions Section -->
      <div class="main-content-grid">
        <div class="quick-start-section">
          <div class="modern-card glass-card section-card">
            <div class="section-header q-mb-lg">
              <h2 class="section-title gradient-text">Quick Start</h2>
              <p class="section-subtitle">
                Choose an activity to continue your Japanese learning journey
              </p>
            </div>

            <div class="action-cards-grid">
              <div
                class="action-card modern-card glass-card"
                @click="handleComingSoon('Vocabulary Game')"
                data-aos="zoom-in"
                data-aos-delay="100"
              >
                <div class="action-content">
                  <div class="action-icon-wrapper vocab-gradient">
                    <q-icon name="quiz" size="3rem" class="text-black" />
                  </div>
                  <div class="action-info">
                    <h3 class="action-title">Vocabulary Game</h3>
                    <p class="action-description">
                      Learn new Japanese words with interactive flashcards
                    </p>
                    <div class="coming-soon-badge glass-card">
                      <q-icon name="schedule" size="sm" class="q-mr-xs" />
                      Coming Soon
                    </div>
                  </div>
                </div>
              </div>

              <div
                class="action-card modern-card glass-card"
                @click="handleComingSoon('Sentence Game')"
                data-aos="zoom-in"
                data-aos-delay="200"
              >
                <div class="action-content">
                  <div class="action-icon-wrapper grammar-gradient">
                    <q-icon name="reorder" size="3rem" class="text-black" />
                  </div>
                  <div class="action-info">
                    <h3 class="action-title">Sentence Game</h3>
                    <p class="action-description">
                      Practice grammar with sentence building exercises
                    </p>
                    <div class="coming-soon-badge glass-card">
                      <q-icon name="schedule" size="sm" class="q-mr-xs" />
                      Coming Soon
                    </div>
                  </div>
                </div>
              </div>

              <div
                class="action-card modern-card glass-card"
                @click="handleComingSoon('AI Tutor')"
                data-aos="zoom-in"
                data-aos-delay="300"
              >
                <div class="action-content">
                  <div class="action-icon-wrapper ai-gradient">
                    <q-icon name="psychology" size="3rem" class="text-black" />
                  </div>
                  <div class="action-info">
                    <h3 class="action-title">AI Tutor</h3>
                    <p class="action-description">
                      Get personalized help from your AI learning assistant
                    </p>
                    <div class="coming-soon-badge glass-card">
                      <q-icon name="schedule" size="sm" class="q-mr-xs" />
                      Coming Soon
                    </div>
                  </div>
                </div>
              </div>

              <div
                class="action-card modern-card glass-card"
                @click="handleComingSoon('Drawing Practice')"
                data-aos="zoom-in"
                data-aos-delay="400"
              >
                <div class="action-content">
                  <div class="action-icon-wrapper writing-gradient">
                    <q-icon name="draw" size="3rem" class="text-black" />
                  </div>
                  <div class="action-info">
                    <h3 class="action-title">Writing Practice</h3>
                    <p class="action-description">
                      Practice writing Japanese characters with stroke order
                    </p>
                    <div class="coming-soon-badge glass-card">
                      <q-icon name="schedule" size="sm" class="q-mr-xs" />
                      Coming Soon
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Modern Sidebar -->
        <div class="sidebar-section">
          <!-- Daily Goal Card -->
          <div
            class="modern-card glass-card section-card"
            data-aos="fade-left"
            data-aos-delay="200"
          >
            <div class="section-header q-mb-lg">
              <h3 class="section-title gradient-text">Daily Goal</h3>
              <p class="section-subtitle">Track your learning progress</p>
            </div>

            <div class="progress-circle-container">
              <div class="progress-wrapper">
                <q-circular-progress
                  :value="dailyProgress"
                  size="140px"
                  :thickness="0.12"
                  color="primary"
                  track-color="rgba(255,255,255,0.2)"
                  class="modern-progress"
                  show-value
                >
                  <div class="progress-text">
                    <div class="progress-percentage gradient-text">
                      {{ Math.round(dailyProgress) }}%
                    </div>
                    <div class="progress-label">Complete</div>
                  </div>
                </q-circular-progress>
              </div>

              <div class="progress-stats q-mt-lg">
                <div class="stat-row">
                  <span class="stat-label">Today:</span>
                  <span class="stat-value">{{ todayStudyTime }} min</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Goal:</span>
                  <span class="stat-value">{{ dailyGoal }} min</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Remaining:</span>
                  <span class="stat-value">{{ Math.max(0, dailyGoal - todayStudyTime) }} min</span>
                </div>
              </div>

              <q-btn
                unelevated
                no-caps
                label="Start Learning"
                class="modern-btn start-btn q-mt-lg"
                @click="handleComingSoon('Learning Session')"
              >
                <q-icon name="play_arrow" size="sm" class="q-ml-xs" />
              </q-btn>
            </div>
          </div>

          <!-- Modern Achievements Card -->
          <div
            class="modern-card glass-card section-card q-mt-lg"
            data-aos="fade-left"
            data-aos-delay="300"
          >
            <div class="section-header q-mb-lg">
              <h3 class="section-title text-dark">Achievements</h3>
              <p class="section-subtitle">Your learning milestones</p>
            </div>

            <div v-if="achievements.length === 0" class="empty-achievements">
              <div class="empty-icon-wrapper">
                <q-icon name="emoji_events" size="3rem" class="empty-icon floating" />
              </div>
              <h4 class="empty-title">No achievements yet</h4>
              <p class="empty-subtitle">Start learning to earn your first achievement!</p>
            </div>

            <div v-else class="achievements-list">
              <div
                v-for="achievement in achievements"
                :key="achievement.id"
                class="achievement-item glass-card"
              >
                <div class="achievement-icon-wrapper">
                  <q-icon :name="achievement.icon" size="lg" :class="`text-${achievement.color}`" />
                </div>
                <div class="achievement-content">
                  <div class="achievement-title">{{ achievement.title }}</div>
                  <div class="achievement-description">{{ achievement.description }}</div>
                </div>
              </div>
            </div>
          </div>
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
import type { UserPreferences } from '../types/shared';

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
/* Modern Dashboard Styles */
.modern-dashboard-page {
  min-height: 100vh;
  padding: 2rem;
  background: transparent;
}

.dashboard-container {
  max-width: 1400px;
  margin: 0 auto;
}

/* Modern Welcome Header */
.modern-welcome-header {
  position: relative;
  margin-bottom: 3rem;
}

.welcome-content {
  position: relative;
  padding: 3rem 2rem;
  text-align: center;
  overflow: hidden;
  border: 1px solid var(--glass-border);
}

.welcome-title {
  font-size: 3rem;
  font-weight: 800;
  margin: 0 0 1rem 0;
  letter-spacing: -1px;
}

.wave-emoji {
  display: inline-block;
  animation-delay: 1s;
}

.welcome-subtitle {
  font-size: 1.2rem;
  color: #333;
  margin: 0;
  font-weight: 300;
}

body.body--dark .welcome-subtitle {
  color: #e0e0e0;
}

/* Floating decorative circles */
.welcome-decoration {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  overflow: hidden;
}

.floating-circle {
  position: absolute;
  border-radius: 50%;
  background: var(--gradient-warm);
  opacity: 0.1;
  animation: float 6s ease-in-out infinite;
}

.circle-1 {
  width: 80px;
  height: 80px;
  top: 20%;
  left: 10%;
  animation-delay: 0s;
}

.circle-2 {
  width: 120px;
  height: 120px;
  top: 60%;
  right: 15%;
  animation-delay: 2s;
}

.circle-3 {
  width: 60px;
  height: 60px;
  bottom: 20%;
  left: 80%;
  animation-delay: 4s;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-bottom: 3rem;
}

.stat-card {
  border: 1px solid var(--glass-border);
  cursor: default;
}

.stat-content {
  padding: 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stat-icon-wrapper {
  width: 80px;
  height: 80px;
  border-radius: var(--border-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-soft);
}

.level-gradient {
  background: var(--gradient-success);
}
.xp-gradient {
  background: var(--gradient-warm);
}
.streak-gradient {
  background: linear-gradient(135deg, #ff6b6b 0%, #ffa500 100%);
}
.time-gradient {
  background: var(--gradient-primary);
}

.stat-info {
  flex: 1;
}

.stat-number {
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.9rem;
  color: #666;
  font-weight: 500;
}

body.body--dark .stat-label {
  color: #b8b8b8;
}

/* Main Content Grid */
.main-content-grid {
  display: grid;
  grid-template-columns: 1fr 350px;
  gap: 2rem;
  align-items: start;
}

/* Section Cards */
.section-card {
  padding: 2rem;
  border: 1px solid var(--glass-border);
}

.section-header {
  text-align: center;
}

.section-title {
  font-size: 1.8rem;
  font-weight: 700;
  margin: 0 0 0.5rem 0;
}

.section-subtitle {
  color: #666;
  margin: 0;
  font-size: 1rem;
}

body.body--dark .section-subtitle {
  color: #b8b8b8;
}

/* Action Cards Grid */
.action-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.action-card {
  border: 1px solid var(--glass-border);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.action-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  transition: left 0.5s;
}

.action-card:hover::before {
  left: 100%;
}

.action-content {
  padding: 2rem;
  text-align: center;
}

.action-icon-wrapper {
  width: 80px;
  height: 80px;
  margin: 0 auto 1.5rem;
  border-radius: var(--border-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-medium);
}

.vocab-gradient {
  background: var(--gradient-primary);
}
.grammar-gradient {
  background: var(--gradient-secondary);
}
.ai-gradient {
  background: var(--gradient-success);
}
.writing-gradient {
  background: var(--gradient-warm);
}

.action-title {
  font-size: 1.3rem;
  font-weight: 600;
  margin: 0 0 0.75rem 0;
  color: #000;
}

body.body--dark .action-title {
  color: #fff;
}

.action-description {
  color: #666;
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0 0 1.5rem 0;
}

body.body--dark .action-description {
  color: #b8b8b8;
}

.coming-soon-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 1rem;
  border-radius: var(--border-radius-xl);
  font-size: 0.8rem;
  font-weight: 500;
  color: #666;
  border: 1px solid var(--glass-border);
}

body.body--dark .coming-soon-badge {
  color: #b8b8b8;
}

/* Sidebar Styles */
.sidebar-section {
  display: flex;
  flex-direction: column;
}

/* Progress Circle */
.progress-circle-container {
  text-align: center;
}

.progress-wrapper {
  position: relative;
  display: inline-block;
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.progress-percentage {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1;
}

.progress-label {
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.25rem;
}

body.body--dark .progress-label {
  color: #b8b8b8;
}

.progress-stats {
  background: rgba(255, 255, 255, 0.1);
  border-radius: var(--border-radius-sm);
  padding: 1rem;
  border: 1px solid var(--glass-border);
}

body.body--dark .progress-stats {
  background: rgba(255, 255, 255, 0.05);
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.stat-row:last-child {
  margin-bottom: 0;
}

.stat-label {
  color: #666;
  font-size: 0.9rem;
}

body.body--dark .stat-row .stat-label {
  color: #b8b8b8;
}

.stat-value {
  font-weight: 600;
  color: #000;
}

body.body--dark .stat-value {
  color: #fff;
}

.start-btn {
  width: 100%;
  background: var(--gradient-primary);
  color: #333;
  font-weight: 600;
  padding: 0.75rem 1.5rem;
  border-radius: var(--border-radius-md);
}

body.body--dark .start-btn {
  color: #000;
}

/* Empty Achievements */
.empty-achievements {
  text-align: center;
  padding: 2rem 1rem;
}

.empty-icon-wrapper {
  margin-bottom: 1rem;
}

.empty-icon {
  color: #999;
}

body.body--dark .empty-icon {
  color: #888;
}

.empty-title {
  color: #333;
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
}

body.body--dark .empty-title {
  color: #e0e0e0;
}

.empty-subtitle {
  color: #666;
  font-size: 0.9rem;
  margin: 0;
}

body.body--dark .empty-subtitle {
  color: #b8b8b8;
}

/* Achievement Items */
.achievements-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.achievement-item {
  display: flex;
  align-items: center;
  padding: 1rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-sm);
}

.achievement-icon-wrapper {
  margin-right: 1rem;
}

.achievement-content {
  flex: 1;
}

.achievement-title {
  font-weight: 600;
  color: white;
  margin-bottom: 0.25rem;
}

.achievement-description {
  font-size: 0.8rem;
  color: #666;
}

body.body--dark .achievement-description {
  color: #b8b8b8;
}

/* Responsive Design */
@media (max-width: 1200px) {
  .main-content-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
  }

  .sidebar-section {
    grid-row: 1;
  }
}

@media (max-width: 768px) {
  .modern-dashboard-page {
    padding: 1rem;
  }

  .welcome-content {
    padding: 2rem 1rem;
  }

  .welcome-title {
    font-size: 2rem;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .action-cards-grid {
    grid-template-columns: 1fr;
  }

  .section-card {
    padding: 1.5rem;
  }
}

@media (max-width: 480px) {
  .welcome-title {
    font-size: 1.5rem;
  }

  .stat-content {
    padding: 1rem;
  }

  .stat-icon-wrapper {
    width: 60px;
    height: 60px;
  }

  .action-content {
    padding: 1.5rem;
  }
}
</style>
