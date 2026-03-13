<template>
  <ruby v-if="reading && hasKanji"
    >{{ text }}<rt>{{ reading }}</rt></ruby
  >
  <span v-else>{{ text }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { isKanji } from 'src/utils/japanese';

const props = defineProps<{
  text: string;
  reading?: string | undefined;
}>();

const hasKanji = computed(() => Array.from(props.text).some(isKanji));
</script>
