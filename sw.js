// Generado por herramientas/construir_iphone.py: no se edita a mano.
// Guarda TODA la app en el iPhone y la sirve sin red. Una versión nueva se descarga en segundo plano
// y se toma al volver a abrir la app (no cambia nada mientras la estás usando).
const VERSION = '7ec1395644ab';
const CACHE = 'pableque-z-' + VERSION;
const ARCHIVOS = [
 "./",
 "apple-touch-icon.png",
 "fuentes.css",
 "fuentes/f1.woff2",
 "fuentes/f10.woff2",
 "fuentes/f11.woff2",
 "fuentes/f12.woff2",
 "fuentes/f13.woff2",
 "fuentes/f2.woff2",
 "fuentes/f3.woff2",
 "fuentes/f4.woff2",
 "fuentes/f5.woff2",
 "fuentes/f6.woff2",
 "fuentes/f7.woff2",
 "fuentes/f8.woff2",
 "fuentes/f9.woff2",
 "iconos/icono-180.png",
 "iconos/icono-192.png",
 "iconos/icono-512.png",
 "iconos/icono-maskable-512.png",
 "index.html",
 "manifest.webmanifest",
 "plataforma.js"
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS.map(a => new Request(a, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('pableque-z-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    let hit = await c.match(r, { ignoreSearch: true });
    if (!hit && r.mode === 'navigate') hit = await c.match('index.html');
    if (hit) return hit;
    try { return await fetch(r); }
    catch (_) { return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
