<template>
  <!-- role="status" would announce every 1s countdown tick, so the countdown
       uses role="timer" (not a live region) and state transitions announce
       once via this hidden status region. The region stays mounted — a live
       region inserted already holding text is not reliably announced — and
       its text is only written after mount. -->
  <span class="chat-cache-reminder__announce" role="status">{{ announced }}</span>
  <div
    v-if="reminder.state !== 'hidden'"
    class="chat-cache-reminder"
    :data-state="reminder.state"
    data-testid="chat-cache-reminder"
  >
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

// The page's single 1-second tick lives here and runs only while the chip is visible.
const now = ref(Date.now());
const isMounted = ref(false);
let interval: ReturnType<typeof setInterval> | null = null;

const reminder = computed(() => cacheReminder(props.provider, props.cacheStartedAt, now.value));

const stopTimer = () => {
  if (interval !== null) {
    clearInterval(interval);
    interval = null;
  }
};

const syncTimer = () => {
  if (!isMounted.value || reminder.value.state === 'hidden') {
    stopTimer();
    return;
  }
  if (interval === null) {
    interval = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  }
};

// Fresh or restored evidence must render immediately, not wait for the next tick.
watch(
  () => [props.provider, props.cacheStartedAt] as const,
  () => {
    now.value = Date.now();
  },
);

watch(
  () => reminder.value.state === 'hidden',
  () => {
    syncTimer();
  },
);

onMounted(() => {
  isMounted.value = true;
  syncTimer();
});

onUnmounted(() => {
  isMounted.value = false;
  stopTimer();
});

const STATE_ANNOUNCEMENTS: Record<Exclude<CacheReminderState, 'hidden'>, string> = {
  warm: 'Prompt cache likely warm',
  warning: 'Cache window nearly elapsed',
  elapsed: 'Cache window elapsed · next message may miss cache',
};

const announcement = computed(() =>
  reminder.value.state === 'hidden' ? '' : STATE_ANNOUNCEMENTS[reminder.value.state],
);

// Screen readers announce text changes to an existing live region, not a
// region inserted already holding text: render the region empty and only
// start mirroring the state copy after mount, so a reminder that is already
// visible when the component mounts (e.g. a remount with warm cache) is
// still announced.
const announced = ref('');
onMounted(() => {
  watch(
    announcement,
    (text) => {
      announced.value = text;
    },
    { immediate: true },
  );
});
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
