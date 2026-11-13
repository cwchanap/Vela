<template>
  <div
    v-if="reminder.state !== 'hidden'"
    class="chat-cache-reminder"
    :data-state="reminder.state"
    data-testid="chat-cache-reminder"
  >
    <!-- role="status" would announce every 1s countdown tick; role="timer" is
         not a live region. State transitions announce once via this hidden
         status region whose text only changes with the state. -->
    <span class="chat-cache-reminder__announce" role="status">{{ announcement }}</span>
    <span role="timer">{{ reminder.label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { LlmProvider } from '@vela/common';
import { cacheReminder, type CacheReminderState } from '../utils/cacheReminder';

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

const STATE_ANNOUNCEMENTS: Record<Exclude<CacheReminderState, 'hidden'>, string> = {
  warm: 'Prompt cache likely warm',
  warning: 'Cache window nearly elapsed',
  elapsed: 'Cache window elapsed · next message may miss cache',
};

const announcement = computed(() =>
  reminder.value.state === 'hidden' ? '' : STATE_ANNOUNCEMENTS[reminder.value.state],
);
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

.chat-cache-reminder__announce {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
