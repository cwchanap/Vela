<template>
  <q-page class="dashboard-page">
    <div class="dashboard-container">
      <!-- Hero Section: Daily Progress Ring -->
      <div class="daily-goal-hero">
        <div class="hero-content">
          <h1 class="hero-greeting">Welcome back, {{ authStore.userName }}!</h1>
          <p class="hero-subtitle">Let's continue your Japanese journey</p>
        </div>

        <div class="progress-ring-wrapper">
          <q-circular-progress
            :value="dailyProgress"
            size="180px"
            :thickness="0.1"
            color="primary"
            track-color="grey-3"
            class="progress-ring"
          >
            <div class="ring-content">
              <div class="ring-value">{{ minutesToday }}/{{ dailyGoalMinutes }}</div>
              <div class="ring-label">minutes today</div>
            </div>
          </q-circular-progress>
        </div>

        <q-btn
          unelevated
          rounded
          color="primary"
          size="lg"
          class="start-learning-btn"
          @click="navigateToLearn"
        >
          <q-icon name="play_arrow" size="sm" class="q-mr-sm" />
          Start Learning
        </q-btn>
      </div>

      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-badge">
          <q-icon name="local_fire_department" class="stat-icon streak" />
          <div class="stat-info">
            <span class="stat-value">{{ authStore.userStreak }}</span>
            <span class="stat-label">day streak</span>
          </div>
        </div>

        <div class="stat-badge">
          <q-icon name="star" class="stat-icon xp" />
          <div class="stat-info">
            <span class="stat-value">{{ authStore.userExperience }}</span>
            <span class="stat-label">total XP</span>
          </div>
        </div>

        <div class="stat-badge level-badge">
          <div class="level-circle">{{ authStore.userLevel }}</div>
          <div class="stat-info">
            <span class="stat-label">Level</span>
          </div>
        </div>

        <div class="stat-badge">
          <q-icon name="schedule" class="stat-icon time" />
          <div class="stat-info">
            <span class="stat-value">{{ minutesToday }}</span>
            <span class="stat-label">min today</span>
          </div>
        </div>
      </div>

      <!-- Quick Actions Grid -->
      <div class="section-header">
        <h2 class="section-title">Continue Learning</h2>
      </div>

      <div class="actions-grid">
        <div
          class="action-card"
          role="button"
          tabindex="0"
          aria-label="Navigate to Vocabulary game"
          @click="navigateTo('/games/vocabulary')"
          @keydown="handleActionKeydown('/games/vocabulary', $event)"
        >
          <div class="action-icon vocab">
            <q-icon name="quiz" />
          </div>
          <div class="action-title">Vocabulary</div>
          <div class="action-desc">Learn new words</div>
          <q-btn flat dense color="primary" class="action-btn">
            Play
            <q-icon name="chevron_right" size="xs" />
          </q-btn>
        </div>

        <div
          class="action-card"
          role="button"
          tabindex="0"
          aria-label="Navigate to Sentence game"
          @click="navigateTo('/games/sentence')"
          @keydown="handleActionKeydown('/games/sentence', $event)"
        >
          <div class="action-icon grammar">
            <q-icon name="reorder" />
          </div>
          <div class="action-title">Sentences</div>
          <div class="action-desc">Build sentences</div>
          <q-btn flat dense color="primary" class="action-btn">
            Play
            <q-icon name="chevron_right" size="xs" />
          </q-btn>
        </div>

        <div
          class="action-card"
          role="button"
          tabindex="0"
          aria-label="Open AI Tutor chat"
          @click="navigateTo('/chat')"
          @keydown="handleActionKeydown('/chat', $event)"
        >
          <div class="action-icon chat">
            <q-icon name="chat" />
          </div>
          <div class="action-title">AI Tutor</div>
          <div class="action-desc">Get help</div>
          <q-btn flat dense color="primary" class="action-btn">
            Chat
            <q-icon name="chevron_right" size="xs" />
          </q-btn>
        </div>

        <div
          class="action-card"
          role="button"
          tabindex="0"
          aria-label="View saved vocabulary"
          @click="navigateTo('/my-dictionaries')"
          @keydown="handleActionKeydown('/my-dictionaries', $event)"
        >
          <div class="action-icon writing">
            <q-icon name="bookmark" />
          </div>
          <div class="action-title">My Words</div>
          <div class="action-desc">Saved vocabulary</div>
          <q-btn flat dense color="primary" class="action-btn">
            View
            <q-icon name="chevron_right" size="xs" />
          </q-btn>
        </div>
      </div>

      <!-- Achievement Teaser -->
      <div class="achievement-teaser loading" v-if="achievementsLoading">
        <div class="teaser-content">
          <q-spinner size="24px" class="teaser-spinner" />
          <span class="teaser-text">Loading achievements…</span>
        </div>
      </div>

      <div class="achievement-teaser error" v-else-if="achievementsError">
        <div class="teaser-content">
          <q-icon name="error_outline" class="teaser-icon error" />
          <span class="teaser-text">{{ achievementsError }}</span>
        </div>
        <q-btn flat dense color="primary" @click="fetchAchievements">
          Retry
          <q-icon name="refresh" size="xs" />
        </q-btn>
      </div>

      <div class="achievement-teaser" v-else-if="achievements.length > 0">
        <div class="teaser-content">
          <q-icon name="emoji_events" class="teaser-icon" />
          <span class="teaser-text">{{ achievements.length }} achievements unlocked</span>
        </div>
        <q-btn flat dense color="primary" @click="navigateTo('/progress')">
          View all
          <q-icon name="chevron_right" size="xs" />
        </q-btn>
      </div>

      <!-- Empty state for achievements -->
      <div class="achievement-teaser empty" v-else>
        <div class="teaser-content">
          <q-icon name="emoji_events" class="teaser-icon empty" />
          <span class="teaser-text">Complete lessons to earn achievements!</span>
        </div>
        <q-btn flat dense color="primary" @click="navigateToLearn">
          Start now
          <q-icon name="chevron_right" size="xs" />
        </q-btn>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '../stores/auth';
