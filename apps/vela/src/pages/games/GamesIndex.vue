<template>
  <q-page class="games-page">
    <!-- Ambient background -->
    <div class="ambient-layer" aria-hidden="true">
      <div class="ambient-blob blob-primary"></div>
      <div class="ambient-blob blob-sakura"></div>
    </div>

    <div class="games-container">
      <div class="page-header anim-enter-1">
        <div class="page-header-inner">
          <h1 class="page-title">Learn</h1>
          <span class="page-title-kana">学ぶ</span>
        </div>
        <p class="page-subtitle">Choose an activity to practice your Japanese skills</p>
      </div>

      <div class="games-grid anim-enter-2">
        <!-- Vocabulary -->
        <div
          class="game-card game-card--vocab"
          role="button"
          tabindex="0"
          @click="navigateToGame('vocabulary')"
          @keydown="handleGameCardKeydown('vocabulary', $event)"
        >
          <div class="game-card-bg" aria-hidden="true"></div>
          <div class="game-icon vocab">
            <q-icon name="quiz" />
          </div>
          <div class="game-info">
            <h3 class="game-title">Vocabulary</h3>
            <p class="game-desc">Test your knowledge with multiple-choice questions</p>
          </div>
          <q-btn unelevated rounded color="primary" class="game-btn">
            <q-icon name="play_arrow" size="sm" class="q-mr-xs" />
            Play
          </q-btn>
        </div>

        <!-- Sentence Builder -->
        <div
          class="game-card game-card--sentence"
          role="button"
          tabindex="0"
          @click="navigateToGame('sentence')"
          @keydown="handleGameCardKeydown('sentence', $event)"
        >
          <div class="game-card-bg" aria-hidden="true"></div>
          <div class="game-icon grammar">
            <q-icon name="reorder" />
          </div>
          <div class="game-info">
            <h3 class="game-title">Sentences</h3>
            <p class="game-desc">Build sentences by arranging words correctly</p>
          </div>
          <q-btn unelevated rounded color="secondary" class="game-btn">
            <q-icon name="play_arrow" size="sm" class="q-mr-xs" />
            Play
          </q-btn>
        </div>

        <!-- Listening — Coming Soon -->
        <div class="game-card game-card--listening coming-soon" aria-disabled="true">
          <div class="game-card-bg" aria-hidden="true"></div>
          <div class="coming-soon-badge">Soon</div>
          <div class="game-icon listening">
            <q-icon name="headphones" />
          </div>
          <div class="game-info">
            <h3 class="game-title">Listening</h3>
            <p class="game-desc">Improve your listening comprehension</p>
          </div>
        </div>

        <!-- Writing — Coming Soon -->
        <div class="game-card game-card--writing coming-soon" aria-disabled="true">
          <div class="game-card-bg" aria-hidden="true"></div>
          <div class="coming-soon-badge">Soon</div>
          <div class="game-icon writing">
            <q-icon name="draw" />
          </div>
          <div class="game-info">
            <h3 class="game-title">Writing</h3>
            <p class="game-desc">Practice writing hiragana and katakana</p>
          </div>
        </div>
      </div>

      <!-- Daily Challenge Section -->
      <div class="challenge-section anim-enter-3">
        <div class="challenge-card">
          <div class="challenge-left">
            <span class="challenge-emoji">🎯</span>
            <div class="challenge-info">
              <h3 class="challenge-title">Daily Challenge</h3>
              <p class="challenge-desc">Complete 3 games today to earn bonus XP!</p>
            </div>
          </div>
          <div class="challenge-progress">
            <div
              class="challenge-progress-track"
              role="progressbar"
              :aria-valuenow="gamesCompletedToday"
              :aria-valuemin="0"
              :aria-valuemax="dailyChallengeGoal"
              :aria-label="challengeText"
            >
              <div
                class="challenge-progress-fill"
                :style="{ width: `${challengeProgress * 100}%` }"
                aria-hidden="true"
              ></div>
            </div>
            <span class="progress-text" aria-hidden="true">{{ challengeText }}</span>
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
  () => `${gamesCompletedToday.value} / ${dailyChallengeGoal.value} completed`,
);

function navigateToGame(gameType: string) {
  void router.push(`/games/${gameType}`);
}

const handleGameCardKeydown = (gameType: string, event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    navigateToGame(gameType);
  }
};
</script>

<style scoped>
.games-page {
  min-height: 100vh;
  padding: 28px 24px;
  background: var(--bg-page);
  position: relative;
  overflow: hidden;
}

.games-container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* ==========================================
   HEADER
   ========================================== */
