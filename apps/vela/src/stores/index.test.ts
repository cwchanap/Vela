import { describe, it, expect } from 'vitest';
import createStoreIndex, {
  useAuthStore,
  useGameStore,
  useChatStore,
  useProgressStore,
  useLLMSettingsStore,
} from './index';

describe('stores/index', () => {
  describe('default export', () => {
    it('should return a Pinia instance', () => {
      const pinia = createStoreIndex();

      expect(pinia).toBeDefined();
      expect(typeof pinia).toBe('object');
      expect(pinia).toHaveProperty('install');
      expect(typeof pinia.install).toBe('function');
    });

    it('should return a new Pinia instance each time', () => {
      const pinia1 = createStoreIndex();
      const pinia2 = createStoreIndex();

      expect(pinia1).not.toBe(pinia2);
    });
  });

  describe('re-exports', () => {
    it.each([
      ['useAuthStore', useAuthStore],
      ['useGameStore', useGameStore],
      ['useChatStore', useChatStore],
      ['useProgressStore', useProgressStore],
      ['useLLMSettingsStore', useLLMSettingsStore],
    ])('should export %s as a function', (_name, exportedStore) => {
      expect(exportedStore).toBeDefined();
      expect(typeof exportedStore).toBe('function');
    });
  });
});
