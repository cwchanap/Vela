import { describe, it, expect, beforeEach, vi } from 'vitest';

import contentScriptConfig, { scanJapaneseSentences } from '../entrypoints/content';

const contentScript = contentScriptConfig as unknown as {
  matches: string[];
  excludeMatches?: string[];
  main(): void;
};

function getRegisteredMessageListener() {
  const addListener = (globalThis as any).browser.runtime.onMessage.addListener;
  if (!vi.isMockFunction(addListener)) {
    throw new Error('browser.runtime.onMessage.addListener is not a mock function');
  }
  const call = addListener.mock.calls.at(-1);
  if (!call) {
    throw new Error('Expected content script to register a message listener');
  }

  return call[0] as (
    _message: unknown,
    _sender: unknown,
    _sendResponse: (_response?: unknown) => void,
  ) => void;
}

const noopSendResponse = vi.fn();

beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as any).browser.runtime.onMessage.addListener.mockClear();
  (globalThis as any).browser.runtime.sendMessage.mockReset();
});

describe('content script config', () => {
  it('runs the scanner broadly but excludes Vela and OAuth surfaces without blocking the local fixture', () => {
    expect(contentScript.matches).toEqual(['*://*/*']);
    expect(contentScript.excludeMatches).toEqual(
      expect.arrayContaining([
        'https://vela.cwchanap.dev/*',
        'http://localhost:9000/auth/*',
        'http://127.0.0.1:9000/auth/*',
        'https://*.amazoncognito.com/*',
        'https://accounts.google.com/*',
      ]),
    );
    expect(contentScript.excludeMatches).not.toContain('http://localhost:9000/*');
    expect(contentScript.excludeMatches).not.toContain('http://127.0.0.1:9000/*');
  });
});

describe('scanJapaneseSentences', () => {
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

  it('splits long text nodes at sentence-ending punctuation', () => {
    const sentence1 = '日本語を勉強しています。';
    const sentence2 = '毎日練習しています。';
    // Combined length > 200 but each sentence is < 200
    const padding = 'あ'.repeat(180);
    const longParagraph = `${sentence1}${padding}。${sentence2}`;
    document.body.innerHTML = `<p>${longParagraph}</p>`;

    const result = scanJapaneseSentences();
    // Both sentences should be extracted individually
    expect(result).toContain(sentence1);
    expect(result).toContain(sentence2);
  });

  it('extracts individual sentences from a paragraph with multiple sentences', () => {
    document.body.innerHTML = '<p>今日はいい天気です。散歩に行きました。楽しかったです。</p>';

    const result = scanJapaneseSentences();
    expect(result).toContain('今日はいい天気です。');
    expect(result).toContain('散歩に行きました。');
    expect(result).toContain('楽しかったです。');
  });

  it('splits on exclamation marks and question marks', () => {
    document.body.innerHTML = '<p>これはすごいですね！本当にそうですか？そうですね。</p>';

    const result = scanJapaneseSentences();
    expect(result).toContain('これはすごいですね！');
    expect(result).toContain('本当にそうですか？');
    expect(result).toContain('そうですね。');
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

  it('merges text across inline elements into a single sentence', () => {
    document.body.innerHTML = '<p>私は<span>日本語</span>を勉強します。</p>';

    const result = scanJapaneseSentences();
    expect(result).toContain('私は日本語を勉強します。');
  });

  it('merges text across nested inline elements', () => {
    document.body.innerHTML = '<p>彼は<em><strong>本当に</strong></em>優しい人です。</p>';

    const result = scanJapaneseSentences();
    expect(result).toContain('彼は本当に優しい人です。');
  });

  it('excludes ruby annotation text (rt/rp elements)', () => {
    document.body.innerHTML = '<p><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>を勉強しています。</p>';

    const result = scanJapaneseSentences();
    expect(result).toContain('漢字を勉強しています。');
    expect(result).not.toContain('かん');
    expect(result).not.toContain('じ');
  });

  it('excludes rp fallback text from ruby annotations', () => {
    document.body.innerHTML =
      '<p><ruby>日本語<rp>(</rp><rt>にほんご</rt><rp>)</rp></ruby>を学びます。</p>';

    const result = scanJapaneseSentences();
    expect(result).toContain('日本語を学びます。');
    expect(result).not.toContain('にほんご');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
  });
});

describe('content script message listener', () => {
  it('ignores null and primitive runtime messages without throwing', () => {
    contentScript.main();
    const listener = getRegisteredMessageListener();

    expect(() => listener(undefined, undefined, noopSendResponse)).not.toThrow();
    expect(() => listener(null, undefined, noopSendResponse)).not.toThrow();
    expect(() => listener('SCAN_PAGE', undefined, noopSendResponse)).not.toThrow();
    expect(document.getElementById('vela-ext-overlay-host')).toBeNull();
  });

  it('sends NO_JAPANESE_FOUND message to background when no Japanese is detected', () => {
    document.body.innerHTML = '<p>Hello world</p><p>No Japanese here</p>';
    (globalThis as any).browser.runtime.sendMessage.mockReset();
    // sendMessage must return a Promise (the real API does)
    (globalThis as any).browser.runtime.sendMessage.mockResolvedValue(undefined);

    contentScript.main();
    const listener = getRegisteredMessageListener();
    listener({ type: 'SCAN_PAGE' }, undefined, noopSendResponse);

    // Should NOT show the overlay
    expect(document.getElementById('vela-ext-overlay-host')).toBeNull();
    // Should send a message to the background script so it can show the notification
    expect((globalThis as any).browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'NO_JAPANESE_FOUND',
    });
  });

  it('leaves web-app session import messages to the Vela-only content script', () => {
    contentScript.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'GET_VELA_WEBAPP_SESSION' }, {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(document.getElementById('vela-ext-overlay-host')).toBeNull();
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
    listener({ type: 'SCAN_PAGE' }, undefined, noopSendResponse);

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
    listener({ type: 'SCAN_PAGE' }, undefined, noopSendResponse);

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
    listener({ type: 'SCAN_PAGE' }, undefined, noopSendResponse);

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

  it('disables save button while SAVE_SENTENCES is in flight', async () => {
    document.body.innerHTML = '<p>日本語を勉強しています。</p>';
    let resolveMessage: ((_value?: unknown) => void) | undefined;
    (globalThis as any).browser.runtime.sendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveMessage = resolve;
      }),
    );

    contentScript.main();
    const listener = getRegisteredMessageListener();
    listener({ type: 'SCAN_PAGE' }, undefined, noopSendResponse);

    const host = document.getElementById('vela-ext-overlay-host');
    const shadowRoot = host?.shadowRoot;
    const saveBtn = shadowRoot?.querySelector('.vela-btn-save') as HTMLButtonElement | null;
    if (!saveBtn || !shadowRoot) {
      throw new Error('Expected save overlay to be rendered');
    }

    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    // Button should be disabled while the message is in flight
    expect(saveBtn.disabled).toBe(true);

    // Resolve the message — the overlay transitions to success state
    resolveMessage?.({ saved: 1, total: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot.textContent).toContain('Saved 1 sentence');
  });
});
