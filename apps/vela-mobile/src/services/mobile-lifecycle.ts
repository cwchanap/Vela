import { readonly, ref } from 'vue';

const resumeCount = ref(0);
const lastResumeAt = ref<number | null>(null);

export const mobileLifecycleState = {
  resumeCount: readonly(resumeCount),
  lastResumeAt: readonly(lastResumeAt),
};

export function recordAppResume(at = Date.now()): void {
  resumeCount.value += 1;
  lastResumeAt.value = at;
}

export function resetMobileLifecycleForTests(): void {
  resumeCount.value = 0;
  lastResumeAt.value = null;
}
