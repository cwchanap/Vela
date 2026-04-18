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

async function enqueue(record: Omit<PendingSentenceRecord, 'id'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = () => resolve();
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
    req.onsuccess = () => resolve();
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
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── API save (offline-aware) ─────────────────────────────────────────────────

async function saveSentenceToAPI(
  sentence: string,
  sourceUrl?: string,
  context?: string,
): Promise<void> {
  let idToken: string;
  try {
    idToken = await getValidIdToken();
  } catch {
    await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ sentence, sourceUrl, context }),
    });
  } catch {
    await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
    return;
  }

  if (response.status === 401) {
    try {
      idToken = await refreshIdToken();
    } catch {
      await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
      return;
    }
    try {
      response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ sentence, sourceUrl, context }),
      });
    } catch {
      await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
      return;
    }
  }

  if (!response.ok) {
    await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
  }
}

// ── Flush queue ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

async function flushQueue(): Promise<void> {
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
      } else if (record.retries >= MAX_RETRIES) {
        await deletePending(record.id!);
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela — Sync failed',
          message: '1 saved sentence could not be synced and was discarded.',
        });
      } else {
        await incrementRetry(record);
      }
    } catch {
      if (record.retries >= MAX_RETRIES) {
        await deletePending(record.id!);
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela — Sync failed',
          message: '1 saved sentence could not be synced and was discarded.',
        });
      } else {
        await incrementRetry(record);
      }
    }
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
      browser.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' });
      return;
    }

    if (info.menuItemId === 'save-to-vela' && info.selectionText) {
      const selectedText = info.selectionText.trim();
      if (!selectedText) return;

      try {
        await saveSentenceToAPI(selectedText, tab?.url, tab?.title);
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Entry Saved',
          message: `Saved: ${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}`,
        });
      } catch (error) {
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Error',
          message: error instanceof Error ? error.message : 'Failed to save dictionary entry',
        });
      }
    }
  });

  // Handle batch save from content script (fire-and-forget; no sendResponse needed)
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      (message as { type?: string }).type !== 'SAVE_SENTENCES'
    )
      return;
    const { sentences, sourceUrl, context } = message as {
      sentences: unknown;
      sourceUrl?: string;
      context?: string;
    };
    if (!Array.isArray(sentences)) return;
    void Promise.all(
      (sentences as string[]).map((sentence) =>
        saveSentenceToAPI(sentence, sourceUrl, context),
      ),
    );
  });

  // Flush on startup and when browser regains focus (not on focus-loss)
  browser.runtime.onStartup.addListener(() => flushQueue());
  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== browser.windows.WINDOW_ID_NONE) flushQueue();
  });
  self.addEventListener('online', () => flushQueue());
});
