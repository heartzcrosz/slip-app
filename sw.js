// ตัวช่วยให้แอปเปิดได้แบบออฟไลน์ — เปลี่ยนเลขเวอร์ชันเมื่ออัปเดตไฟล์
const C = 'slip-app-v5';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png', './slip-reader.js', './slip-ocr.js', './vendor/anthropic-sdk.mjs'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // ไฟล์ของแอปเอง: ใช้ของใหม่จากเน็ตก่อน ถ้าออฟไลน์ค่อยใช้ของในเครื่อง (อัปเดตแล้วเห็นทันที)
  if (new URL(e.request.url).origin === location.origin) {
    e.respondWith(caches.open(C).then(c => fetch(e.request)
      .then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
      .catch(async () => (await c.match(e.request, { ignoreSearch: true })) || c.match('./index.html'))));
    return;
  }
  // ไฟล์จากที่อื่น (ตัวอ่าน OCR): ใช้ของในเครื่องก่อน แล้วอัปเดตเบื้องหลังเมื่อมีเน็ต
  e.respondWith(caches.open(C).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || (await c.match('./index.html'));
  }));
});
