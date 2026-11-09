// Generado por herramientas/construir_iphone.py: no se edita a mano.
// Guarda TODA la app en el iPhone y la sirve sin red. Una versión nueva se descarga sola (al abrir la app
// o al volver a ella) y entra sin cerrar la app: este archivo AVISA a la app abierta y la app se recarga sola
// cuando no estás a mitad de algo (sin hoja abierta ni teclado). Tus datos quedan igual: este archivo no toca
// IndexedDB ni localStorage.
const VERSION = '1f6922330f42';
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
const RECIBIDAS = new Set();

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    let habia = false;
    for (const k of await caches.keys()) if (k.startsWith('pableque-z-') && k !== CACHE) { habia = true; await caches.delete(k); }
    await self.clients.claim();
    if (!habia) return;            // primera vez: nada que avisar
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of ventanas) { try { w.postMessage({ tipo: 'version-nueva', version: VERSION }); } catch (_) {} }
    // Una app abierta con una versión anterior a v53b no entiende el aviso: si no responde en 5 s, se recarga como antes.
    setTimeout(async () => {
      for (const w of ventanas) if (!RECIBIDAS.has(w.id)) {
        try { const u = new URL(w.url); u.searchParams.set('actualizada', '1'); await w.navigate(u.href); } catch (_) {}
      }
    }, 5000);
  })());
});
self.addEventListener('message', e => {
  if (e.data && e.data.tipo === 'version-recibida' && e.source) RECIBIDAS.add(e.source.id);
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
