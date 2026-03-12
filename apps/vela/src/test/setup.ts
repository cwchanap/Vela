// Test setup file for Vitest
// Mock browser APIs that are not implemented in jsdom
import { vi } from 'vitest';

// Mock localStorage with a working implementation.
// Quasar's @quasar/vite-plugin passes --localstorage-file to jsdom without a
// valid path, which produces a broken localStorage object whose getItem/setItem
// are not functions. Override it here before any store is initialised.
const storageData = new WeakMap<Storage, Record<string, string>>();

const getStorageData = (storage: Storage) => {
  const existingData = storageData.get(storage);

  if (existingData) {
    return existingData;
  }

  const nextData: Record<string, string> = {};
  storageData.set(storage, nextData);
  return nextData;
};

Object.defineProperties(Storage.prototype, {
  getItem: {
    configurable: true,
    value(key: string) {
      return getStorageData(this as Storage)[key] ?? null;
    },
  },
  setItem: {
    configurable: true,
    writable: true,
    value(key: string, value: string) {
      getStorageData(this as Storage)[key] = String(value);
    },
  },
  removeItem: {
    configurable: true,
    writable: true,
    value(key: string) {
      delete getStorageData(this as Storage)[key];
    },
  },
  clear: {
    configurable: true,
    writable: true,
    value() {
      storageData.set(this as Storage, {});
    },
  },
  length: {
    configurable: true,
    get() {
      return Object.keys(getStorageData(this as Storage)).length;
    },
  },
  key: {
    configurable: true,
    writable: true,
    value(index: number) {
      return Object.keys(getStorageData(this as Storage))[index] ?? null;
    },
  },
});

const makeStorageMock = () => {
  const storage = Object.create(Storage.prototype) as Storage;
  storageData.set(storage, {});
  return storage;
};

Object.defineProperty(window, 'localStorage', {
  value: makeStorageMock(),
  writable: true,
  configurable: true,
});

Object.defineProperty(window, 'sessionStorage', {
  value: makeStorageMock(),
  writable: true,
  configurable: true,
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
