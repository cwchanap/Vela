import { readonly, ref } from 'vue';

const resumeCount = ref(0);
const lastResumeAt = ref<number | null>(null);
const isActive = ref(true);
const lastStateChangeAt = ref<number | null>(null);
const lastBecameActiveAt = ref<number | null>(null);
const lastBecameInactiveAt = ref<number | null>(null);

export const mobileLifecycleState = {
  resumeCount: readonly(resumeCount),
  lastResumeAt: readonly(lastResumeAt),
  isActive: readonly(isActive),
  lastStateChangeAt: readonly(lastStateChangeAt),
  lastBecameActiveAt: readonly(lastBecameActiveAt),
  lastBecameInactiveAt: readonly(lastBecameInactiveAt),
};

export function recordAppResume(at = Date.now()): void {
  resumeCount.value += 1;
  lastResumeAt.value = at;
}

export function recordAppStateChange(next: boolean, at = Date.now()): void {
  isActive.value = next;
  lastStateChangeAt.value = at;
  if (next) lastBecameActiveAt.value = at;
  else lastBecameInactiveAt.value = at;
}

export function resetMobileLifecycleForTests(): void {
  resumeCount.value = 0;
  lastResumeAt.value = null;
  isActive.value = true;
  lastStateChangeAt.value = null;
  lastBecameActiveAt.value = null;
  lastBecameInactiveAt.value = null;
}
