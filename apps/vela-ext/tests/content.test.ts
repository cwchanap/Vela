import { describe, it, expect, beforeEach } from 'vitest';

import contentScriptConfig, { scanJapaneseSentences } from '../entrypoints/content';

const contentScript = contentScriptConfig as unknown as { main(): void };

function getRegisteredMessageListener() {
  const addListener = (globalThis as any).browser.runtime.onMessage.addListener;
  const call = addListener.mock.calls.at(-1);
  if (!call) {
    throw new Error('Expected content script to register a message listener');
  }

  return call[0] as (message: unknown) => void;
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

  it('ignores null and primitive runtime messages without throwing', () => {
    contentScript.main();
    const listener = getRegisteredMessageListener();

    expect(() => listener(undefined)).not.toThrow();
    expect(() => listener(null)).not.toThrow();
    expect(() => listener('SCAN_PAGE')).not.toThrow();
    expect(document.getElementById('vela-ext-overlay-host')).toBeNull();
  });

  it('shows success only after SAVE_SENTENCES resolves', async () => {
    document.body.innerHTML = '<p>日本語を勉強しています。</p>';
    let resolveMessage: (() => void) | undefined;
    (globalThis as any).browser.runtime.sendMessage.mockReturnValue(
      new Promise<void>((resolve) => {
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

    resolveMessage?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot.textContent).toContain('Saved 1 sentence');
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
