// Sunny Escapes service worker.
// Data files: network first, cache the fresh copy, fall back to the last cached copy offline.
// Everything else (HTML, CSS, JS, fonts, images, Chart.js, icons): precached, served from cache
// and refreshed in the background.
"use strict";

const VERSION = "v1";
const STATIC_CACHE = `sunny-static-${VERSION}`;
const DATA_CACHE = "sunny-data"; // not versioned: keeps the last data across app updates

const STATIC_ASSETS = [
  "./", "index.html", "browse.html", "trends.html",
  "style.css", "app.js", "manifest.json",
  "vendor/chart.umd.min.js",
  "fonts/Pacifico-Regular.ttf", "fonts/Poppins-Regular.ttf", "fonts/Poppins-Medium.ttf",
  "fonts/Poppins-SemiBold.ttf", "fonts/Poppins-Bold.ttf",
  "images/favicon.svg", "images/palm.svg", "images/starfish.svg", "images/sun.svg",
  "images/wave-aqua.svg", "images/wave-blue.svg", "images/wave-divider.svg",
  "images/wave-foam.svg", "images/wave-sand.svg",
  "icons/icon-192.png", "icons/icon-512.png",
];
const DATA_ASSETS = ["data/history.csv", "data/status.json"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const statics = await caches.open(STATIC_CACHE);
    await statics.addAll(STATIC_ASSETS.map((u) => new Request(u, { cache: "reload" })));
    // Warm the data cache too, but don't fail the install if the network hiccups.
    const data = await caches.open(DATA_CACHE);
    await Promise.all(DATA_ASSETS.map((u) => data.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("sunny-static-") && key !== STATIC_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function isData(url) {
  return /\/data\/[^/]+\.(csv|json)$/.test(url.pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request.url.split("?")[0], res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request.url.split("?")[0]);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isData(url)) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
