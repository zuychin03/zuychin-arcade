const CONFIG = null /* PWA_CONFIG */;
const CACHE = `zuychin-public-${CONFIG.version}`;
const allowed = CONFIG.assets;
let writes = Promise.resolve();
let update = null;
const requests = new Set();

function publicPath(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin && !url.search && !url.hash && Object.hasOwn(allowed, url.pathname) ? url.pathname : null;
}

async function verifiedResponse(response, pathname) {
  if (!response.ok || response.status !== 200 || response.redirected || response.type === 'opaque') return false;
  const size = Number(response.headers.get('content-length'));
  if (size > CONFIG.maxBytes || allowed[pathname].bytes > CONFIG.maxBytes) return false;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== allowed[pathname].bytes) return false;
  const hash = Array.from(new Uint8Array(await self.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  return hash === allowed[pathname].sha256;
}

function remember(pathname, response) {
  writes = writes.catch(() => {}).then(async () => {
    if (!await verifiedResponse(response, pathname)) return;
    const cache = await caches.open(CACHE);
    const keys = await cache.keys();
    let total = keys.reduce((sum, key) => sum + (allowed[new URL(key.url).pathname]?.bytes || 0), 0);
    let count = keys.length;
    if (keys.some(key => new URL(key.url).pathname === pathname)) return;
    for (const key of keys) {
      if (count < CONFIG.maxEntries && total + allowed[pathname].bytes <= CONFIG.maxBytes) break;
      const old = new URL(key.url).pathname;
      if (CONFIG.precache.includes(old)) continue;
      await cache.delete(key);
      total -= allowed[old]?.bytes || 0;
      count--;
    }
    if (count >= CONFIG.maxEntries || total + allowed[pathname].bytes > CONFIG.maxBytes) return;
    try { await cache.put(pathname, response); } catch {
      // Quota failure must not break the online game or remove the offline page.
      for (const key of await cache.keys()) if (!CONFIG.precache.includes(new URL(key.url).pathname)) await cache.delete(key);
    }
  }).catch(() => {});
  return writes;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    for (const pathname of CONFIG.precache) {
      try {
        const response = await fetch(new Request(new URL(pathname, self.location.origin), { cache: 'reload', credentials: 'omit' }));
        await remember(pathname, response);
      } catch { /* Installation remains optional when storage or connectivity is unavailable. */ }
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('zuychin-public-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || url.hash) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      try {
        const fallback = await (await caches.open(CACHE)).match('/offline.html');
        if (fallback) return fallback;
      } catch { /* Storage can be unavailable in private browsing. */ }
      return new Response('Offline. Reconnect and reload to play.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }));
    return;
  }
  const pathname = publicPath(request);
  if (!pathname) return;
  event.respondWith((async () => {
    try {
      const cached = await (await caches.open(CACHE)).match(pathname);
      if (cached) return cached;
    } catch { /* Cache storage is optional. */ }
    const response = await fetch(request);
    event.waitUntil(remember(pathname, response.clone()));
    return response;
  })());
});

function broadcast(attempt, type, reason) {
  for (const client of attempt.clients) {
    try { client.postMessage({ type, requestId: attempt.requestId, reason }); } catch { /* A closed tab cannot receive the result. */ }
  }
}

function finish(attempt, approved, reason) {
  if (update !== attempt) return;
  clearTimeout(attempt.timer);
  update = null;
  broadcast(attempt, approved ? 'UPDATE_APPROVED' : 'UPDATE_BLOCKED', reason);
  attempt.resolve();
}

async function approve(attempt) {
  if (attempt.checking || update !== attempt || attempt.safe.size !== attempt.clients.length) return;
  attempt.checking = true;
  const current = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (update !== attempt) return;
  if (Date.now() >= attempt.deadline) { finish(attempt, false, 'safety-timeout'); return; }
  if (current.length !== attempt.clients.length || current.some(client => !attempt.ids.has(client.id))) {
    finish(attempt, false, 'client-set-changed');
    return;
  }
  broadcast(attempt, 'UPDATE_APPROVED');
  try {
    if (Date.now() >= attempt.deadline) { finish(attempt, false, 'safety-timeout'); return; }
    await self.skipWaiting();
    if (update === attempt) { clearTimeout(attempt.timer); update = null; attempt.resolve(); }
  } catch { finish(attempt, false, 'activation-failed'); }
}

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || typeof data.requestId !== 'string' || data.requestId.length < 8 || data.requestId.length > 128 || !event.source?.id) return;
  if (data.type === 'UPDATE_SAFETY') {
    const attempt = update;
    if (!attempt || attempt.requestId !== data.requestId || !attempt.ids.has(event.source.id)) return;
    if (data.safe !== true) { finish(attempt, false, 'client-unsafe'); return; }
    attempt.safe.add(event.source.id);
    event.waitUntil(approve(attempt).catch(() => finish(attempt, false, 'client-check-failed')));
  } else if (data.type === 'REQUEST_UPDATE') {
    event.waitUntil((async () => {
      if (update) { event.source.postMessage({ type: 'UPDATE_BLOCKED', requestId: data.requestId, reason: 'update-in-progress' }); return; }
      if (requests.has(data.requestId) || requests.size >= 1024) { event.source.postMessage({ type: 'UPDATE_BLOCKED', requestId: data.requestId, reason: 'request-reused' }); return; }
      requests.add(data.requestId);
      const attempt = { requestId: data.requestId, clients: [], ids: new Set(), safe: new Set(), checking: false, resolve() {} };
      update = attempt;
      try {
        attempt.clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        attempt.ids = new Set(attempt.clients.map(client => client.id));
        if (!attempt.ids.has(event.source.id)) { finish(attempt, false, 'unknown-requester'); return; }
        await new Promise(resolve => {
          attempt.resolve = resolve;
          attempt.deadline = Date.now() + 8000;
          attempt.timer = setTimeout(() => finish(attempt, false, 'safety-timeout'), 8000);
          broadcast(attempt, 'CHECK_UPDATE_SAFETY');
        });
      } catch { finish(attempt, false, 'client-check-failed'); }
    })());
  }
});
