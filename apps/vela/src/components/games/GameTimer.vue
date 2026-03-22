<template>
  <div class="text-h6 q-mb-md">Time: {{ timeLeft }}</div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useGameStore } from 'src/stores/games.ts';

const props = defineProps<{
  /** Override the timeout handler. Defaults to ending the vocabulary game. */
  onTimeout?: (() => void) | undefined;
}>();

const gameStore = useGameStore();
const timeLeft = ref<number>(60);
let timer: NodeJS.Timeout;

onMounted(() => {
  timer = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(timer);
      if (props.onTimeout) {
        props.onTimeout();
      } else {
        gameStore.endGame();
      }
    }
  }, 1000);
});

onUnmounted(() => {
  clearInterval(timer);
});
</script>
