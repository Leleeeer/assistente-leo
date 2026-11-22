// Musica di sottofondo, come nel Jarvis originale: parte al risveglio, si abbassa quando Jarvis parla
// e resta in sottofondo. Il brano lo sceglie l'utente dall'iPad e resta salvato SOLO sull'iPad
// (non finisce su GitHub, così non ci sono problemi di diritti d'autore).

// ---------------------------------------------------------------- archivio sull'iPad (IndexedDB)
function db() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open("jarvis", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((ok, ko) => {
    const tx = d.transaction("files", mode), req = fn(tx.objectStore("files"));
    tx.oncomplete = () => ok(req?.result);
    tx.onerror = () => ko(tx.error);
  });
}
export const saveTrack = (file) => idb("readwrite", (s) => s.put({ blob: file, name: file.name }, "music"));
export const loadTrack = () => idb("readonly", (s) => s.get("music")).catch(() => null);
export const deleteTrack = () => idb("readwrite", (s) => s.delete("music"));

// ---------------------------------------------------------------- lettore con volume morbido
export const LEVELS = { intro: 0.7, bed: 0.22, duck: 0.07 }; // risveglio · sottofondo · mentre Jarvis parla

export class Music {
  constructor() {
    this.buffer = null;
    this.src = null;
    this.name = "";
    this.volume = 1; // regolazione dell'utente (0-1), moltiplica i livelli
  }
  get playing() { return !!this.src; }
  get loaded() { return !!this.buffer; }

  // dentro un tocco: l'iPad permette l'audio solo così
  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.ctx.destination);
    }
    this.ctx.resume().catch(() => {});
  }

  async load() {
    const t = await loadTrack();
    if (!t?.blob || !this.ctx) { this.buffer = null; this.name = ""; return false; }
    const data = await t.blob.arrayBuffer();
    this.buffer = await new Promise((ok, ko) => this.ctx.decodeAudioData(data, ok, ko)).catch(() => null);
    this.name = this.buffer ? t.name : "";
    return !!this.buffer;
  }

  fade(level, seconds = 0.8) {
    if (!this.gain) return;
    const t = this.ctx.currentTime, g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(Math.max(0, level * this.volume), t + seconds);
  }

  async play(level = LEVELS.bed) {
    if (!this.ctx || !this.buffer) return false;
    if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
    if (!this.src) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = true;
      src.connect(this.gain);
      src.onended = () => { if (this.src === src) this.src = null; };
      src.start(0);
      this.src = src;
    }
    this.fade(level, 0.6);
    return true;
  }

  stop(seconds = 1.5) {
    if (!this.src) return;
    const src = this.src;
    this.src = null;
    this.fade(0, seconds);
    setTimeout(() => { try { src.stop(); } catch {} }, seconds * 1000 + 100);
  }
}
