const devtoolsUrl = process.env.CHROME_DEVTOOLS_URL ?? 'http://127.0.0.1:9222';
const fixtureUrl = process.argv[2] ?? 'http://localhost:9000/extension-test.html';

const targets = await fetchJson(`${devtoolsUrl}/json/list`);
const worker = targets.find(
  (target) => target.type === 'service_worker' && target.url.includes('/background.js'),
);

if (!worker?.webSocketDebuggerUrl) {
  throw new Error('Vela extension service worker target was not found');
}

const client = await connectDevtools(worker.webSocketDebuggerUrl);

try {
  await client.send('Runtime.enable');
  const expression = `
    new Promise((resolve) => {
      chrome.tabs.query({ url: ${JSON.stringify(fixtureUrl)} }, (tabs) => {
        const queryError = chrome.runtime.lastError?.message;
        if (queryError) {
          resolve({ ok: false, error: queryError });
          return;
        }
        if (!tabs[0]?.id) {
          resolve({ ok: false, error: 'Fixture tab not found: ${fixtureUrl}' });
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SCAN_PAGE' });
        resolve({ ok: true, tabId: tabs[0].id, url: tabs[0].url });
      });
    })
  `;

  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = response.result?.result?.value;

  if (!value?.ok) {
    throw new Error(value?.error ?? 'Failed to trigger Vela extension scan');
  }

  console.log(JSON.stringify(value, null, 2));
} finally {
  client.close();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function connectDevtools(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      return;
    }
    resolve(message);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}
