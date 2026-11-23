// Casa: la presa Tapo comandata tramite IFTTT (ponte ufficiale TP-Link Tapo ↔ IFTTT).
// Jarvis manda un segnale "Webhooks" a IFTTT, e IFTTT accende o spegne la presa.
// Nota: con questo ponte Jarvis può DARE comandi ma non può LEGGERE se la presa è accesa:
// ricorda solo l'ultimo comando che ha dato lui.
import { keys, load, save } from "./store.js";

export const EVENTS = { on: "jarvis_presa_on", off: "jarvis_presa_off" };
export const name = () => (keys().plugName || "presa").trim();
export const connected = () => !!keys().iftttKey;
export const lastState = () => load("plugState", null); // "on" | "off" | null

export async function set(on) {
  const key = keys().iftttKey;
  if (!key) throw new Error("La presa non è ancora collegata: ingranaggio → Casa.");
  const ev = on ? EVENTS.on : EVENTS.off;
  // IFTTT non permette alle pagine web di leggere la risposta, ma il segnale arriva lo stesso
  await fetch(`https://maker.ifttt.com/trigger/${ev}/with/key/${encodeURIComponent(key)}`, { method: "POST", mode: "no-cors", body: new URLSearchParams({ value1: "Jarvis" }) });
  save("plugState", on ? "on" : "off");
  return on ? "on" : "off";
}
export const toggle = () => set(lastState() !== "on");

// Frasi semplici gestite all'istante, senza AI: «accendi la presa», «spegni la lampada del salotto»…
export function quickCommand(text) {
  if (!connected()) return null;
  const t = text.toLowerCase();
  const n = name().toLowerCase();
  const mentions = t.includes(n) || /\b(presa|spina)\b/.test(t);
  if (!mentions) return null;
  if (/\b(accendi|attiva|accendere|metti in funzione)\b/.test(t)) return "on";
  if (/\b(spegni|disattiva|spegnere|stacca)\b/.test(t)) return "off";
  return null;
}
