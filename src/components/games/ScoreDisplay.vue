<template>
  <div class="text-h6 q-mt-md">Score: {{ score }}</div>
</template>

<script setup lang="ts">
defineProps<{
  score: number;
}>();
</script>
