// Test setup file for Vitest
// Mock browser APIs that are not implemented in jsdom
import { vi } from 'vitest';

// Mock window.scrollTo
global.window.scrollTo = vi.fn();

// Mock IntersectionObserver
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

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor(_callback?: any) {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;
