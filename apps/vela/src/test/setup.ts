// Test setup file for Vitest
// Mock browser APIs that are not implemented in jsdom
import { vi } from 'vitest';

// Mock localStorage with a working implementation.
// Quasar's @quasar/vite-plugin passes --localstorage-file to jsdom without a
// valid path, which produces a broken localStorage object whose getItem/setItem
// are not functions. Override it here before any store is initialised.
const makeStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
};

Object.defineProperty(window, 'localStorage', {
  value: makeStorageMock(),
  writable: true,
});

Object.defineProperty(window, 'sessionStorage', {
  value: makeStorageMock(),
  writable: true,
});

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
