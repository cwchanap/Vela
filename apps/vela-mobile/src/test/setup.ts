import { afterEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

enableAutoUnmount(afterEach);

// These mocks are only meaningful in the jsdom environment (src/ tests).
// Script tests under `scripts/**` use `@vitest-environment node`, where these
// browser globals do not exist — guard so the setup file is a no-op there.
if (global.window) {
  global.window.scrollTo = vi.fn();
}

if (typeof global.IntersectionObserver === 'undefined') {
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
}

if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    constructor(_callback?: any) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}
