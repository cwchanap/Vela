import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/syntheticAuth';
import { SYNTHETIC_USER_A } from './fixtures/syntheticEnv';
import { waitForPageLoad } from './utils/helpers';

const appDir = fileURLToPath(new URL('..', import.meta.url));
// Vite serves the aliased @vela/common/tokenizer source through /@fs in dev.
const tokenizerSourcePath = fileURLToPath(
  new URL('../../../packages/common/src/tokenizer.ts', import.meta.url),
);

test.describe('Tokenizer - development bundle', () => {
  test('resolves the tokenizer module, renders the dictionary route and tokenizes', async ({
    authedPage: page,
    apiMock,
  }) => {
    const zlibErrors: string[] = [];
    page.on('pageerror', (error) => {
      if (error.message.includes("'Zlib' in undefined")) zlibErrors.push(error.message);
    });

    // The dev server serves the pre-gzipped dictionary with `Content-Encoding:
    // gzip` (also true on v2), so the browser hands kuromoji already-inflated
    // bytes. Fulfil these requests without that header to exercise the real
    // browser dictionary load.
    await page.route('**/kuromoji-dict/*.dat.gz', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: await readFile(join(appDir, 'public', pathname)),
      });
    });

    apiMock.dictionaryEntries = [
      {
        user_id: SYNTHETIC_USER_A.userId,
        sentence_id: 'e2e-tokenizer-1',
        sentence: '猫が好きです。',
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
      },
    ];

    // Navigating here evaluates @vela/common/tokenizer; broken zlibjs/kuromoji
    // CommonJS interop used to reject the route and leave a blank page.
    await page.goto('/my-dictionaries');
    await waitForPageLoad(page);

    await expect(page.getByRole('heading', { name: 'My Dictionaries' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask AI' })).toBeVisible();

    const tokens = await page.evaluate(async (sourcePath) => {
      const module = await import(`/@fs${sourcePath}`);
      module.configureDicPath('/kuromoji-dict');
      return (await module.tokenize('猫が好きです。')).map(
        (token: { surface_form: string; reading: string }) =>
          `${token.surface_form}:${token.reading}`,
      );
    }, tokenizerSourcePath);

    expect(tokens).toEqual(['猫:ネコ', 'が:ガ', '好き:スキ', 'です:デス', '。:。']);
    expect(zlibErrors).toEqual([]);
  });
});
