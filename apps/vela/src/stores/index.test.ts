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
    it('should export useAuthStore as a function', () => {
      expect(useAuthStore).toBeDefined();
      expect(typeof useAuthStore).toBe('function');
    });

    it('should export useGameStore as a function', () => {
      expect(useGameStore).toBeDefined();
      expect(typeof useGameStore).toBe('function');
    });

    it('should export useChatStore as a function', () => {
      expect(useChatStore).toBeDefined();
      expect(typeof useChatStore).toBe('function');
    });

    it('should export useProgressStore as a function', () => {
      expect(useProgressStore).toBeDefined();
      expect(typeof useProgressStore).toBe('function');
    });

    it('should export useLLMSettingsStore as a function', () => {
      expect(useLLMSettingsStore).toBeDefined();
      expect(typeof useLLMSettingsStore).toBe('function');
    });
  });
});
