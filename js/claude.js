// Cervello principale: Claude di Anthropic (a consumo). Gira direttamente dall'iPad con la chiave salvata lì.
import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.10.0/+esm";

// Dal più potente al più leggero.
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
export const LABEL = { "claude-opus-5-5": "OPUS 5.5", "claude-sonnet-5-5": "SONNET 5.5", "claude-haiku-5-5": "HAIKU 5.5" };

let cached = { key: "", client: null };
function client(apiKey) {
  if (cached.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 }) };
  return cached.client;
}

// Ricerca su internet fatta dai server di Anthropic (meteo, notizie, prezzi...).
const webSearch = (model) => ({
  type: model.includes("haiku") ? "web_search_20250305" : "web_search_20260209",
  name: "web_search",
  max_uses: 3,
  user_location: { type: "approximate", country: "IT", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
});

const claudeTools = (tools) => tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters, strict: true }));

// Che tipo di errore è? Serve a decidere se provare un altro modello Claude o passare direttamente a Gemini.
export function classify(e) {
  const msg = String(e?.error?.error?.message || e?.message || "");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "account"; // chiave non valida
  if (/credit balance|billing|purchase credits|spend limit|usage limit/i.test(msg)) return "account"; // credito finito
  if (e instanceof Anthropic.NotFoundError) return "model"; // modello non disponibile
  return "model"; // sovraccarico, limite di velocità, rete: prova il prossimo modello
}

export async function checkKey(apiKey) {
  try {
    await client(apiKey).models.retrieve(MODELS[MODELS.length - 1]);
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "Chiave di Claude non valida." };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: "Non riesco a raggiungere Anthropic (connessione?)." };
    return { ok: false, error: `Anthropic: ${String(e.message).slice(0, 120)}` };
  }
}

// Conversazione in streaming con strumenti: il testo arriva a pezzi (onText) così la voce parte subito.
export async function converse({ apiKey, model, system, history, message, tools }, { onText, runTool, onTool, signal }) {
  const messages = [...history, { role: "user", content: message }];
  const big = !model.includes("haiku");
  for (let round = 0; round < 6; round++) {
    const stream = client(apiKey).beta.messages.stream(
      {
        model,
        max_tokens: 4000,
        system,
        messages,
        tools: [...claudeTools(tools), webSearch(model)],
        output_config: { effort: "low" }, // risposte rapide, adatte alla voce
        ...(big ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      },
      { signal },
    );
    stream.on("text", (t) => onText(t));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    if (msg.stop_reason === "refusal") { onText("Temo di non poterla aiutare su questo, signore."); return; }
    const calls = msg.content.filter((b) => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || !calls.length) return;
    messages.push({ role: "assistant", content: msg.content });
    const results = [];
    for (const c of calls) {
      onTool(c.name);
      results.push({ type: "tool_result", tool_use_id: c.id, content: await runTool(c.name, c.input ?? {}) });
    }
    messages.push({ role: "user", content: results });
  }
}
