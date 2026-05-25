import { describe, it, expect } from 'vitest';
import { QUERY_STALE_TIME, QUERY_GC_TIME, createQueryClient } from './config';

describe('config', () => {
  describe('constants', () => {
    it('QUERY_STALE_TIME is 5 minutes', () => {
      expect(QUERY_STALE_TIME).toBe(5 * 60 * 1000);
    });

    it('QUERY_GC_TIME is 10 minutes', () => {
      expect(QUERY_GC_TIME).toBe(10 * 60 * 1000);
    });
  });

  describe('createQueryClient', () => {
    const client = createQueryClient();

    it('sets staleTime to QUERY_STALE_TIME', () => {
      expect(client.getDefaultOptions().queries?.staleTime).toBe(QUERY_STALE_TIME);
    });

    it('sets gcTime to QUERY_GC_TIME', () => {
      expect(client.getDefaultOptions().queries?.gcTime).toBe(QUERY_GC_TIME);
    });

    it('sets query retry to 2', () => {
      expect(client.getDefaultOptions().queries?.retry).toBe(2);
    });

    it('sets mutation retry to 1', () => {
      expect(client.getDefaultOptions().mutations?.retry).toBe(1);
    });

    it('enables refetchOnWindowFocus', () => {
      expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    });

    it('disables refetchOnReconnect', () => {
      expect(client.getDefaultOptions().queries?.refetchOnReconnect).toBe(false);
    });

    it('enables refetchOnMount', () => {
      expect(client.getDefaultOptions().queries?.refetchOnMount).toBe(true);
    });
  });
});
