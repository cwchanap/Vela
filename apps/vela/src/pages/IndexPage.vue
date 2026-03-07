<template>
  <q-page class="dashboard-page">
    <!-- Ambient background blobs -->
    <div class="ambient-layer" aria-hidden="true">
      <div class="ambient-blob blob-primary"></div>
      <div class="ambient-blob blob-sakura"></div>
      <div class="ambient-blob blob-jade"></div>
    </div>

    <div class="dashboard-container">
      <!-- Hero Section: Daily Progress Ring -->
      <div class="daily-goal-hero anim-enter-1">
        <!-- Decorative kanji -->
        <span class="kanji-deco hero-kanji-1" aria-hidden="true">学</span>
        <span class="kanji-deco hero-kanji-2" aria-hidden="true">日</span>

        <div class="hero-content">
          <h1 class="hero-greeting">
            <span class="greeting-wave">👋</span>
            <span>{{ authStore.userName }}</span>
          </h1>
          <p class="hero-subtitle">Let's continue your Japanese journey</p>
        </div>

        <div class="progress-ring-wrapper">
          <div class="ring-outer-glow"></div>
          <q-circular-progress
            :value="dailyProgress"
            size="168px"
            :thickness="0.09"
            color="primary"
            track-color="grey-3"
            class="progress-ring"
          >
            <div class="ring-content">
              <div class="ring-value">
                {{ minutesToday }}<span class="ring-sep">/</span>{{ dailyGoalMinutes }}
              </div>
              <div class="ring-label">min today</div>
            </div>
          </q-circular-progress>
        </div>

        <q-btn
          unelevated
          rounded
          color="primary"
          size="lg"
          class="start-learning-btn"
          aria-label="Start a new learning session"
          @click="navigateToLearn"
        >
          <q-icon name="play_arrow" size="sm" class="q-mr-sm" />
          Start Learning
        </q-btn>
      </div>

      <!-- Stats Row -->
      <div class="stats-row anim-enter-2">
        <div class="stat-badge">
          <q-icon name="local_fire_department" class="stat-icon streak" />
          <div class="stat-info">
            <span class="stat-value">{{ authStore.userStreak }}</span>
            <span class="stat-label">Streak</span>
          </div>
        </div>

        <div class="stat-badge">
          <q-icon name="star" class="stat-icon xp" />
          <div class="stat-info">
            <span class="stat-value">{{ authStore.userExperience }}</span>
            <span class="stat-label">Total XP</span>
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
            <span class="stat-label">Min Today</span>
          </div>
        </div>
      </div>

      <!-- Quick Actions Grid -->
      <div class="section-header anim-enter-3">
        <h2 class="section-title">Continue Learning</h2>
        <span class="section-kana">学習</span>
      </div>

      <div class="actions-grid anim-enter-4">
        <div
          class="action-card action-card--vocab"
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
            Play <q-icon name="chevron_right" size="xs" />
          </q-btn>
        </div>

        <div
          class="action-card action-card--grammar"
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
          <q-btn flat dense color="secondary" class="action-btn">
            Play <q-icon name="chevron_right" size="xs" />
          </q-btn>
        </div>

        <div
          class="action-card action-card--chat"
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
          <q-btn flat dense color="positive" class="action-btn">
            Chat <q-icon name="chevron_right" size="xs" />
          </q-btn>
        </div>

        <div
          class="action-card action-card--writing"
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
          <q-btn flat dense color="purple" class="action-btn">
            View <q-icon name="chevron_right" size="xs" />
          </q-btn>
        </div>
      </div>

      <!-- Achievement Teaser -->
      <div class="achievement-teaser loading anim-enter-5" v-if="achievementsLoading">
        <div class="teaser-content">
          <q-spinner size="20px" color="primary" />
          <span class="teaser-text">Loading achievements…</span>
        </div>
      </div>

      <div class="achievement-teaser error anim-enter-5" v-else-if="achievementsError">
        <div class="teaser-content">
          <q-icon name="error_outline" class="teaser-icon error" />
          <span class="teaser-text">{{ achievementsError }}</span>
        </div>
        <q-btn flat dense color="primary" @click="fetchAchievements">
          Retry <q-icon name="refresh" size="xs" />
        </q-btn>
      </div>

      <div class="achievement-teaser anim-enter-5" v-else-if="achievements.length > 0">
        <div class="teaser-content">
          <span class="teaser-trophy">🏆</span>
          <div>
            <div class="teaser-text">{{ achievements.length }} achievements unlocked</div>
            <div class="teaser-sub">Keep up the great work!</div>
          </div>
        </div>
        <q-btn flat dense color="primary" @click="navigateTo('/progress')">
          View all <q-icon name="chevron_right" size="xs" />
        </q-btn>
      </div>

      <div class="achievement-teaser empty anim-enter-5" v-else>
        <div class="teaser-content">
          <span class="teaser-trophy dim">🏆</span>
          <div>
            <div class="teaser-text">Complete lessons to earn achievements!</div>
          </div>
        </div>
        <q-btn flat dense color="primary" @click="navigateToLearn">
          Start now <q-icon name="chevron_right" size="xs" />
        </q-btn>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter, isNavigationFailure, NavigationFailureType } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '../stores/auth';
