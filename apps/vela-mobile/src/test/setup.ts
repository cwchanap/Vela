import { afterEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

enableAutoUnmount(afterEach);

global.window.scrollTo = vi.fn();

global.IntersectionObserver = class IntersectionObserver {
  constructor(_callback?: any, _options?: any) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
} as any;

global.ResizeObserver = class ResizeObserver {
  constructor(_callback?: any) {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;
