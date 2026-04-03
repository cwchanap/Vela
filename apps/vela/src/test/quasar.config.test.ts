import type { UserConfig } from 'vite';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import quasarConfig from '../../quasar.config';

describe('quasar config', () => {
  it('aliases @vela/common to the workspace source entry', () => {
    const config = quasarConfig(undefined as never);
    const viteConf: UserConfig = {};

    config.build.extendViteConf(viteConf);

    expect(viteConf.resolve?.alias).toMatchObject({
      '@vela/common': resolve(process.cwd(), '../../packages/common/src/index.ts'),
    });
  });
});