import type { UserPreferences } from '../types/shared';
import { DEFAULT_DAILY_LESSON_GOAL, DEFAULT_LESSON_DURATION_MINUTES } from '../types/shared';
import { getApiUrl } from '../utils/api';
import { httpJsonAuth } from '../utils/httpClient';

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
  if (!dailyGoalMinutes.value) return 0;
  return Math.min((minutesToday.value / dailyGoalMinutes.value) * 100, 100);
});

const achievements = ref<Achievement[]>([]);
const achievementsLoading = ref(false);
const achievementsError = ref<string | null>(null);
const achievementsAbort = ref<AbortController | null>(null);

const mapAchievement = (raw: any): Achievement | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const rawId = (raw as any).id ?? (raw as any).achievement_id;
  let id: string | null = null;
  if (typeof rawId === 'string') {
    const trimmed = rawId.trim();
    id = trimmed || null;
  } else if (typeof rawId === 'number' && Number.isFinite(rawId)) {
    id = String(rawId);
  }
  if (!id) return null;

  const rawTitle = (raw as any).name ?? (raw as any).title ?? rawId;
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : 'Achievement';
  const rawDescription = (raw as any).description;
  const description = typeof rawDescription === 'string' ? rawDescription : '';
  const rawIcon = (raw as any).icon;
  const icon = typeof rawIcon === 'string' && rawIcon.trim() ? rawIcon : 'emoji_events';
  const rawColor = (raw as any).color;
  const color = typeof rawColor === 'string' && rawColor.trim() ? rawColor : 'primary';

  return { id, title, description, icon, color };
};

const fetchAchievements = async () => {
  const userId = authStore.user?.id;
  if (!userId) {
    achievements.value = [];
    return;
  }

  achievementsLoading.value = true;
  achievementsError.value = null;

  if (achievementsAbort.value) achievementsAbort.value.abort();

  const controller = new AbortController();
  achievementsAbort.value = controller;

  try {
    const params = new URLSearchParams({ user_id: userId });
    const data = await httpJsonAuth<{
      achievements?: unknown[];
      userStats?: { achievements?: unknown[] };
    }>(getApiUrl(`progress/analytics?${params.toString()}`), { signal: controller.signal });
    let list: Achievement[] = [];
    if (Array.isArray(data?.achievements) && data.achievements.length > 0) {
      list = data.achievements.map(mapAchievement).filter(Boolean) as Achievement[];
    } else if (Array.isArray(data?.userStats?.achievements)) {
      list = data.userStats.achievements.map(mapAchievement).filter(Boolean) as Achievement[];
    }
    achievements.value = list;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
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
    if (isNavigationFailure(err, NavigationFailureType.duplicated)) return;
    console.error('Navigation failed:', err);
    $q.notify({ type: 'negative', message: 'Navigation failed. Please try again.', timeout: 2000 });
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
  if (!authStore.isInitialized) await authStore.initialize();
  if (!authStore.isAuthenticated) void router.push('/auth/login');
  void fetchAchievements();
});

