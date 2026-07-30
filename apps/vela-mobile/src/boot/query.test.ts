import { VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';
import queryBoot, { mobileQueryClient } from './query';

describe('mobile query boot', () => {
  it('installs the exported singleton into Vue Query', () => {
    const app = { use: vi.fn() };

    queryBoot({ app } as never);

    expect(app.use).toHaveBeenCalledWith(VueQueryPlugin, {
      queryClient: mobileQueryClient,
    });
  });
});
