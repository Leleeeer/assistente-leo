// Cervello di riserva gratuito: Google Gemini (chiave gratuita da aistudio.google.com/apikey).
// Jarvis scopre da solo quali modelli Gemini sono disponibili e li ordina dal più potente al più leggero.
import { load, save } from "./store.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const FALLBACK = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
const TIER = { pro: 3, flash: 2, "flash-lite": 1 };

export async function models(apiKey, force = false) {
  const c = load("geminiModels", null);
  if (!force && c && c.key === apiKey.slice(-6) && Date.now() - c.at < 864e5) return c.list;
  try {
    const r = await fetch(`${BASE}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
    if (!r.ok) throw new Error(String(r.status));
    const found = ((await r.json()).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .map((id) => ({ id, m: id.match(/^gemini-(\d+(?:\.\d+)?)-(pro|flash-lite|flash)(-preview)?$/) }))
      .filter((x) => x.m)
      .map(({ id, m }) => ({ id, tier: TIER[m[2]], ver: parseFloat(m[1]), preview: !!m[3] }));
    // per ogni livello (pro, flash, flash-lite) il modello più recente, poi il precedente come scorta
    found.sort((a, b) => b.tier - a.tier || b.ver - a.ver || a.preview - b.preview);
    const list = [];
    for (const t of [3, 2, 1]) list.push(...found.filter((x) => x.tier === t).slice(0, 2).map((x) => x.id));
    const out = list.length ? list : FALLBACK;
    save("geminiModels", { key: apiKey.slice(-6), at: Date.now(), list: out });
    return out;
  } catch {
    return c?.list || FALLBACK;
  }
}

export const label = (id) => id.replace(/^gemini-/, "").replace(/-/g, " ").toUpperCase();

// Gemini accetta solo una parte delle regole degli schemi: tolgo quelle che non capisce.
function clean(schema) {
  if (Array.isArray(schema)) return schema.map(clean);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) if (k !== "additionalProperties") out[k] = clean(v);
  return out;
}

export function classify(e) {
  if (e.status === 400 && /api key/i.test(e.message)) return "account";
  if (e.status === 401 || e.status === 403) return "account";
  return "model"; // 429 limite gratuito finito, 503 sovraccarico, 404 modello sparito: prova il prossimo
}

export async function converse({ apiKey, model, system, history, message, tools }, { onText, runTool, onTool, signal }) {
  const contents = [
    ...history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
    { role: "user", parts: [{ text: message }] },
  ];
  const decl = tools.map(({ name, description, parameters }) => ({ name, description, parameters: clean(parameters) }));
  for (let round = 0; round < 5; round++) {
    const r = await fetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: decl }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
      }),
      signal,
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw Object.assign(new Error(j.error?.message || `Gemini ${r.status}`), { status: r.status });
    }
    const parts = [];
    const calls = [];
    const dec = new TextDecoder();
    let buf = "";
    const reader = r.body.getReader();
    for (;;) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.error) throw Object.assign(new Error(ev.error.message || "Gemini: risposta fallita"), { status: ev.error.code });
        for (const p of ev.candidates?.[0]?.content?.parts || []) {
          parts.push(p); // rimando tutto indietro così com'è (serve a Gemini per ragionare con gli strumenti)
          if (p.text && !p.thought) onText(p.text);
          if (p.functionCall) calls.push(p.functionCall);
        }
      }
    }
    if (!calls.length) return;
    contents.push({ role: "model", parts });
    const responses = [];
    for (const c of calls) {
      onTool(c.name);
      responses.push({ functionResponse: { name: c.name, response: { result: await runTool(c.name, c.args || {}) } } });
    }
    contents.push({ role: "user", parts: responses });
  }
}

export async function checkKey(apiKey) {
  const r = await fetch(`${BASE}/models?pageSize=1&key=${encodeURIComponent(apiKey)}`).catch(() => null);
  if (!r) return { ok: false, error: "Non riesco a raggiungere Google (connessione?)." };
  if (!r.ok) return { ok: false, error: "Chiave Gemini non valida." };
  return { ok: true, models: await models(apiKey, true) };
}