onBeforeUnmount(() => {
  if (achievementsAbort.value) achievementsAbort.value.abort();
});
</script>

<style scoped>
/* Dashboard Layout */
.dashboard-page {
  min-height: 100vh;
  padding: 28px 24px;
  background: var(--bg-page);
  position: relative;
  overflow: hidden;
}

.dashboard-container {
  max-width: 820px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* ==========================================
   HERO SECTION
   ========================================== */
.daily-goal-hero {
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-xl);
  padding: 36px 32px 32px;
  text-align: center;
  box-shadow: var(--shadow-card);
  margin-bottom: 20px;
  position: relative;
  overflow: hidden;
}

/* Decorative kanji inside hero */
.hero-kanji-1 {
  font-size: 120px;
  top: -20px;
  right: 16px;
  position: absolute;
}

.hero-kanji-2 {
  font-size: 80px;
  bottom: 12px;
  left: 16px;
  position: absolute;
}

.hero-content {
  margin-bottom: 28px;
  position: relative;
  z-index: 1;
}

.hero-greeting {
  font-family: 'Syne', sans-serif;
  font-size: 1.9rem;
  font-weight: 800;
  color: var(--text-primary);
  margin: 0 0 8px 0;
  letter-spacing: -0.03em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.greeting-wave {
  font-size: 1.6rem;
  animation: float-gentle 3s ease-in-out infinite;
  display: inline-block;
}

.hero-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
  font-weight: 400;
}

.progress-ring-wrapper {
  margin-bottom: 28px;
  position: relative;
  display: inline-block;
  z-index: 1;
}

.ring-outer-glow {
  position: absolute;
  inset: -12px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--glow-primary) 0%, transparent 70%);
  pointer-events: none;
}

.ring-content {
  text-align: center;
}

.ring-value {
  font-family: 'Syne', sans-serif;
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--color-primary);
  line-height: 1.1;
}

.ring-sep {
  font-weight: 300;
  opacity: 0.5;
  font-size: 1.2rem;
}

.ring-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: 2px;
}

.start-learning-btn {
  padding: 14px 40px;
  font-family: 'Syne', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0.02em;
  box-shadow: var(--shadow-button);
  position: relative;
  z-index: 1;
}

/* ==========================================
   STATS ROW
   ========================================== */
.stats-row {
  display: flex;
  gap: 12px;
  margin-bottom: 28px;
  flex-wrap: wrap;
  justify-content: center;
}

.stat-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  background: var(--bg-card);
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-card);
  min-width: 130px;
  justify-content: center;
}

.stat-badge:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-card-hover);
}

.stat-badge .stat-icon {
  font-size: 26px;
}

.stat-badge .stat-icon.streak {
  color: var(--color-streak);
  filter: drop-shadow(0 2px 6px var(--glow-amber));
}
.stat-badge .stat-icon.xp {
  color: var(--color-xp);
  filter: drop-shadow(0 2px 6px var(--glow-jade));
}
.stat-badge .stat-icon.time {
  color: var(--color-purple);
  filter: drop-shadow(0 2px 6px rgba(155, 97, 255, 0.3));
}

.stat-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat-value {
  font-family: 'Syne', sans-serif;
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1.1;
}

.stat-label {
  font-size: 0.7rem;
  color: var(--text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.level-badge .stat-info {
  align-items: center;
}

.level-circle {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-purple));
  color: white;
  font-family: 'Syne', sans-serif;
  font-size: 1.1rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px var(--glow-primary);
}

