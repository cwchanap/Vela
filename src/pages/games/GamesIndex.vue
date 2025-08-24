<template>
  <q-page class="q-pa-md">
    <div class="text-h4 q-mb-lg">Games</div>
    <div class="text-subtitle1 q-mb-md">Choose a game to practice your Japanese skills!</div>

    <div class="row q-gutter-md">
      <div class="col-12 col-md-6">
        <q-card class="game-card cursor-pointer" @click="navigateToGame('vocabulary')">
          <q-card-section class="text-center">
            <q-icon name="fas fa-book" size="3rem" color="primary" class="q-mb-md" />
            <div class="text-h6">Vocabulary Game</div>
            <div class="text-body2 text-grey-7 q-mt-sm">
              Test your knowledge of Japanese vocabulary with multiple-choice questions
            </div>
          </q-card-section>
          <q-card-actions align="center">
            <q-btn flat color="primary" label="Play Now" />
          </q-card-actions>
        </q-card>
      </div>

      <!-- Placeholder for future games -->
      <!--
      <div class="col-12 col-md-6">
        <q-card class="game-card cursor-pointer" @click="navigateToGame('sentence')">
          <q-card-section class="text-center">
            <q-icon name="fas fa-puzzle-piece" size="3rem" color="secondary" class="q-mb-md" />
            <div class="text-h6">Sentence Game</div>
            <div class="text-body2 text-grey-7 q-mt-sm">
              Build sentences by arranging words in the correct order
            </div>
          </q-card-section>
          <q-card-actions align="center">
            <q-btn flat color="secondary" label="Play Now" />
          </q-card-actions>
        </q-card>
      </div>
      -->
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function navigateToGame(gameType: string) {
  void router.push(`/games/${gameType}`);
}
</script>

<style scoped>
.game-card {
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  height: 200px;
}

.game-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
</style>
