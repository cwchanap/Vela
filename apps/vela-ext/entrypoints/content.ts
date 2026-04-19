// Export for unit testing
export function scanJapaneseSentences(): string[] {
  const japaneseRe = /[\u3040-\u9FAF]/;
  const seen = new Set<string>();
  const result: string[] = [];

  if (!document.body) return [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? '').trim();
    if (
      text.length >= 5 &&
      text.length <= 200 &&
      japaneseRe.test(text) &&
      !seen.has(text)
    ) {
      seen.add(text);
      result.push(text);
    }
  }

  return result;
}

function buildOverlay(sentences: string[]): ShadowRoot {
  const host = document.createElement('div');
  host.id = 'vela-ext-overlay-host';
  host.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const checked = new Set<number>(sentences.map((_, i) => i));

  const style = document.createElement('style');
  style.textContent = `
    .vela-overlay {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 16px;
      min-width: 340px;
      max-width: 480px;
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
      pointer-events: all;
      font-family: system-ui, sans-serif;
      color: #1a1a1a;
    }
    .vela-header { font-weight: 600; font-size: 15px; margin-bottom: 12px; }
    .vela-list { overflow-y: auto; flex: 1; margin-bottom: 12px; }
    .vela-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
    .vela-item input { margin-top: 3px; cursor: pointer; }
    .vela-item label { font-size: 14px; line-height: 1.4; cursor: pointer; }
    .vela-footer { display: flex; gap: 8px; justify-content: flex-end; }
    .vela-btn-save { background: #1976d2; color: #fff; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer; font-size: 13px; }
    .vela-btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
    .vela-btn-close { background: #f5f5f5; color: #333; border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 13px; }
    .vela-done { text-align: center; padding: 24px; font-size: 14px; color: #555; }
    .vela-error { text-align: center; padding: 16px; font-size: 14px; color: #b3261e; }
  `;

  const overlay = document.createElement('div');
  overlay.className = 'vela-overlay';

  function renderSuccessState(selectedCount: number) {
    overlay.innerHTML = '';
    const done = document.createElement('div');
    done.className = 'vela-done';
    done.textContent = `Saved ${selectedCount} sentence${selectedCount !== 1 ? 's' : ''}`;
    overlay.appendChild(done);

    setTimeout(() => host.remove(), 2000);
  }

  function renderErrorState() {
    overlay.innerHTML = '';

    const error = document.createElement('div');
    error.className = 'vela-error';
    error.textContent = 'Failed to save selected sentences';

    const footer = document.createElement('div');
    footer.className = 'vela-footer';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'vela-btn-save';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => renderSelectionState());

    const closeBtn = document.createElement('button');
    closeBtn.className = 'vela-btn-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => host.remove());

    footer.appendChild(retryBtn);
    footer.appendChild(closeBtn);
    overlay.appendChild(error);
    overlay.appendChild(footer);
  }

  function renderSelectionState() {
    overlay.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'vela-header';
    header.textContent = `Found ${sentences.length} Japanese sentence${sentences.length !== 1 ? 's' : ''}`;

    const list = document.createElement('div');
    list.className = 'vela-list';

    const footer = document.createElement('div');
    footer.className = 'vela-footer';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'vela-btn-save';
    saveBtn.textContent = `Save selected (${checked.size})`;
    saveBtn.disabled = checked.size === 0;
    saveBtn.addEventListener('click', async () => {
      const selected = sentences.filter((_, i) => checked.has(i));

      try {
        await browser.runtime.sendMessage({
          type: 'SAVE_SENTENCES',
          sentences: selected,
          sourceUrl: window.location.href,
          context: document.title,
        });
        renderSuccessState(selected.length);
      } catch (err: unknown) {
        console.error('[Vela] Failed to send SAVE_SENTENCES:', err);
        renderErrorState();
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'vela-btn-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => host.remove());

    sentences.forEach((sentence, i) => {
      const item = document.createElement('div');
      item.className = 'vela-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `vela-sent-${i}`;
      checkbox.checked = checked.has(i);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          checked.add(i);
        } else {
          checked.delete(i);
        }
        saveBtn.textContent = `Save selected (${checked.size})`;
        saveBtn.disabled = checked.size === 0;
      });

      const label = document.createElement('label');
      label.htmlFor = `vela-sent-${i}`;
      label.textContent = sentence;

      item.appendChild(checkbox);
      item.appendChild(label);
      list.appendChild(item);
    });

    footer.appendChild(saveBtn);
    footer.appendChild(closeBtn);
    overlay.appendChild(header);
    overlay.appendChild(list);
    overlay.appendChild(footer);
  }

  renderSelectionState();

  shadow.appendChild(style);
  shadow.appendChild(overlay);
  return shadow;
}

// Content script entrypoint
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('type' in message) ||
        message.type !== 'SCAN_PAGE'
      )
        return;

      // Remove any existing overlay before creating a new one
      document.getElementById('vela-ext-overlay-host')?.remove();

      const sentences = scanJapaneseSentences();
      if (sentences.length === 0) {
        browser.notifications?.create?.({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela — No sentences found',
          message: 'No Japanese sentences were detected on this page.',
        });
        return;
      }

      buildOverlay(sentences);
    });
  },
});
