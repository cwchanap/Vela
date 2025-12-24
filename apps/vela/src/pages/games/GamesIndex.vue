<template>
  <q-page class="games-page">
    <div class="games-container">
      <div class="page-header">
        <h1 class="page-title">Learn</h1>
        <p class="page-subtitle">Choose an activity to practice your Japanese skills</p>
      </div>

      <div class="games-grid">
        <div class="game-card" @click="navigateToGame('vocabulary')">
          <div class="game-icon vocab">
            <q-icon name="quiz" />
          </div>
          <div class="game-info">
            <h3 class="game-title">Vocabulary Game</h3>
            <p class="game-desc">Test your knowledge with multiple-choice questions</p>
          </div>
          <q-btn unelevated rounded color="primary" class="game-btn">
            <q-icon name="play_arrow" size="sm" class="q-mr-xs" />
            Play
          </q-btn>
        </div>

        <div class="game-card" @click="navigateToGame('sentence')">
          <div class="game-icon grammar">
            <q-icon name="reorder" />
          </div>
          <div class="game-info">
            <h3 class="game-title">Sentence Builder</h3>
            <p class="game-desc">Build sentences by arranging words correctly</p>
          </div>
          <q-btn unelevated rounded color="warning" class="game-btn">
            <q-icon name="play_arrow" size="sm" class="q-mr-xs" />
            Play
          </q-btn>
        </div>

        <div class="game-card coming-soon" aria-disabled="true">
          <div class="game-icon listening">
            <q-icon name="headphones" />
          </div>
          <div class="game-info">
            <h3 class="game-title">Listening Practice</h3>
            <p class="game-desc">Improve your listening comprehension</p>
          </div>
          <q-chip color="grey-6" text-color="white" size="sm"> Coming Soon </q-chip>
        </div>

        <div class="game-card coming-soon" aria-disabled="true">
          <div class="game-icon writing">
            <q-icon name="draw" />
          </div>
          <div class="game-info">
            <h3 class="game-title">Writing Practice</h3>
            <p class="game-desc">Practice writing hiragana and katakana</p>
          </div>
          <q-chip color="grey-6" text-color="white" size="sm"> Coming Soon </q-chip>
        </div>
      </div>

      <!-- Daily Challenge Section -->
      <div class="challenge-section">
        <div class="challenge-card">
          <div class="challenge-content">
            <q-icon name="emoji_events" class="challenge-icon" />
            <div class="challenge-info">
              <h3 class="challenge-title">Daily Challenge</h3>
              <p class="challenge-desc">Complete 3 games today to earn bonus XP!</p>
            </div>
          </div>
          <div class="challenge-progress">
            <q-linear-progress
              :value="challengeProgress"
              color="warning"
              track-color="grey-4"
              rounded
              size="8px"
              class="q-mb-sm"
            />
            <span class="progress-text">{{ challengeText }}</span>
          </div>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

// Replace with real data source (store/API) when available
const gamesCompletedToday = ref(0);
const dailyChallengeGoal = ref(3);

const challengeProgress = computed(() => {
  const goal = dailyChallengeGoal.value || 0;
  if (goal <= 0) return 0;
  const ratio = gamesCompletedToday.value / goal;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(ratio, 1);
});

const challengeText = computed(
  () => `${gamesCompletedToday.value}/${dailyChallengeGoal.value} completed`,
);

function navigateToGame(gameType: string) {
  void router.push(`/games/${gameType}`);
}
</script>

<style scoped>
.games-page {
  min-height: 100vh;
  padding: 24px;
  background: var(--bg-page);
}

.games-container {
  max-width: 900px;
  margin: 0 auto;
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

/* Games Grid */
.games-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  margin-bottom: 32px;
}

.game-card {
  background: var(--bg-card);
  border-radius: var(--border-radius-xl);
  padding: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: pointer;
  box-shadow: var(--shadow-card);
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.game-card:hover {
  transform: translateY(-6px);
  box-shadow: var(--shadow-card-hover);
}

.game-card.coming-soon {
  opacity: 0.7;
  cursor: not-allowed;
  pointer-events: none;
}

.game-card.coming-soon:hover {
  transform: none;
  box-shadow: var(--shadow-card);
}

.game-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: white;
  margin-bottom: 16px;
}

.game-icon.vocab {
  background: var(--color-vocab);
}

.game-icon.grammar {
  background: var(--color-grammar);
}

.game-icon.listening {
  background: var(--color-chat);
}

.game-icon.writing {
  background: var(--color-writing);
}

.game-info {
  flex: 1;
  margin-bottom: 16px;
}

.game-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.game-desc {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
}

.game-btn {
  padding: 10px 24px;
  font-weight: 600;
}

/* Challenge Section */
.challenge-section {
  margin-top: 16px;
}

.challenge-card {
  background: var(--bg-card);
  border-radius: var(--border-radius-lg);
  padding: 20px 24px;
  box-shadow: var(--shadow-card);
}

.challenge-content {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.challenge-icon {
  font-size: 36px;
  color: var(--color-streak);
}

.challenge-info {
  flex: 1;
}

.challenge-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px 0;
}

.challenge-desc {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0;
}

.progress-text {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

/* Responsive */
@media (max-width: 700px) {
  .games-page {
    padding: 16px;
  }

  .games-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .game-card {
    padding: 24px 20px;
  }

  .game-icon {
    width: 64px;
    height: 64px;
    font-size: 28px;
  }
}
</style>
