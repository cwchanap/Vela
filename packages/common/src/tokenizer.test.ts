import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTokenize = vi.fn();

vi.mock('kuromoji', () => ({
  default: {
    builder: vi.fn(() => ({
      build: vi.fn((_cb: any) => {
        _cb(null, { tokenize: mockTokenize });
      }),
    })),
  },
}));

// NOTE: The tokenizer uses a module-level singleton. All tests in this describe
// block share the same initialized tokenizer instance. The mock's build() is
// synchronous, so the singleton resolves on first call and is reused thereafter.
// Tests that need a fresh singleton (e.g., error paths) must use vi.resetModules()
// and re-import the module — see the "builder error path" describe block below.
const { tokenize } = await import('./tokenizer');

describe('tokenize', () => {
  beforeEach(() => {
    mockTokenize.mockReset();
  });

  it('maps kuromoji IpadicFeatures fields to Token', async () => {
    mockTokenize.mockReturnValue([
      {
        surface_form: '食べる',
        reading: 'タベル',
        basic_form: '食べる',
        pos: '動詞',
        pos_detail_1: '自立',
      },
    ]);

    const result = await tokenize('食べる');

    expect(result).toEqual([
      {
        surface_form: '食べる',
        reading: 'タベル',
        dictionary_form: '食べる',
        pos: '動詞',
        pos_detail_1: '自立',
      },
    ]);
  });

  it('filters out pure-whitespace tokens', async () => {
    mockTokenize.mockReturnValue([
      {
        surface_form: '私',
        reading: 'ワタシ',
        basic_form: '私',
        pos: '名詞',
        pos_detail_1: '代名詞',
      },
      { surface_form: ' ', reading: ' ', basic_form: ' ', pos: '記号', pos_detail_1: '空白' },
      { surface_form: 'は', reading: 'ハ', basic_form: 'は', pos: '助詞', pos_detail_1: '係助詞' },
    ]);

    const result = await tokenize('私 は');
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.surface_form)).toEqual(['私', 'は']);
  });

  it('falls back to surface_form when reading or basic_form is missing', async () => {
    mockTokenize.mockReturnValue([
      {
        surface_form: '笑',
        reading: undefined,
        basic_form: undefined,
        pos: '名詞',
        pos_detail_1: '一般',
      },
    ]);

    const result = await tokenize('笑');
    expect(result[0]?.reading).toBe('笑');
    expect(result[0]?.dictionary_form).toBe('笑');
  });
});

describe('tokenize — builder error path', () => {
  it('retries tokenizer initialization after a builder failure', async () => {
    vi.resetModules();
    const retryTokenize = vi.fn().mockReturnValue([
      {
        surface_form: 'テスト',
        reading: 'テスト',
        basic_form: 'テスト',
        pos: '名詞',
        pos_detail_1: '一般',
      },
    ]);
    let buildCalls = 0;

    vi.doMock('kuromoji', () => ({
      default: {
        builder: vi.fn(() => ({
          build: vi.fn((_cb: any) => {
            buildCalls += 1;
            if (buildCalls === 1) {
              _cb(new Error('dict not found'), null);
              return;
            }

            _cb(null, { tokenize: retryTokenize });
          }),
        })),
      },
    }));

    const { tokenize: freshTokenize } = await import('./tokenizer');
    await expect(freshTokenize('テスト')).rejects.toThrow('dict not found');
    await expect(freshTokenize('テスト')).resolves.toEqual([
      {
        surface_form: 'テスト',
        reading: 'テスト',
        dictionary_form: 'テスト',
        pos: '名詞',
        pos_detail_1: '一般',
      },
    ]);
    expect(buildCalls).toBe(2);

    vi.resetModules();
  });
});
