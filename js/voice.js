// Voce di Jarvis (bocca) e ascolto (orecchie).
// Bocca: ElevenLabs se c'è la chiave, altrimenti la voce italiana dell'iPad.
// Orecchie: il riconoscimento vocale di Safari, in italiano.
// Su iPad l'audio va sbloccato con un tocco e non può suonare mentre il microfono ascolta:
// per questo prima di ogni frase Jarvis spegne l'ascolto e aspetta che sia spento davvero.
import { keys } from "./store.js";

const DEFAULT_VOICE = "onwK4e9ZLuTAKqWW03F9"; // "Daniel": profonda, britannica, molto Jarvis

// un istante di silenzio, per sbloccare il lettore audio al primo tocco
function silence() {
  const rate = 8000, n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// ---------------------------------------------------------------- bocca
export class Mouth {
  constructor({ onLevel = () => {}, onStart = () => {}, onIdle = () => {}, beforePlay = async () => {} } = {}) {
    Object.assign(this, { onLevel, onStart, onIdle, beforePlay });
    this.queue = [];
    this.playing = false;
    this.cache = new Map();
    this.elevenDown = 0;
    this.lastError = "";
    this.gen = 0; // cambia a ogni stop(): scarta l'audio ancora in arrivo
    this.el = new Audio();
    this.el.setAttribute("playsinline", "");
    this.el.preload = "auto";
  }

  // Da chiamare dentro un tocco sullo schermo: l'iPad sblocca l'audio solo così.
  unlock() {
    this.unlocked = true;
    this.el.src = (this.silent ??= silence());
    this.el.play().catch(() => {});
    if ("speechSynthesis" in window) speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(" "), { volume: 0 }));
  }

  get busy() { return this.playing || this.queue.length > 0; }
  get usingEleven() { return !!keys().elevenlabs && Date.now() > this.elevenDown; }

  // Scarica subito l'audio di una frase, così è pronto quando tocca a lei.
  audioFor(text) {
    if (!this.usingEleven) return Promise.resolve(null);
    const k = keys(), voice = k.elevenVoice || DEFAULT_VOICE, model = k.elevenModel || "eleven_multilingual_v2", id = `${voice}|${model}|${text}`;
    if (this.cache.has(id)) return this.cache.get(id);
    const p = (async () => {
      let r;
      try {
        r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { "xi-api-key": k.elevenlabs, "Content-Type": "application/json" },
          body: JSON.stringify({ text, model_id: model, ...(model.includes("flash") ? { language_code: "it" } : {}), voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true } }),
        });
      } catch {
        throw new Error("ElevenLabs non raggiungibile (connessione?)");
      }
      if (!r.ok) {
        const raw = await r.text();
        let msg = raw;
        try { const j = JSON.parse(raw); msg = j.detail?.message || j.detail?.status || j.detail || raw; } catch {}
        msg = String(typeof msg === "string" ? msg : JSON.stringify(msg)).slice(0, 160);
        if ([401, 402].includes(r.status) || /quota|credit|limit|permission/i.test(msg)) this.elevenDown = Date.now() + 15 * 60_000;
        throw new Error(
          r.status === 401 ? `ElevenLabs: chiave non valida o senza permesso «Text to Speech» (${msg})`
          : r.status === 404 ? "ElevenLabs: ID della voce non trovato"
          : /quota|credit|limit/i.test(msg) ? "ElevenLabs: caratteri del mese finiti"
          : `ElevenLabs ${r.status}: ${msg}`,
        );
      }
      return URL.createObjectURL(await r.blob());
    })();
    this.cache.set(id, p);
    p.catch((e) => { this.lastError = e.message; console.warn("[voce]", e.message); this.cache.delete(id); });
    if (this.cache.size > 60) {
      const [oldId, old] = this.cache.entries().next().value;
      this.cache.delete(oldId);
      old.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
    }
    return p;
  }

  say(text) {
    text = String(text).trim();
    if (!text) return;
    this.queue.push({ text, audio: this.audioFor(text).catch(() => null) });
    if (!this.playing) this.next();
  }

  async next() {
    const item = this.queue.shift();
    if (!item) { this.playing = false; this.onLevel(0); this.onIdle(); return; }
    this.playing = true;
    const gen = this.gen;
    const [url] = await Promise.all([item.audio, this.beforePlay()]);
    if (gen !== this.gen) return;
    this.onStart(item.text);
    const ok = url ? await this.playUrl(url) : false;
    if (!ok && gen === this.gen) await this.speakDevice(item.text);
    if (gen === this.gen) this.next();
  }

  playUrl(url) {
    return new Promise((done) => {
      const el = this.el;
      let t = 0, finished = false;
      const fake = setInterval(() => this.onLevel(0.35 + 0.3 * Math.abs(Math.sin((t += 0.7))) * Math.random()), 70);
      const end = (ok) => { if (finished) return; finished = true; clearInterval(fake); el.onended = el.onerror = null; this.onLevel(0); done(ok); };
      el.onended = () => end(true);
      el.onerror = () => { this.lastError = "il lettore audio dell'iPad non riesce a riprodurre"; end(false); };
      el.src = url;
      el.play().catch((e) => { this.lastError = `audio bloccato dall'iPad (${e.name}): tocca lo schermo e riprova`; end(false); });
    });
  }

  speakDevice(text) {
    return new Promise((done) => {
      if (!("speechSynthesis" in window)) return done();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "it-IT";
      const voices = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith("it"));
      u.voice = voices.find((v) => /luca|diego|giuseppe|male/i.test(v.name)) || voices[0] || null;
      u.rate = 1.02;
      let t = 0;
      const fake = setInterval(() => this.onLevel(0.25 + 0.2 * Math.sin((t += 0.6))), 60);
      const finish = () => { clearInterval(fake); clearTimeout(guard); this.onLevel(0); done(); };
      // Safari a volte non avvisa la fine: chiudo comunque dopo un tempo ragionevole
      const guard = setTimeout(finish, 1500 + text.length * 90);
      u.onend = u.onerror = finish;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.gen++;
    this.queue = [];
    try { this.el.pause(); } catch {}
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.playing = false;
    this.onLevel(0);
  }
}

