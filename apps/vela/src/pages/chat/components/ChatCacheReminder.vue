<template>
  <div
    v-if="reminder.state !== 'hidden'"
    class="chat-cache-reminder"
    :data-state="reminder.state"
    role="status"
    data-testid="chat-cache-reminder"
  >
    {{ reminder.label }}
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { LlmProvider } from '@vela/common';
import { cacheReminder } from '../utils/cacheReminder';

const props = defineProps<{
  provider: LlmProvider | null;
  cacheStartedAt: number | null;
}>();

// The page's single 1-second tick lives here; nothing else polls.
const now = ref(Date.now());
let interval: ReturnType<typeof setInterval> | null = null;

// Fresh or restored evidence must render immediately, not wait for the next tick.
watch(
  () => props.cacheStartedAt,
  () => {
    now.value = Date.now();
  },
);

onMounted(() => {
  interval = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (interval !== null) {
    clearInterval(interval);
    interval = null;
  }
});

const reminder = computed(() => cacheReminder(props.provider, props.cacheStartedAt, now.value));
</script>

<style scoped lang="scss">
.chat-cache-reminder {
  flex-shrink: 0;
  padding: 0 4px 4px;
  font-size: 0.8rem;
  color: var(--text-secondary);

  &[data-state='warning'],
  &[data-state='elapsed'] {
    color: var(--q-warning, #f2c037);
  }
}
</style>