import type { UserPreferences } from '../types/shared';
import { DEFAULT_DAILY_LESSON_GOAL, DEFAULT_LESSON_DURATION_MINUTES } from '../types/shared';
import { getApiUrl } from '../utils/api';

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
      dailyLessonGoal: DEFAULT_DAILY_LESSON_GOAL,
      lessonDurationMinutes: DEFAULT_LESSON_DURATION_MINUTES,
      difficulty: 'Beginner',
      notifications: true,
      todayStudyTime: 0,
    }
  );
});

const todayStudyTime = computed(() => preferences.value.todayStudyTime ?? 0);
const minutesToday = computed(() => Math.round(todayStudyTime.value));
const dailyGoalMinutes = computed(() => preferences.value.dailyGoal ?? 30);

const dailyProgress = computed(() => {
  if (!dailyGoalMinutes.value) {
    return 0;
  }
  return Math.min((minutesToday.value / dailyGoalMinutes.value) * 100, 100);
});

const achievements = ref<Achievement[]>([]);
const achievementsLoading = ref(false);
const achievementsError = ref<string | null>(null);
const achievementsAbort = ref<AbortController | null>(null);

const mapAchievement = (raw: any): Achievement | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const rawId = (raw as any).id ?? (raw as any).achievement_id;
  const id =
    typeof rawId === 'string' || typeof rawId === 'number' || typeof rawId === 'boolean'
      ? String(rawId).trim()
      : '';
  if (!id) return null;

  const rawTitle = (raw as any).name ?? (raw as any).title ?? rawId;
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : 'Achievement';

  const rawDescription = (raw as any).description;
  const description = typeof rawDescription === 'string' ? rawDescription : '';

  const rawIcon = (raw as any).icon;
  const icon = typeof rawIcon === 'string' && rawIcon.trim() ? rawIcon : 'emoji_events';

  const rawColor = (raw as any).color;
  const color = typeof rawColor === 'string' && rawColor.trim() ? rawColor : 'primary';

  return {
    id,
    title,
    description,
    icon,
    color,
  };
};

const fetchAchievements = async () => {
  const userId = authStore.user?.id;
  if (!userId) {
    achievements.value = [];
    return;
  }

  achievementsLoading.value = true;
  achievementsError.value = null;

  if (achievementsAbort.value) {
    achievementsAbort.value.abort();
  }

  const controller = new AbortController();
  achievementsAbort.value = controller;

  try {
    const params = new URLSearchParams({ user_id: userId });
    const res = await fetch(getApiUrl(`progress/analytics?${params.toString()}`), {
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(res.statusText || 'Failed to load achievements');
    }
    const data = await res.json();
    const list: Achievement[] =
      Array.isArray(data?.achievements) && data.achievements.length > 0
        ? (data.achievements.map(mapAchievement).filter(Boolean) as Achievement[])
        : Array.isArray(data?.userStats?.achievements)
          ? (data.userStats.achievements.map(mapAchievement).filter(Boolean) as Achievement[])
          : [];
    achievements.value = list;
  } catch (err) {
    if ((err as any)?.name === 'AbortError') return;
    console.error('Failed to fetch achievements:', err);
    achievementsError.value = err instanceof Error ? err.message : 'Failed to load achievements';
  } finally {
    if (achievementsAbort.value === controller) {
      achievementsLoading.value = false;
      achievementsAbort.value = null;
    }
  }
};

const navigateTo = async (path: string) => {
  try {
    await router.push(path);
  } catch (err) {
    console.error('Navigation failed:', err);
    $q.notify({
      type: 'negative',
      message: 'Navigation failed. Please try again.',
      timeout: 2000,
    });
  }
};

const navigateToLearn = () => {
  void router.push('/games');
};

const handleActionKeydown = (path: string, event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    navigateTo(path);
  }
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

  void fetchAchievements();
});

