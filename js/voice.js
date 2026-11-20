// Voce di Jarvis (bocca) e ascolto (orecchie).
// Bocca: ElevenLabs se c'è la chiave, altrimenti la voce italiana dell'iPad.
// Orecchie: il riconoscimento vocale di Safari, in italiano.
import { keys } from "./store.js";

const DEFAULT_VOICE = "onwK4e9ZLuTAKqWW03F9"; // "Daniel": profonda, britannica, molto Jarvis

// ---------------------------------------------------------------- bocca
export class Mouth {
  constructor({ onLevel = () => {}, onStart = () => {}, onIdle = () => {} } = {}) {
    Object.assign(this, { onLevel, onStart, onIdle });
    this.queue = [];
    this.playing = false;
    this.cache = new Map();
    this.elevenDown = 0;
    this.gen = 0; // cambia a ogni stop(): scarta l'audio ancora in arrivo
  }

  // Da chiamare dentro un tocco sullo schermo: l'iPad sblocca l'audio solo così.
  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
      this.levelLoop();
    }
    this.ctx.resume();
    const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    if ("speechSynthesis" in window) speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(" "), { volume: 0 }));
  }

  get busy() { return this.playing || this.queue.length > 0; }
  get usingEleven() { return !!keys().elevenlabs && Date.now() > this.elevenDown; }

  // Prepara l'audio di una frase (lo scarica subito, così è pronto quando tocca a lei).
  audioFor(text) {
    if (!this.usingEleven || !this.ctx) return Promise.resolve(null);
    const k = keys(), voice = k.elevenVoice || DEFAULT_VOICE, id = `${voice}|${text}`;
    if (this.cache.has(id)) return this.cache.get(id);
    const p = (async () => {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": k.elevenlabs, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", language_code: "it", voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true } }),
      });
      if (!r.ok) {
        const msg = (await r.text()).slice(0, 200);
        if ([401, 402].includes(r.status) || /quota|credit|limit/i.test(msg)) this.elevenDown = Date.now() + 15 * 60_000;
        throw new Error(`ElevenLabs ${r.status}: ${msg}`);
      }
      const buf = await r.arrayBuffer();
      return new Promise((ok, ko) => this.ctx.decodeAudioData(buf, ok, ko));
    })();
    this.cache.set(id, p);
    p.catch((e) => { console.warn("[voce]", e.message); this.cache.delete(id); });
    if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value);
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
    const buffer = await item.audio;
    if (gen !== this.gen) return;
    this.onStart(item.text);
    if (buffer) await this.playBuffer(buffer);
    else await this.speakDevice(item.text);
    if (gen === this.gen) this.next();
  }

  playBuffer(buffer) {
    return new Promise((done) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser);
      src.onended = done;
      this.current = src;
      src.start();
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
      u.onend = u.onerror = () => { clearInterval(fake); this.onLevel(0); done(); };
      this.utter = u;
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.gen++;
    this.queue = [];
    try { this.current?.stop(); } catch {}
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.playing = false;
    this.onLevel(0);
  }

  levelLoop() {
    const data = new Uint8Array(this.analyser.fftSize);
    const tick = () => {
      if (this.playing && this.current) {
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        this.onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
      }
      requestAnimationFrame(tick);
    };
    tick();
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
    if (on) this.halt(); else this.kick();
  }
  halt() {
    try { this.rec?.abort(); } catch {}
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
      // Safari ogni tanto si ferma da solo: se deve ascoltare, riparte
      if (this.wanted && !this.muted) setTimeout(() => this.kick(), 250);
    };
    this.rec = rec;
    try { rec.start(); } catch { this.running = false; }
  }
}