/* ==========================================
   SECTION HEADER
   ========================================== */
.section-header {
  margin-bottom: 16px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.section-title {
  font-family: 'Syne', sans-serif;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
}

.section-kana {
  font-family: 'Noto Serif JP', serif;
  font-size: 0.8rem;
  color: var(--color-primary);
  opacity: 0.5;
  font-weight: 300;
}

/* ==========================================
   ACTION CARDS
   ========================================== */
.actions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}

.action-card {
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-lg);
  padding: 22px 18px 18px;
  text-align: center;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

/* Colored top accent stripe per card type */
.action-card--vocab::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #5b4af7, #7b61ff);
}
.action-card--grammar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #e8447a, #ff6ba3);
}
.action-card--chat::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #1db87a, #00cc88);
}
.action-card--writing::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #9b61ff, #b89aff);
}

.action-card:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.action-card:hover {
  transform: translateY(-6px);
  box-shadow: var(--shadow-card-hover);
}

.action-icon {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 14px;
  font-size: 24px;
  color: white;
}

.action-icon.vocab {
  background: linear-gradient(135deg, #5b4af7, #7b61ff);
  box-shadow: 0 6px 16px var(--glow-primary);
}
.action-icon.grammar {
  background: linear-gradient(135deg, #e8447a, #ff6ba3);
  box-shadow: 0 6px 16px var(--glow-sakura);
}
.action-icon.chat {
  background: linear-gradient(135deg, #1db87a, #00cc88);
  box-shadow: 0 6px 16px var(--glow-jade);
}
.action-icon.writing {
  background: linear-gradient(135deg, #9b61ff, #b89aff);
  box-shadow: 0 6px 16px rgba(155, 97, 255, 0.25);
}

.action-title {
  font-family: 'Syne', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
  letter-spacing: -0.01em;
}

.action-desc {
  font-size: 0.78rem;
  color: var(--text-secondary);
  margin-bottom: 12px;
  line-height: 1.4;
}

.action-btn {
  font-family: 'Figtree', sans-serif;
  font-weight: 600;
  text-transform: none;
  font-size: 0.85rem;
}

/* ==========================================
   ACHIEVEMENT TEASER
   ========================================== */
.achievement-teaser {
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-lg);
  padding: 18px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--shadow-card);
}

.achievement-teaser.empty {
  background: var(--glass-bg-subtle);
  border-style: dashed;
}

.teaser-content {
  display: flex;
  align-items: center;
  gap: 14px;
}

.teaser-trophy {
  font-size: 28px;
  filter: drop-shadow(0 2px 8px var(--glow-amber));
}

.teaser-trophy.dim {
  opacity: 0.35;
  filter: none;
}

.teaser-icon {
  font-size: 24px;
  color: var(--color-streak);
}

.teaser-icon.error {
  color: var(--color-error);
}

.teaser-text {
  font-family: 'Figtree', sans-serif;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text-primary);
}

.teaser-sub {
  font-size: 0.78rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.achievement-teaser.empty .teaser-text {
  color: var(--text-secondary);
}

/* ==========================================
   ANIMATIONS (local)
   ========================================== */
@keyframes float-gentle {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-5px) rotate(1deg);
  }
}

/* ==========================================
   RESPONSIVE
   ========================================== */
@media (max-width: 600px) {
  .dashboard-page {
    padding: 16px;
  }
  .daily-goal-hero {
    padding: 28px 20px 24px;
  }
  .hero-greeting {
    font-size: 1.5rem;
  }
  .hero-kanji-1 {
    font-size: 80px;
  }
  .hero-kanji-2 {
    display: none;
  }
  .stats-row {
    gap: 8px;
  }
  .stat-badge {
    min-width: 110px;
    padding: 10px 12px;
  }
  .stat-value {
    font-size: 1.1rem;
  }
  .actions-grid {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .action-card {
    padding: 18px 14px 14px;
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