onBeforeUnmount(() => {
  if (achievementsAbort.value) {
    achievementsAbort.value.abort();
  }
});
</script>

<style scoped>
/* Dashboard Layout */
.dashboard-page {
  min-height: 100vh;
  padding: 24px;
  background: var(--bg-page);
}

.dashboard-container {
  max-width: 800px;
  margin: 0 auto;
}

/* Hero Section - Daily Goal */
.daily-goal-hero {
  background: var(--bg-card);
  border-radius: var(--border-radius-xl);
  padding: 32px;
  text-align: center;
  box-shadow: var(--shadow-card);
  margin-bottom: 24px;
}

.hero-content {
  margin-bottom: 24px;
}

.hero-greeting {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.hero-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
}

.progress-ring-wrapper {
  margin-bottom: 24px;
}

.progress-ring {
  margin: 0 auto;
}

.ring-content {
  text-align: center;
}

.ring-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1.2;
}

.ring-label {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.start-learning-btn {
  padding: 14px 32px;
  font-size: 1rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Stats Row */
.stats-row {
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
  flex-wrap: wrap;
  justify-content: center;
}

.stat-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--bg-card);
  border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-card);
  min-width: 140px;
  justify-content: center;
}

.stat-badge .stat-icon {
  font-size: 28px;
}

.stat-badge .stat-icon.streak {
  color: var(--color-streak);
}

.stat-badge .stat-icon.xp {
  color: var(--color-xp);
}

.stat-badge .stat-icon.time {
  color: var(--color-purple);
}

.stat-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: lowercase;
}

.level-badge .stat-info {
  align-items: center;
}

.level-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-level);
  color: white;
  font-size: 1.1rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Section Header */
.section-header {
  margin-bottom: 16px;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

/* Actions Grid */
.actions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.action-card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-backdrop);
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-lg);
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.action-card:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 4px;
}

.action-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-card-hover);
}

.action-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 12px;
  font-size: 24px;
  color: white;
}

.action-icon.vocab {
  background: var(--color-vocab);
}

.action-icon.grammar {
  background: var(--color-grammar);
}

.action-icon.chat {
  background: var(--color-chat);
}

.action-icon.writing {
  background: var(--color-writing);
}

.action-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.action-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.action-btn {
  font-weight: 600;
  text-transform: none;
}

/* Achievement Teaser */
.achievement-teaser {
  background: var(--bg-card);
  border-radius: var(--border-radius-md);
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--shadow-card);
}

.achievement-teaser.empty {
  background: var(--glass-bg-subtle);
  border: 1px dashed var(--glass-border);
  box-shadow: none;
}

.teaser-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.teaser-icon {
  font-size: 24px;
  color: var(--color-streak);
}

.teaser-icon.empty {
  color: var(--text-secondary);
}

.teaser-text {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
}

.achievement-teaser.empty .teaser-text {
  color: var(--text-secondary);
}

/* Responsive */
@media (max-width: 600px) {
  .dashboard-page {
    padding: 16px;
  }

  .daily-goal-hero {
    padding: 24px 16px;
  }

  .hero-greeting {
    font-size: 1.5rem;
  }

  .stats-row {
    gap: 8px;
  }

  .stat-badge {
    min-width: 120px;
    padding: 10px 12px;
  }

  .stat-badge .stat-icon {
    font-size: 24px;
  }

  .stat-value {
    font-size: 1.1rem;
  }

  .actions-grid {
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .action-card {
    padding: 16px;
  }

  .action-icon {
    width: 48px;
    height: 48px;
    font-size: 20px;
  }
}

@media (max-width: 400px) {
  .stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .stat-badge {
    min-width: auto;
  }
}
</style>
