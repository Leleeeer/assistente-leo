// Centro di controllo: le attività stanno nel file dati/attivita.json del repository GitHub (privato) dell'utente.
// Jarvis le legge e le scrive lì, con una chiave GitHub limitata a quel solo repository, salvata solo sull'iPad.
// Stesso formato del centro di controllo, così le due app vedono le stesse attività.
import { keys } from "./store.js";

const PATH = "dati/attivita.json";
export const STATI = ["Da fare", "In corso", "In revisione", "Completato", "Bloccato"];
const cfg = () => { const k = keys(); return { repo: (k.centroRepo || "Leleeeer/centro-di-controllo").trim(), token: (k.centroToken || "").trim() }; };
export const connected = () => !!cfg().token;

async function gh(path, opts = {}) {
  const { token } = cfg();
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(
    r.status === 401 ? "Centro di controllo: la chiave GitHub non è valida o è scaduta."
    : r.status === 403 ? "Centro di controllo: la chiave GitHub non ha il permesso di scrivere (serve Contents: Read and write)."
    : r.status === 404 ? "Centro di controllo: non trovo il repository o il file dati/attivita.json (controlla il nome del repository e che la chiave lo includa)."
    : j.message || `GitHub ${r.status}`), { status: r.status });
  return j;
}
const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const encode = (txt) => { const bytes = new TextEncoder().encode(txt); let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };

async function read() {
  const { repo } = cfg();
  const f = await gh(`/repos/${repo}/contents/${PATH}`);
  return { list: JSON.parse(decode(f.content) || "[]"), sha: f.sha };
}
// Modifica il file in modo sicuro: se nel frattempo l'ha cambiato anche il centro di controllo, rilegge e riprova.
async function change(fn, message) {
  const { repo } = cfg();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { list, sha } = await read();
    const out = fn(list);
    try {
      await gh(`/repos/${repo}/contents/${PATH}`, { method: "PUT", body: JSON.stringify({ message: `Jarvis: ${message}`, content: encode(JSON.stringify(list, null, 2) + "\n"), sha }) });
      return out;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
    }
  }
  throw new Error("Centro di controllo occupato: riprova tra un attimo.");
}

export async function check() {
  await read();
  return true;
}
export async function list() {
  return (await read()).list;
}
const newId = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function add({ titolo, descrizione = "", quando = "", importante = false }) {
  const now = new Date().toISOString();
  const item = { id: newId(), titolo, descrizione, quando, stato: "Da fare", importante: !!importante, creata: now, aggiornata: now, note: "", commenti: [], origine: "Jarvis" };
  return change((l) => { l.push(item); return item; }, `aggiunta «${titolo}»`);
}
export function update(id, patch) {
  return change((l) => {
    const it = l.find((x) => x.id === id);
    if (!it) throw new Error("Attività non trovata nel centro di controllo.");
    Object.assign(it, patch, { aggiornata: new Date().toISOString() });
    return it;
  }, `aggiornata «${patch.titolo || id}»${patch.stato ? ` → ${patch.stato}` : ""}`);
}
export function remove(id) {
  return change((l) => { const i = l.findIndex((x) => x.id === id); if (i >= 0) l.splice(i, 1); }, `eliminata ${id}`);
}

// "2026-11-22 18:30" (ora italiana) <-> Date
export function parseQuando(q) {
  const m = String(q || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
}
