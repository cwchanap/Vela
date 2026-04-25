import { describe, it, expect, beforeEach } from 'vitest';

import contentScriptConfig, { scanJapaneseSentences } from '../entrypoints/content';

const contentScript = contentScriptConfig as unknown as { main(): void };

function getRegisteredMessageListener() {
  const addListener = (globalThis as any).browser.runtime.onMessage.addListener;
  const call = addListener.mock.calls.at(-1);
  if (!call) {
    throw new Error('Expected content script to register a message listener');
  }

  return call[0] as (_message: unknown) => void;
}

describe('scanJapaneseSentences', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as any).browser.runtime.onMessage.addListener.mockClear();
    (globalThis as any).browser.runtime.sendMessage.mockReset();
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

  it('collects sentences containing half-width katakana', () => {
    // Half-width katakana U+FF66–FF9F (e.g. ﾊﾝｶｸ)
    document.body.innerHTML = `<p>ﾊﾝｶｸﾀﾞｲﾅﾘで入力されています。</p>`;

    const result = scanJapaneseSentences();
    expect(result).toContain('ﾊﾝｶｸﾀﾞｲﾅﾘで入力されています。');
  });

  it('ignores text inside script, style, and noscript tags', () => {
    document.body.innerHTML = `
      <p>日本語を勉強しています。</p>
      <script>var msg = "これはスクリプトの中のテキストです";</script>
      <style>/* 日本語のスタイルコメント */</style>
      <noscript>ブラウザでJavaScriptを有効にしてください。</noscript>
    `;

    const result = scanJapaneseSentences();
    expect(result).toContain('日本語を勉強しています。');
    expect(result).not.toContain('スクリプトの中のテキストです');
    expect(result).not.toContain('スタイルコメント');
    expect(result).not.toContain('JavaScriptを有効にしてください');
  });

  it('ignores null and primitive runtime messages without throwing', () => {
    contentScript.main();
    const listener = getRegisteredMessageListener();

    expect(() => listener(undefined)).not.toThrow();
    expect(() => listener(null)).not.toThrow();
    expect(() => listener('SCAN_PAGE')).not.toThrow();
    expect(document.getElementById('vela-ext-overlay-host')).toBeNull();
  });

  it('sends NO_JAPANESE_FOUND message to background when no Japanese is detected', () => {
    document.body.innerHTML = '<p>Hello world</p><p>No Japanese here</p>';
    (globalThis as any).browser.runtime.sendMessage.mockReset();
    // sendMessage must return a Promise (the real API does)
    (globalThis as any).browser.runtime.sendMessage.mockResolvedValue(undefined);

    contentScript.main();
    const listener = getRegisteredMessageListener();
    listener({ type: 'SCAN_PAGE' });

    // Should NOT show the overlay
    expect(document.getElementById('vela-ext-overlay-host')).toBeNull();
    // Should send a message to the background script so it can show the notification
    expect((globalThis as any).browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'NO_JAPANESE_FOUND',
    });
  });

  it('shows success only after SAVE_SENTENCES resolves', async () => {
    document.body.innerHTML = '<p>日本語を勉強しています。</p>';
    let resolveMessage: ((_value?: unknown) => void) | undefined;
    (globalThis as any).browser.runtime.sendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveMessage = resolve;
      }),
    );

    contentScript.main();
    const listener = getRegisteredMessageListener();
    listener({ type: 'SCAN_PAGE' });

    const host = document.getElementById('vela-ext-overlay-host');
    const shadowRoot = host?.shadowRoot;
    const saveBtn = shadowRoot?.querySelector('.vela-btn-save') as HTMLButtonElement | null;
    if (!saveBtn || !shadowRoot) {
      throw new Error('Expected save overlay to be rendered');
    }

    saveBtn.click();

    expect(shadowRoot.textContent).toContain('Found 1 Japanese sentence');
    expect(shadowRoot.textContent).not.toContain('Saved 1 sentence');

    resolveMessage?.({ saved: 1, total: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot.textContent).toContain('Saved 1 sentence');
  });

  it('shows partial save info when some sentences are queued', async () => {
    document.body.innerHTML = '<p>日本語を勉強しています。</p><p>東京は大きな都市です。</p>';
    (globalThis as any).browser.runtime.sendMessage.mockResolvedValueOnce({
      saved: 1,
      total: 2,
    });

    contentScript.main();
    const listener = getRegisteredMessageListener();
    listener({ type: 'SCAN_PAGE' });

    const host = document.getElementById('vela-ext-overlay-host');
    const shadowRoot = host?.shadowRoot;
    const saveBtn = shadowRoot?.querySelector('.vela-btn-save') as HTMLButtonElement | null;
    if (!saveBtn || !shadowRoot) {
      throw new Error('Expected save overlay to be rendered');
    }

    saveBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot.textContent).toContain('Saved 1 sentence');
    expect(shadowRoot.textContent).toContain('queued 1 for later sync');
  });

  it('shows an error state when SAVE_SENTENCES rejects', async () => {
    document.body.innerHTML = '<p>日本語を勉強しています。</p>';
    (globalThis as any).browser.runtime.sendMessage.mockRejectedValueOnce(new Error('IPC failed'));

    contentScript.main();
    const listener = getRegisteredMessageListener();
    listener({ type: 'SCAN_PAGE' });

    const host = document.getElementById('vela-ext-overlay-host');
    const shadowRoot = host?.shadowRoot;
    const saveBtn = shadowRoot?.querySelector('.vela-btn-save') as HTMLButtonElement | null;
    if (!saveBtn || !shadowRoot) {
      throw new Error('Expected save overlay to be rendered');
    }

    saveBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot.textContent).toContain('Failed to save selected sentences');
    expect(document.getElementById('vela-ext-overlay-host')).not.toBeNull();
  });
});
