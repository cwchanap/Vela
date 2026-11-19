import type { UserConfig } from 'vite';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import quasarConfig from '../../quasar.config';

const commonPath = resolve(__dirname, '../../../../packages/common/src/index.ts');

describe('quasar config', () => {
  it('loads mode env files and their .local overrides with the VITE_ client prefix', () => {
    expect(quasarConfig({ prod: false } as never).build.env?.clientPrefix).toBe('VITE_');
    expect(quasarConfig({ prod: false } as never).build.env?.file).toEqual([
      '.env.development',
      '.env.development.local',
    ]);
    expect(quasarConfig({ prod: true } as never).build.env?.file).toEqual([
      '.env.production',
      '.env.production.local',
    ]);
  });

  it('exposes only allowlisted VITE_* vars to the client bundle', () => {
    const { filter } = quasarConfig({ prod: true } as never).build.env ?? {};
    const defineList = {
      'import.meta.env.VITE_API_URL': '"/api/"',
      'import.meta.env.VITE_UNLISTED_SECRET': '"leak"',
    };
    expect(filter?.(defineList, 'client')).toEqual({
      'import.meta.env.VITE_API_URL': '"/api/"',
    });
    expect(filter?.(defineList, 'backend')).toEqual(defineList);
  });

  it('aliases @vela/common to the workspace source entry (object alias)', () => {
    const config = quasarConfig({ prod: false } as never);
    const viteConf: UserConfig = {};

    config.build.extendViteConf(viteConf);

    expect(viteConf.resolve?.alias).toMatchObject({
      '@vela/common': commonPath,
    });
  });

  it('aliases @vela/common when resolve.alias is an array', () => {
    const config = quasarConfig({ prod: false } as never);
    const viteConf: UserConfig = { resolve: { alias: [] } };

    config.build.extendViteConf(viteConf);

    expect(viteConf.resolve?.alias).toContainEqual({
      find: '@vela/common',
      replacement: commonPath,
    });
  });

  it('replaces existing @vela/common entry when alias is an array', () => {
    const config = quasarConfig({ prod: false } as never);
    const viteConf: UserConfig = {
      resolve: {
        alias: [{ find: '@vela/common', replacement: '/old/path' }],
      },
    };

    config.build.extendViteConf(viteConf);

    const aliases = viteConf.resolve?.alias as Array<{ find: string; replacement: string }>;
    const commonAliases = aliases.filter((a) => a.find === '@vela/common');
    expect(commonAliases).toHaveLength(1);
    expect(commonAliases[0].replacement).toBe(commonPath);
  });
});
