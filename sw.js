// Fa aprire Jarvis anche con internet lento: prova sempre la versione più nuova,
// e se la rete non risponde usa l'ultima copia salvata.
const CACHE = "jarvis-v10";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // solo i file di Jarvis e lo strumento di Claude; mai le chiamate ai servizi (Claude, Gemini, Google, ElevenLabs)
  const mine = url.origin === self.location.origin || url.hostname === "cdn.jsdelivr.net";
  if (e.request.method !== "GET" || !mine) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