.page-header {
  margin-bottom: 32px;
}

.page-header-inner {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 8px;
}

.page-title {
  font-family: 'Syne', sans-serif;
  font-size: 2.4rem;
  font-weight: 800;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.04em;
}

.page-title-kana {
  font-family: 'Noto Serif JP', serif;
  font-size: 1.1rem;
  color: var(--color-primary);
  opacity: 0.5;
  font-weight: 300;
}

.page-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
  font-weight: 400;
}

/* ==========================================
   GAMES GRID
   ========================================== */
.games-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18px;
  margin-bottom: 28px;
}

.game-card {
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-xl);
  padding: 30px 24px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: pointer;
  box-shadow: var(--shadow-card);
  position: relative;
  overflow: hidden;
}

/* Per-card colored top border */
.game-card--vocab::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #5b4af7, #7b61ff, #9b61ff);
}
.game-card--sentence::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #e8447a, #ff6ba3);
}
.game-card--listening::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #1db87a, #00cc88);
}
.game-card--writing::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #9b61ff, #b89aff);
}

.game-card:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.game-card:not(.coming-soon):hover {
  transform: translateY(-8px);
  box-shadow: var(--shadow-card-hover);
}

.game-card.coming-soon {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
  filter: grayscale(0.3);
}

/* Subtle ambient glow behind card content */
.game-card-bg {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
  border-radius: var(--border-radius-xl);
}

.game-card--vocab:hover .game-card-bg {
  opacity: 1;
  background: radial-gradient(ellipse at top, rgba(91, 74, 247, 0.05) 0%, transparent 70%);
}
.game-card--sentence:hover .game-card-bg {
  opacity: 1;
  background: radial-gradient(ellipse at top, rgba(232, 68, 122, 0.05) 0%, transparent 70%);
}

/* Coming soon badge */
.coming-soon-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  background: var(--bg-surface, #f0edf8);
  color: var(--text-secondary);
  font-family: 'Syne', sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid var(--glass-border);
}

.game-icon {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  color: white;
  margin-bottom: 18px;
  position: relative;
  z-index: 1;
}

.game-icon.vocab {
  background: linear-gradient(135deg, #5b4af7, #7b61ff);
  box-shadow: 0 8px 20px var(--glow-primary);
}
.game-icon.grammar {
  background: linear-gradient(135deg, #e8447a, #ff6ba3);
  box-shadow: 0 8px 20px var(--glow-sakura);
}
.game-icon.listening {
  background: linear-gradient(135deg, #1db87a, #00cc88);
  box-shadow: 0 8px 20px var(--glow-jade);
}
.game-icon.writing {
  background: linear-gradient(135deg, #9b61ff, #b89aff);
  box-shadow: 0 8px 20px rgba(155, 97, 255, 0.25);
}

.game-info {
  flex: 1;
  margin-bottom: 18px;
  position: relative;
  z-index: 1;
}

.game-title {
  font-family: 'Syne', sans-serif;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
  letter-spacing: -0.02em;
}

.game-desc {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.game-btn {
  padding: 10px 28px;
  font-family: 'Syne', sans-serif;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0.01em;
  position: relative;
  z-index: 1;
}

/* ==========================================
   CHALLENGE SECTION
   ========================================== */
.challenge-section {
  margin-top: 8px;
}

.challenge-card {
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-lg);
  padding: 22px 24px;
  box-shadow: var(--shadow-card);
  display: flex;
  align-items: center;
  gap: 24px;
}

.challenge-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.challenge-emoji {
  font-size: 32px;
  filter: drop-shadow(0 2px 8px var(--glow-amber));
  flex-shrink: 0;
}

.challenge-info {
  flex: 1;
}

.challenge-title {
  font-family: 'Syne', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px 0;
  letter-spacing: -0.01em;
}

.challenge-desc {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 0;
}

.challenge-progress {
  min-width: 160px;
}

.challenge-progress-track {
  height: 8px;
  background: var(--glass-border);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 6px;
}

.challenge-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-streak), #ffcc66);
  border-radius: 4px;
  transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 0 8px var(--glow-amber);
}

.progress-text {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-align: right;
  display: block;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ==========================================
   RESPONSIVE
   ========================================== */
@media (max-width: 768px) {
  .games-page {
    padding: 16px;
  }
  .page-title {
    font-size: 1.8rem;
  }
  .games-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .game-card {
    padding: 26px 20px 22px;
  }
  .game-icon {
    width: 64px;
    height: 64px;
    font-size: 26px;
  }
  .challenge-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
  .challenge-progress {
    width: 100%;
  }
}
</style>
