// Tutto quello che Jarvis deve ricordare resta SOLO su questo iPad (memoria del browser).
// Niente di tutto ciò finisce su GitHub: lì c'è solo il codice.
const P = "jarvis:";

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(P + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try { localStorage.setItem(P + key, JSON.stringify(value)); } catch {}
}

// ---------------------------------------------------------------- chiavi e impostazioni
export const keys = () => ({ anthropic: "", gemini: "", elevenlabs: "", elevenVoice: "", elevenModel: "eleven_multilingual_v2", googleClientId: "", googleClientSecret: "", spotifyClientId: "", centroRepo: "Leleeeer/centro-di-controllo", centroToken: "", ...load("keys", {}) });
export const setKeys = (patch) => save("keys", { ...keys(), ...patch });

export const settings = () => ({ addressAs: "signore", name: "Leo", city: "", musicAuto: true, musicVol: 70, ...load("settings", {}) });
export const setSettings = (patch) => save("settings", { ...settings(), ...patch });

// ---------------------------------------------------------------- memoria a lungo termine
// facts: cose che sa di te · recent: ultime battute · brains: ultimi cervelli usati
export const memory = () => ({ facts: [], recent: [], brains: [], ...load("memory", {}) });
export function addFact(text) {
  const m = memory();
  const t = String(text).replace(/\s+/g, " ").trim().slice(0, 300);
  if (!t) return;
  m.facts = m.facts.filter((f) => f.toLowerCase() !== t.toLowerCase());
  m.facts.push(t);
  save("memory", m);
}
export function setFacts(list) {
  save("memory", { ...memory(), facts: list.map((s) => s.trim()).filter(Boolean) });
}
export function afterTurn(history, brain) {
  const m = memory();
  m.recent = history.slice(-8).map((h) => ({ role: h.role, content: String(h.content).slice(0, 280) }));
  m.recentAt = new Date().toISOString();
  if (brain && m.brains[0]?.label !== brain) m.brains.unshift({ label: brain, at: new Date().toISOString() });
  m.brains = m.brains.slice(0, 10);
  save("memory", m);
}

// ---------------------------------------------------------------- rubrica email
export const contacts = () => load("contacts", []);
export function saveContact(name, email) {
  const list = contacts();
  const old = list.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (old) old.email = email; else list.push({ name, email });
  save("contacts", list);
}

// ---------------------------------------------------------------- copia di sicurezza (per passare le impostazioni a un altro dispositivo)
export function exportAll() {
  const out = {};
  for (const k of ["keys", "settings", "memory", "contacts", "local"]) out[k] = load(k, null);
  return btoa(unescape(encodeURIComponent(JSON.stringify(out))));
}
export function importAll(code) {
  const data = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  for (const [k, v] of Object.entries(data)) if (v != null) save(k, v);
}
