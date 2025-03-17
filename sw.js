const CACHE_NAME = 'p2p-chat-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  'https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Установка Service Worker и кеширование статических ресурсов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(ASSETS)
          .catch(err => {
            console.error('Ошибка кеширования:', err);
          });
      })
  );
});

// Активация и удаление старых кешей
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => {
          return cacheName !== CACHE_NAME;
        }).map(cacheName => {
          return caches.delete(cacheName);
        })
      );
    })
  );
});

// Перехват запросов и использование кеша с стратегией "Network first, then cache"
self.addEventListener('fetch', event => {
  // Пропускаем запросы к WebRTC
  if (event.request.url.includes('peerjs') || 
      event.request.url.includes('stun:') || 
      event.request.url.includes('turn:')) {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Кешируем только успешные ответы
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // При неудачном запросе используем кеш
        return caches.match(event.request);
      })
  );
}); 