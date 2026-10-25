// Service worker do PWA — cuida apenas do "casco" do app (HTML/CSS/JS/ícones).
// Dados (vendas, estoque, etc.) vivem no Firestore e NUNCA passam por este cache.
const VERSAO = 'gatti-v1';
const CASCO = [
  './',
  'index.html',
  'css/style.css',
  'js/script.js',
  'manifest.webmanifest',
  'img/icon.jpeg',
  'img/logo-gabriel.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(CASCO)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Só intercepta GET do próprio site; Firebase, CDNs e /api passam direto.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Rede primeiro (sempre pega a versão nova); se estiver offline, usa o cache.
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(VERSAO).then((cache) => cache.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
