import { describe, expect, it } from 'vitest';
import {
  mobileLifecycleState,
  recordAppResume,
  resetMobileLifecycleForTests,
} from './mobile-lifecycle';

describe('mobile lifecycle', () => {
  it('records resume without a router dependency', () => {
    resetMobileLifecycleForTests();
    recordAppResume(1234);
    expect(mobileLifecycleState.resumeCount.value).toBe(1);
    expect(mobileLifecycleState.lastResumeAt.value).toBe(1234);
  });
});
