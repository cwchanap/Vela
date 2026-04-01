import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from 'vue';
import { VueQueryPlugin } from '@tanstack/vue-query';

describe('boot/query', () => {
  describe('module exports', () => {
    it('should export queryClient instance', async () => {
      const { queryClient } = await import('./query');
      expect(queryClient).toBeDefined();
      expect(queryClient).toHaveProperty('mount');
      expect(queryClient).toHaveProperty('unmount');
    });

    it('should re-export QUERY_STALE_TIME constant', async () => {
      const { QUERY_STALE_TIME } = await import('./query');
      expect(QUERY_STALE_TIME).toBe(5 * 60 * 1000);
    });

    it('should re-export QUERY_GC_TIME constant', async () => {
      const { QUERY_GC_TIME } = await import('./query');
      expect(QUERY_GC_TIME).toBe(10 * 60 * 1000);
    });
  });

  describe('boot function', () => {
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      app = createApp({
        template: '<div>Test</div>',
      });
      vi.spyOn(app, 'use');
    });

    it('should install VueQueryPlugin with queryClient', async () => {
      const { default: queryBoot, queryClient } = await import('./query');
      await queryBoot({ app });

      expect(app.use).toHaveBeenCalledWith(VueQueryPlugin, {
        queryClient,
      });
    });
  });
});
