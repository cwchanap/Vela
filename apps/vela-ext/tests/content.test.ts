import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the pure functions we'll export for testing
import { scanJapaneseSentences } from '../entrypoints/content';

describe('scanJapaneseSentences', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('collects Japanese text nodes matching the regex', () => {
    document.body.innerHTML = `
      <p>日本語を勉強しています。</p>
      <p>Hello world</p>
      <p>東京は大きな都市です。</p>
    `;

    const result = scanJapaneseSentences();
    expect(result).toContain('日本語を勉強しています。');
    expect(result).toContain('東京は大きな都市です。');
    expect(result).not.toContain('Hello world');
  });

  it('deduplicates repeated sentences', () => {
    document.body.innerHTML = `
      <p>日本語を勉強しています。</p>
      <p>日本語を勉強しています。</p>
    `;

    const result = scanJapaneseSentences();
    expect(result.filter((s) => s === '日本語を勉強しています。')).toHaveLength(1);
  });

  it('filters out sentences shorter than 5 characters', () => {
    document.body.innerHTML = `<p>あ</p><p>日本語を学んでいます。</p>`;

    const result = scanJapaneseSentences();
    expect(result).not.toContain('あ');
    expect(result).toContain('日本語を学んでいます。');
  });

  it('filters out sentences longer than 200 characters', () => {
    const longText = 'あ'.repeat(201);
    document.body.innerHTML = `<p>${longText}</p><p>正常な長さのテキストです。</p>`;

    const result = scanJapaneseSentences();
    expect(result).not.toContain(longText);
    expect(result).toContain('正常な長さのテキストです。');
  });
});
