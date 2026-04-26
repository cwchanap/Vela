import { getValidIdToken, refreshIdToken } from './utils/storage';
import { openDB, STORE_NAME } from './utils/idb';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://vela.cwchanap.dev/api';

// ── IndexedDB queue ──────────────────────────────────────────────────────────

export interface PendingSentenceRecord {
  id?: number;
  sentence: string;
  sourceUrl?: string;
  context?: string;
  timestamp: number;
  retries: number;
}

/** Pure factory — exported for unit tests. */
export function buildPendingSentenceRecord(
  sentence: string,
  sourceUrl?: string,
  context?: string,
): Omit<PendingSentenceRecord, 'id'> {
  return { sentence, sourceUrl, context, timestamp: Date.now(), retries: 0 };
}

async function notifyPendingQueueChanged(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'PENDING_QUEUE_UPDATED' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (
      !message.includes('Could not establish connection') &&
      !message.includes('Receiving end does not exist')
    ) {
      console.error('[Vela] Failed to notify pending queue changes:', error);
    }
  }
}

async function enqueue(record: Omit<PendingSentenceRecord, 'id'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = () => {
      resolve();
      void notifyPendingQueueChanged();
    };
    req.onerror = () => reject(req.error);
  });
}

async function getAllPending(): Promise<PendingSentenceRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as PendingSentenceRecord[]);
    req.onerror = () => reject(req.error);
  });
}

async function deletePending(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => {
      resolve();
      void notifyPendingQueueChanged();
    };
    req.onerror = () => reject(req.error);
  });
}

async function incrementRetry(record: PendingSentenceRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const updated = { ...record, retries: record.retries + 1 };
    const req = store.put(updated);
    req.onsuccess = () => {
      resolve();
      void notifyPendingQueueChanged();
    };
    req.onerror = () => reject(req.error);
  });
}

// ── API save (offline-aware) ─────────────────────────────────────────────────

export async function saveSentenceToAPI(
  sentence: string,
  sourceUrl?: string,
  context?: string,
): Promise<boolean> {
  let idToken: string;
  try {
    idToken = await getValidIdToken();
  } catch (err) {
    console.error('[Vela] saveSentenceToAPI: auth token failed, queuing:', err);
    await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
    return false;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ sentence, sourceUrl, context }),
    });
  } catch (err) {
    console.error('[Vela] saveSentenceToAPI: fetch failed, queuing:', err);
    await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
    return false;
  }

  if (response.status === 401) {
    try {
      idToken = await refreshIdToken();
    } catch (err) {
      console.error('[Vela] saveSentenceToAPI: token refresh failed, queuing:', err);
      await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
      return false;
    }
    try {
      response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ sentence, sourceUrl, context }),
      });
    } catch (err) {
      console.error('[Vela] saveSentenceToAPI: retry fetch failed, queuing:', err);
      await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
      return false;
    }
  }

  if (!response.ok) {
    await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
    return false;
  }

  return true;
}

// ── Flush queue ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

export function shouldDiscardPendingRecord(
  record: Pick<PendingSentenceRecord, 'retries'>,
): boolean {
  return record.retries + 1 >= MAX_RETRIES;
}

function notifyDiscardedSyncFailure(): void {
  browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title: 'Vela — Sync failed',
    message: '1 saved sentence could not be synced and was discarded.',
  });
}

export async function requestPageScan(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'SCAN_PAGE' });
  } catch (error) {
    console.error('[Vela] Failed to trigger page scan:', error);
    browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: 'Vela - Error',
      message: error instanceof Error ? error.message : 'Failed to scan page',
    });
  }
}

let isFlushing = false;

export async function flushQueue(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const pending = await getAllPending();
    if (pending.length === 0) return;

    for (const record of pending) {
      try {
        let idToken: string;
        try {
          idToken = await getValidIdToken();
        } catch {
          // Still not authenticated — skip this flush cycle
          return;
        }

        let response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            sentence: record.sentence,
            sourceUrl: record.sourceUrl,
            context: record.context,
          }),
        });

        if (response.status === 401) {
          try {
            idToken = await refreshIdToken();
          } catch {
            return;
          }
          response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
              sentence: record.sentence,
              sourceUrl: record.sourceUrl,
              context: record.context,
            }),
          });
        }

        if (response.ok) {
          await deletePending(record.id!);
        } else if (shouldDiscardPendingRecord(record)) {
          await deletePending(record.id!);
          notifyDiscardedSyncFailure();
        } else {
          await incrementRetry(record);
        }
      } catch (err) {
        console.error('[Vela] flushQueue: failed to process record:', record.id, err);
        if (shouldDiscardPendingRecord(record)) {
          await deletePending(record.id!);
          notifyDiscardedSyncFailure();
        } else {
          await incrementRetry(record);
        }
      }
    }
  } finally {
    isFlushing = false;
  }
}

// ── Extension entry point ────────────────────────────────────────────────────

export default defineBackground(() => {
  console.log('Vela extension background script loaded', { id: browser.runtime.id });

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: 'save-to-vela',
      title: 'Save to My Dictionaries',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: 'scan-page-vela',
      title: 'Scan page for Japanese',
      contexts: ['page'],
    });
    console.log('Context menus created');
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'scan-page-vela' && tab?.id) {
      await requestPageScan(tab.id);
      return;
    }

    if (info.menuItemId === 'save-to-vela' && info.selectionText) {
      const selectedText = info.selectionText.trim();
      if (!selectedText) return;

      try {
        const saved = await saveSentenceToAPI(selectedText, tab?.url, tab?.title);
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: saved ? 'Vela - Entry Saved' : 'Vela - Entry Queued',
          message: saved
            ? `Saved: ${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}`
            : `Queued for sync: ${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}`,
        });
      } catch (error) {
        console.error('[Vela] Error in save-to-vela handler:', error);
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Error',
          message: error instanceof Error ? error.message : 'Failed to save dictionary entry',
        });
      }
    }
  });

  // Handle batch save from content script — returns Promise so sendMessage resolves/rejects based on outcome
  browser.runtime.onMessage.addListener(
    (message: unknown): Promise<{ saved: number; total: number }> | undefined => {
      if (typeof message !== 'object' || message === null) return;
      const msg = message as Record<string, unknown>;

      // Content script signals that no Japanese text was found on the page.
      // Show the notification from the background script because the
      // browser.notifications API is not available in content scripts.
      if (msg.type === 'NO_JAPANESE_FOUND') {
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela — No sentences found',
          message: 'No Japanese sentences were detected on this page.',
        });
        return;
      }

      if (msg.type !== 'SAVE_SENTENCES') return;
      const { sentences, sourceUrl, context } = message as {
        sentences: unknown;
        sourceUrl?: string;
        context?: string;
      };
      if (!Array.isArray(sentences)) return;
      return Promise.all(
        (sentences as string[]).map((sentence) => saveSentenceToAPI(sentence, sourceUrl, context)),
      ).then((results) => {
        const saved = results.filter((ok) => ok).length;
        const total = results.length;
        return { saved, total } as const;
      });
    },
  );

  // Flush on startup and when browser regains focus (not on focus-loss)
  browser.runtime.onStartup.addListener(() => {
    flushQueue().catch((err) => console.error('[Vela] flushQueue (onStartup) failed:', err));
  });
  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== browser.windows.WINDOW_ID_NONE) {
      flushQueue().catch((err) => console.error('[Vela] flushQueue (onFocusChanged) failed:', err));
    }
  });
  self.addEventListener('online', () => {
    flushQueue().catch((err) => console.error('[Vela] flushQueue (online) failed:', err));
  });
});
