import { describe, expect, it } from 'vitest';
import {
  mobileLifecycleState,
  recordAppStateChange,
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

  it('records app-state transitions without incrementing resume count', () => {
    resetMobileLifecycleForTests();
    recordAppStateChange(false, 100);
    expect(mobileLifecycleState.isActive.value).toBe(false);
    expect(mobileLifecycleState.lastStateChangeAt.value).toBe(100);
    expect(mobileLifecycleState.lastBecameInactiveAt.value).toBe(100);
    expect(mobileLifecycleState.resumeCount.value).toBe(0);

    recordAppStateChange(true, 200);
    expect(mobileLifecycleState.lastStateChangeAt.value).toBe(200);
    expect(mobileLifecycleState.lastBecameActiveAt.value).toBe(200);
    expect(mobileLifecycleState.resumeCount.value).toBe(0);
  });

  it('only updates became-timestamps on an actual transition', () => {
    resetMobileLifecycleForTests();
    // reset leaves isActive=true; transition to inactive first.
    recordAppStateChange(false, 100);
    expect(mobileLifecycleState.lastBecameInactiveAt.value).toBe(100);
    expect(mobileLifecycleState.lastBecameActiveAt.value).toBe(null);

    recordAppStateChange(true, 200);
    expect(mobileLifecycleState.lastBecameActiveAt.value).toBe(200);

    // Repeated active notification: not a transition, became-timestamp unchanged.
    recordAppStateChange(true, 300);
    expect(mobileLifecycleState.isActive.value).toBe(true);
    expect(mobileLifecycleState.lastStateChangeAt.value).toBe(300);
    expect(mobileLifecycleState.lastBecameActiveAt.value).toBe(200);
    expect(mobileLifecycleState.lastBecameInactiveAt.value).toBe(100);

    // Transition back to inactive, then a repeated inactive notification.
    recordAppStateChange(false, 400);
    expect(mobileLifecycleState.lastBecameInactiveAt.value).toBe(400);

    recordAppStateChange(false, 500);
    expect(mobileLifecycleState.lastStateChangeAt.value).toBe(500);
    expect(mobileLifecycleState.lastBecameInactiveAt.value).toBe(400);
    expect(mobileLifecycleState.lastBecameActiveAt.value).toBe(200);
  });
});
