// Export for unit testing
export function scanJapaneseSentences(): string[] {
  const japaneseRe = /[\u3040-\u9FAF\uFF66-\uFF9F]/;
  // Split after sentence-ending punctuation so the delimiter stays with the
  // preceding segment (e.g. "A。B。" → ["A。", "B。"]).
  const sentenceSplitRe = /(?<=[。！？!?])/;
  const seen = new Set<string>();
  const result: string[] = [];

  if (!document.body) return [];

  // Inline tags that should NOT break text grouping.  Any element not in
  // this set (or <body>) acts as a block-level boundary.
  const inlineTags = new Set([
    'SPAN',
    'A',
    'B',
    'I',
    'EM',
    'STRONG',
    'SMALL',
    'SUB',
    'SUP',
    'ABBR',
    'MARK',
    'CODE',
    'TIME',
    'U',
    'RUBY',
    'RT',
    'RP',
    'BDI',
    'BDO',
    'CITE',
    'DFN',
    'KBD',
    'SAMP',
    'VAR',
    'WBR',
    'DATA',
    'Q',
    'BR',
    'FONT',
  ]);
  const denylist = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
  // Ruby annotation elements whose text nodes (furigana) must be excluded
  // to avoid corrupting sentences (e.g. <ruby>漢<rt>かん</rt>字 → "漢かん字").
  const rubyAnnotationTags = new Set(['RT', 'RP']);

  // Walk all text nodes, then group them by their nearest block-level
  // ancestor.  This ensures sentences split across inline markup (e.g.
  // 私は<span>日本語</span>を勉強します。) are collected as one continuous
  // string rather than individual fragments.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const blockGroups = new Map<Element, string[]>();
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (!node.parentElement) continue;

    // Skip denylisted elements at any ancestor level
    let ancestor: Element | null = node.parentElement;
    let denied = false;
    while (ancestor && ancestor !== document.body) {
      if (denylist.has(ancestor.tagName)) {
        denied = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (denied) continue;

    // Skip text nodes inside <rt> or <rp> ruby annotations
    let rubyAncestor: Element | null = node.parentElement;
    while (rubyAncestor && rubyAncestor !== document.body && inlineTags.has(rubyAncestor.tagName)) {
      if (rubyAnnotationTags.has(rubyAncestor.tagName)) {
        denied = true;
        break;
      }
      rubyAncestor = rubyAncestor.parentElement;
    }
    if (denied) continue;

    // Find the nearest block-level (non-inline) ancestor
    let blockAncestor = node.parentElement;
    while (blockAncestor !== document.body && inlineTags.has(blockAncestor.tagName)) {
      const parent = blockAncestor.parentElement;
      if (!parent) break;
      blockAncestor = parent;
    }

    const text = (node.textContent ?? '').trim();
    if (!text) continue;

    let group = blockGroups.get(blockAncestor);
    if (!group) {
      group = [];
      blockGroups.set(blockAncestor, group);
    }
    group.push(text);
  }

  for (const [, parts] of blockGroups) {
    const combined = parts.join('');
    if (!japaneseRe.test(combined)) continue;

    const candidates = combined.split(sentenceSplitRe).map((s) => s.trim());

    for (const candidate of candidates) {
      if (candidate.length >= 5 && candidate.length <= 200 && !seen.has(candidate)) {
        seen.add(candidate);
        result.push(candidate);
      }
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

  function renderSuccessState(savedCount: number, total?: number, dropped?: number) {
    overlay.innerHTML = '';
    const done = document.createElement('div');
    done.className = 'vela-done';
    if (dropped && dropped > 0) {
      const queued = (total ?? savedCount + dropped) - savedCount - dropped;
      const parts: string[] = [];
      if (savedCount > 0) {
        parts.push(`Saved ${savedCount} sentence${savedCount !== 1 ? 's' : ''}`);
      }
      if (queued > 0) {
        parts.push(`queued ${queued} for later sync`);
      }
      parts.push(`${dropped} could not be saved (not signed in)`);
      done.textContent = parts.join(', ');
    } else if (total !== undefined && savedCount < total) {
      const queued = total - savedCount;
      done.textContent = `Saved ${savedCount} sentence${savedCount !== 1 ? 's' : ''}, queued ${queued} for later sync`;
    } else {
      done.textContent = `Saved ${savedCount} sentence${savedCount !== 1 ? 's' : ''}`;
    }
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

      // Disable the button immediately to prevent duplicate submissions.
      // Each SAVE_SENTENCES generates fresh idempotency keys, so double-clicks
      // would create duplicate entries.
      saveBtn.disabled = true;

      try {
        const result = await browser.runtime.sendMessage({
          type: 'SAVE_SENTENCES',
          sentences: selected,
          sourceUrl: window.location.href,
          context: document.title,
        });
        if (result && typeof result === 'object' && 'saved' in result) {
          renderSuccessState(
            result.saved as number,
            (result as { saved: number; total: number }).total,
            (result as { dropped?: number }).dropped,
          );
        } else {
          renderSuccessState(selected.length);
        }
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
  matches: ['*://*/*'],
  excludeMatches: [
    'https://vela.cwchanap.dev/*',
    'http://localhost:9000/auth/*',
    'http://127.0.0.1:9000/auth/*',
    'https://*.amazoncognito.com/*',
    'https://*.google.com/*',
  ],
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (typeof message !== 'object' || message === null || !('type' in message)) {
        return;
      }
      if (message.type !== 'SCAN_PAGE') {
        return;
      }

      // Remove any existing overlay before creating a new one
      document.getElementById('vela-ext-overlay-host')?.remove();

      const sentences = scanJapaneseSentences();
      if (sentences.length === 0) {
        // Content scripts can't use browser.notifications — ask the background
        // script to show the "no sentences found" notification.
        browser.runtime.sendMessage({ type: 'NO_JAPANESE_FOUND' }).catch(() => {});
        return;
      }

      buildOverlay(sentences);
    });
  },
});