// ---------------------------------------------------------------- orecchie
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Ears {
  constructor({ onFinal = () => {}, onInterim = () => {}, onState = () => {} } = {}) {
    Object.assign(this, { onFinal, onInterim, onState });
    this.supported = !!Rec;
    this.wanted = false; // l'utente vuole che ascolti
    this.muted = false; // muto mentre Jarvis parla (così non sente sé stesso)
    this.running = false;
    this.waiters = [];
  }
  start() {
    this.wanted = true;
    this.kick();
  }
  stop() {
    this.wanted = false;
    this.halt();
  }
  mute(on) {
    this.muted = on;
    if (on) this.halt(); else setTimeout(() => this.kick(), 300);
  }
  halt() {
    try { this.rec?.abort(); } catch {}
  }
  // Promessa che si risolve quando il microfono è davvero spento (serve all'iPad per poter parlare).
  waitStopped() {
    if (!this.running) return Promise.resolve();
    this.halt();
    return new Promise((ok) => {
      const t = setTimeout(ok, 800);
      this.waiters.push(() => { clearTimeout(t); ok(); });
    });
  }
  kick() {
    if (!this.supported || !this.wanted || this.muted || this.running) return;
    const rec = new Rec();
    rec.lang = "it-IT";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => { this.running = true; this.onState("on"); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.onFinal(r[0].transcript.trim(), r[0].confidence);
        else interim += r[0].transcript;
      }
      if (interim) this.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { this.wanted = false; this.onState("blocked"); }
      else if (e.error !== "aborted" && e.error !== "no-speech") this.onState(`errore: ${e.error}`);
    };
    rec.onend = () => {
      this.running = false;
      this.onState("off");
      this.waiters.splice(0).forEach((f) => f());
      // Safari ogni tanto si ferma da solo: se deve ascoltare, riparte
      if (this.wanted && !this.muted) setTimeout(() => this.kick(), 300);
    };
    this.rec = rec;
    try { rec.start(); this.running = true; } catch { this.running = false; }
  }
}
