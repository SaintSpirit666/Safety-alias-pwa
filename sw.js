const CACHE_PREFIX = 'safety-alias-';
const CACHE_VERSION = 'v8';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './content.js',
  './event-engine.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './favicon-32.png',
  './apple-touch-icon.png',
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function fetchWithTimeout(request) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout')), NETWORK_TIMEOUT_MS),
    ),
  ]);
}

async function cacheResponse(event, request, response) {
  if (!response.ok || response.type !== 'basic') return response;
  await caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
  return response;
}

async function handleNavigation(event) {
  try {
    const response = await fetchWithTimeout(event.request);
    return cacheResponse(event, event.request, response);
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    return (
      (await cache.match(event.request)) ||
      (await cache.match('./index.html')) ||
      new Response('Приложение недоступно офлайн. Подключитесь к сети и повторите попытку.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function handleAsset(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then((response) =>
    cacheResponse(event, event.request, response),
  );

  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }

  try {
    return await network;
  } catch (error) {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  const cacheableDestinations = new Set(['style', 'script', 'image', 'font', 'manifest']);
  if (
    cacheableDestinations.has(event.request.destination) ||
    APP_SHELL.some((path) => new URL(path, self.location).href === url.href)
  ) {
    event.respondWith(handleAsset(event));
  }
});
