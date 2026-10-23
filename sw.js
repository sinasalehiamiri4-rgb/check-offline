// Service Worker: کارکرد آفلاین برنامه + نمایش اعلان سررسید چک
// نکته: هر بار این فایل را تغییر دادید، شماره‌ی نسخه‌ی CACHE را بالا ببرید.
const CACHE = 'check-manager-local-v1';

// کتابخانه‌ها و فونت‌هایی که برنامه از اینترنت می‌گیرد (باید دقیقاً با آدرس‌های index.html یکی باشند)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/css/persian-datepicker.min.css',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js',
  'https://cdn.jsdelivr.net/npm/persian-date@1.1.0/dist/persian-date.min.js',
  'https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/js/persian-datepicker.min.js',
  'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800&display=swap'
];

// این درخواست‌ها هرگز کش نمی‌شوند (دیتابیس باید مستقیم برود)
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.google-analytics.com',
  'www.googletagmanager.com'
];

const okToCache = (res) => res && (res.ok || res.type === 'opaque');

// داخل فایل CSS دنبال آدرس فونت‌ها می‌گردد تا آن‌ها هم آفلاین در دسترس باشند
async function cacheFontsOfCss(cache, cssUrl) {
  try {
    const res = await fetch(cssUrl, { mode: 'cors' });
    if (!res.ok) return;
    const text = await res.text();
    const urls = new Set();
    const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1].startsWith('data:')) continue;
      const abs = new URL(m[1], cssUrl).href;
      if (/\.(woff2|woff)(\?|#|$)/i.test(abs) || abs.includes('fonts.gstatic.com')) urls.add(abs);
    }
    await Promise.allSettled([...urls].map(async (u) => {
      if (await cache.match(u)) return;
      const r = await fetch(u, { mode: 'cors' });
      if (okToCache(r)) await cache.put(u, r);
    }));
  } catch (e) { /* اگر نشد، در اولین اجرای آنلاین به‌صورت خودکار کش می‌شود */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const base = self.registration.scope;
    // خود برنامه
    await Promise.allSettled([
      cache.add(new Request(base, { cache: 'reload' })),
      cache.add(new Request(base + 'index.html', { cache: 'reload' }))
    ]);
    // کتابخانه‌ها
    await Promise.allSettled(CDN_ASSETS.map(async (u) => {
      try {
        const r = await fetch(u, { mode: 'cors' });
        if (okToCache(r)) await cache.put(u, r);
      } catch (e) {
        try { const r2 = await fetch(u, { mode: 'no-cors' }); if (okToCache(r2)) await cache.put(u, r2); } catch (e2) {}
      }
    }));
    // فونت‌های داخل CSS ها
    await Promise.allSettled(
      CDN_ASSETS.filter((u) => /\.css|css2\?/.test(u)).map((u) => cacheFontsOfCss(cache, u))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// اول اینترنت (با مهلت کوتاه)، اگر نبود از کش
function networkFirst(request, timeoutMs) {
  return (async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(request),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
      ]);
      if (okToCache(res)) cache.put(request, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      const hit = (await cache.match(request, { ignoreSearch: true }))
        || (await cache.match(self.registration.scope))
        || (await cache.match(self.registration.scope + 'index.html'));
      if (hit) return hit;
      throw e;
    }
  })();
}

// اول کش (برای کتابخانه‌ها و فونت‌ها)، در پس‌زمینه تازه می‌شود
function cacheFirst(request) {
  return (async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) {
      fetch(request).then((res) => { if (okToCache(res)) cache.put(request, res.clone()); }).catch(() => {});
      return hit;
    }
    const res = await fetch(request);
    if (okToCache(res)) cache.put(request, res.clone()).catch(() => {});
    return res;
  })();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (BYPASS_HOSTS.includes(url.hostname)) return;

  // صفحه‌ی اصلی
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, 3500));
    return;
  }
  // فایل‌های هم‌دامنه (مثل خود index.html و sw.js)
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, 3500));
    return;
  }
  // کتابخانه‌ها و فونت‌های بیرونی
  event.respondWith(cacheFirst(req));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
