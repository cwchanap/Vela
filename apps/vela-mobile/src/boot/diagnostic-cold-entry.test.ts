import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import {
  consumeDiagnosticColdEntry,
  DIAGNOSTIC_COLD_ENTRY_KEY,
  stageDiagnosticColdEntry,
} from './diagnostic-cold-entry';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('diagnostic cold entry', () => {
  it('deletes then replaces an allowed target before router installation', async () => {
    const storage = memoryStorage();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/diagnostics/ios-interactions/detail', component: {} },
      ],
    });
    stageDiagnosticColdEntry(storage, '/diagnostics/ios-interactions/detail');
    await consumeDiagnosticColdEntry(router, storage);
    expect(storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY)).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe('/diagnostics/ios-interactions/detail');
    expect(router.options.history.state.mobileDepth).toBe(0);
  });

  it('deletes invalid values without navigation', async () => {
    const storage = memoryStorage();
    storage.setItem(DIAGNOSTIC_COLD_ENTRY_KEY, '/words');
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/words', component: {} },
      ],
    });
    await consumeDiagnosticColdEntry(router, storage);
    expect(storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY)).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('deletes the key before a failed navigation and cannot replay it', async () => {
    const storage = memoryStorage();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/diagnostics/ios-interactions/detail', component: {} },
      ],
    });
    stageDiagnosticColdEntry(storage, '/diagnostics/ios-interactions/detail');
    let keyWasDeletedBeforeNavigation = false;
    router.beforeEach(() => {
      keyWasDeletedBeforeNavigation = storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY) === null;
      throw new Error('navigation failed');
    });

    await expect(consumeDiagnosticColdEntry(router, storage)).rejects.toThrow('navigation failed');
    expect(keyWasDeletedBeforeNavigation).toBe(true);
    expect(storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY)).toBeNull();
    await expect(consumeDiagnosticColdEntry(router, storage)).resolves.toBeNull();
  });
});
