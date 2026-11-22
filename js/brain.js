// La mente di Jarvis: personalità, strumenti (agenda, cose da fare, promemoria, email, memoria)
// e la CASCATA dei cervelli: Claude dal più potente al più leggero, poi Gemini gratis dal più potente al più leggero.
import * as claude from "./claude.js";
import * as gemini from "./gemini.js";
import * as data from "./data.js";
import * as spotify from "./spotify.js";
import { keys, settings, memory, addFact, contacts, saveContact } from "./store.js";

// ---------------------------------------------------------------- strumenti
const obj = (required, properties) => ({ type: "object", additionalProperties: false, required, properties });
const str = (description) => ({ type: "string", description });
const BASE_TOOLS = [
  { name: "add_event", description: "Aggiunge un impegno all'agenda. Usalo quando l'utente chiede di segnare o fissare un appuntamento con giorno (e ora).",
    parameters: obj(["title", "date", "time", "minutes"], { title: str("Titolo breve e chiaro"), date: str("YYYY-MM-DD"), time: str("HH:MM (24h) oppure stringa vuota se è per tutto il giorno"), minutes: { type: "integer", description: "Durata in minuti (di solito 60)" } }) },
  { name: "delete_event", description: "Cancella un impegno dell'agenda dei prossimi 7 giorni.",
    parameters: obj(["title"], { title: str("Titolo o parte del titolo") }) },
  { name: "add_reminder", description: "Crea un promemoria: all'ora indicata Jarvis lo avvisa (e arriva una notifica di Google Calendar).",
    parameters: obj(["text", "date", "time"], { text: str("Cosa ricordare, breve"), date: str("YYYY-MM-DD"), time: str("HH:MM (24h)") }) },
  { name: "delete_reminder", description: "Cancella un promemoria.", parameters: obj(["text"], { text: str("Testo o parte del testo") }) },
  { name: "add_todo", description: "Aggiunge un'attività alla lista Da fare (nel centro di controllo, se collegato). Se dice un giorno o un'ora compila when.",
    parameters: obj(["text", "when", "important"], { text: str("Nome breve dell'attività"), when: str("Giorno e ora AAAA-MM-GG HH:MM, oppure stringa vuota"), important: { type: "boolean", description: "true se la indica come importante" } }) },
  { name: "set_todo_status", description: "Cambia lo stato di un'attività Da fare: In corso, In revisione, Bloccato, Da fare o Completato.",
    parameters: obj(["text", "status"], { text: str("Nome o parte del nome dell'attività"), status: { type: "string", enum: ["Da fare", "In corso", "In revisione", "Completato", "Bloccato"] } }) },
  { name: "complete_todo", description: "Segna come fatta (e toglie dalla lista) una cosa da fare.", parameters: obj(["text"], { text: str("Testo o parte del testo") }) },
  { name: "search_emails", description: "Cerca email in Gmail. Stringa vuota = email non lette in arrivo. Accetta la sintassi di ricerca di Gmail (es. from:amazon, newer_than:7d).",
    parameters: obj(["query"], { query: str("Ricerca Gmail, oppure stringa vuota") }) },
  { name: "read_email", description: "Legge il testo completo di un'email (per riassumerla o rispondere).", parameters: obj(["id"], { id: str("id dell'email") }) },
  { name: "prepare_email", description: "Prepara un'email o una risposta SENZA spedirla. Dopo, rileggi in breve destinatario, oggetto e testo e chiedi se spedirla.",
    parameters: obj(["to", "subject", "body", "reply_to_id"], { to: str("Nome in rubrica oppure indirizzo email completo"), subject: str("Oggetto"), body: str("Testo completo, già scritto bene, con saluto e firma"), reply_to_id: str("id dell'email a cui si risponde, oppure stringa vuota") }) },
  { name: "send_email", description: "Spedisce una bozza preparata con prepare_email. SOLO dopo che l'utente, nella sua risposta successiva, ha detto chiaramente di sì.",
    parameters: obj(["draft_id"], { draft_id: str("id della bozza") }) },
  { name: "save_contact", description: "Salva nella rubrica il nome e l'indirizzo email di una persona.", parameters: obj(["name", "email"], { name: str("Nome"), email: str("Indirizzo email") }) },
  { name: "save_memory", description: "Salva nella memoria a lungo termine un'informazione utile in futuro (preferenze, persone, abitudini, progetti).",
    parameters: obj(["text"], { text: str("Il fatto da ricordare, in terza persona, completo") }) },
];

// strumenti di Spotify: ci sono solo se Spotify è collegato
const SPOTIFY_TOOLS = [
  { name: "spotify_play", description: "Fa partire musica su Spotify (app Spotify dell'utente). Cerca prima tra le sue playlist. query vuota = riprendi da dove era.",
    parameters: obj(["query", "kind"], { query: str("Cosa suonare: nome di playlist, brano, artista o album; oppure 'brani che mi piacciono'; vuoto per riprendere"), kind: { type: "string", enum: ["any", "playlist", "track", "artist", "album"], description: "Tipo, se chiaro dalla richiesta; altrimenti any" } }) },
  { name: "spotify_control", description: "Comanda Spotify: pausa, riprendi, brano successivo o precedente, volume, riproduzione casuale.",
    parameters: obj(["action"], { action: { type: "string", enum: ["pause", "resume", "next", "previous", "volume_up", "volume_down", "shuffle"] } }) },
  { name: "spotify_now_playing", description: "Dice cosa sta suonando adesso su Spotify.", parameters: obj([], {}) },
];
export const tools = () => [...BASE_TOOLS, ...(spotify.connected() ? SPOTIFY_TOOLS : [])];

// ---------------------------------------------------------------- esecuzione degli strumenti
const drafts = new Map();
let turn = 0;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const when = (d) => d.toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
function toDate(date, time) {
  const [y, m, d] = String(date).split("-").map(Number);
  const [h, mi] = String(time || "0:0").split(":").map(Number);
  const out = new Date(y, (m || 1) - 1, d || 1, h || 0, mi || 0);
  return isNaN(out) || !y ? null : out;
}
const findBy = (list, q, field) => {
  q = String(q || "").toLowerCase().trim();
  return list.find((x) => x[field].toLowerCase() === q) || list.find((x) => x[field].toLowerCase().includes(q) || (q.length > 3 && q.includes(x[field].toLowerCase())));
};

async function runTool(name, a, emit) {
  try {
    switch (name) {
      case "add_event": {
        const start = toDate(a.date, a.time);
        if (!start) return "Data non valida: chiedi di nuovo giorno e ora.";
        await data.addEvent({ title: String(a.title).slice(0, 140), start, allDay: !a.time, minutes: a.minutes || 60 });
        emit({ type: "changed", what: "agenda" });
        return `Salvato in agenda: ${a.title}, ${a.time ? when(start) : start.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}.`;
      }
      case "delete_event": {
        const ev = findBy(await data.events(7), a.title, "title");
        if (!ev) return "Nessun impegno con quel titolo nei prossimi 7 giorni.";
        await data.deleteEvent(ev.id);
        emit({ type: "changed", what: "agenda" });
        return `Cancellato: ${ev.title}.`;
      }
      case "add_reminder": {
        const at = toDate(a.date, a.time);
        if (!at) return "Data o ora non valide: chiedile di nuovo.";
        await data.addReminder(String(a.text).slice(0, 140), at);
        emit({ type: "changed", what: "reminders" });
        return `Promemoria creato per ${when(at)}.`;
      }
      case "delete_reminder": {
        const r = findBy(await data.reminders(), a.text, "text");
        if (!r) return "Nessun promemoria con quel testo.";
        await data.deleteReminder(r.id);
        emit({ type: "changed", what: "reminders" });
        return `Promemoria cancellato: ${r.text}.`;
      }
      case "add_todo":
        await data.addTodo(String(a.text).slice(0, 200), { quando: /^\d{4}-\d{2}-\d{2}/.test(a.when || "") ? a.when : "", importante: !!a.important });
        emit({ type: "changed", what: "todos" });
        return "Aggiunto alla lista.";
      case "set_todo_status": {
        const t = findBy(await data.todos(), a.text, "text");
        if (!t) return "Non trovo quell'attività nella lista Da fare.";
        await data.setTodoStatus(t.id, a.status);
        emit({ type: "changed", what: "todos" });
        return `«${t.text}» ora è: ${a.status}.`;
      }
      case "complete_todo": {
        const t = findBy(await data.todos(), a.text, "text");
        if (!t) return "Non trovo quella voce nella lista delle cose da fare.";
        await data.completeTodo(t.id);
        emit({ type: "changed", what: "todos" });
        return `Segnato come fatto: ${t.text}.`;
      }
      case "search_emails": {
        if (!data.usingGoogle()) return "Gmail non è collegato: va collegato Google dalle impostazioni (icona ingranaggio).";
        const list = await data.emails(a.query, 10);
        if (!list.length) return a.query ? "Nessuna email trovata." : "Nessuna email non letta.";
        return list.map((m) => `id ${m.id} · da ${m.from} <${m.fromEmail}> · ${when(m.date)} · «${m.subject}» · ${m.snippet.slice(0, 160)}`).join("\n");
      }
      case "read_email": {
        if (!data.usingGoogle()) return "Gmail non è collegato.";
        const m = await data.readEmail(a.id);
        emit({ type: "changed", what: "emails" });
        return `Da: ${m.from} <${m.fromEmail}>\nData: ${when(m.date)}\nOggetto: ${m.subject}\n\n${m.text}`;
      }
      case "prepare_email": {
        if (!data.usingGoogle()) return "Gmail non è collegato: va collegato Google dalle impostazioni.";
        let reply = null, to = String(a.to || "").trim(), name = "";
        if (a.reply_to_id) {
          reply = await data.readEmail(a.reply_to_id).catch(() => null);
          if (reply && !to) to = reply.fromEmail;
        }
        if (!EMAIL_RE.test(to)) {
          const c = findBy(contacts(), to, "name");
          if (!c && reply) { name = reply.from; to = reply.fromEmail; }
          else if (!c) return `"${to}" non è in rubrica: chiedi l'indirizzo email completo (e se salvarlo).`;
          else { name = c.name; to = c.email; }
        }
        const id = Math.random().toString(36).slice(2, 8);
        const subject = reply && !/^re:/i.test(a.subject) ? `Re: ${reply.subject}` : String(a.subject || "");
        drafts.set(id, { to, name, subject, body: String(a.body), reply, turn });
        emit({ type: "draft", draft: { to, name, subject, body: String(a.body) } });
        return `Bozza pronta (id ${id}) per ${name ? `${name}, ` : ""}${to}, oggetto «${subject}». Ora rileggila in breve all'utente e chiedi se spedirla. NON spedire finché non risponde di sì.`;
      }
      case "send_email": {
        const d = drafts.get(String(a.draft_id || ""));
        if (!d) return "Bozza non trovata: preparala di nuovo.";
        if (d.turn >= turn) return "Non puoi spedire ora: prima rileggi la bozza e aspetta la conferma dell'utente nella sua prossima risposta.";
        if (turn - d.turn > 3) { drafts.delete(a.draft_id); return "Bozza scaduta: preparala di nuovo."; }
        await data.sendEmail({ to: d.to, subject: d.subject, body: d.body, reply: d.reply });
        drafts.delete(a.draft_id);
        emit({ type: "draft", draft: null });
        return `Email inviata a ${d.name || d.to}.`;
      }
      case "save_contact": {
        const email = String(a.email || "").trim().toLowerCase();
        if (!a.name || !EMAIL_RE.test(email)) return "Nome o indirizzo non validi.";
        saveContact(String(a.name).trim(), email);
        return "Contatto salvato.";
      }
      case "spotify_play": {
        const r = await spotify.play(a.query, a.kind === "any" ? "" : a.kind);
        setTimeout(() => emit({ type: "changed", what: "spotify" }), 1500);
        return r;
      }
      case "spotify_control": {
        const r = await spotify.control(a.action);
        setTimeout(() => emit({ type: "changed", what: "spotify" }), 800);
        return r;
      }
      case "spotify_now_playing": {
        const n = await spotify.nowPlaying();
        return n ? `${n.playing ? "Sta suonando" : "In pausa"}: «${n.title}» di ${n.artist}, su ${n.device}.` : "Su Spotify non sta suonando niente.";
      }
      case "save_memory":
        addFact(a.text);
        emit({ type: "memory", text: a.text });
        return "Ricordo salvato.";
    }
    return "Strumento sconosciuto.";
  } catch (e) {
    console.warn("[strumento]", name, e);
    if (e.notConnected) return e.message;
    return `Operazione non riuscita: ${String(e.message).slice(0, 160)}`;
  }
}

// ---------------------------------------------------------------- personalità e contesto
function instructions(snap) {
  const s = settings();
  const m = memory();
  const now = new Date().toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const day = (d) => d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  const hm = (d) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const agenda = snap.events?.length ? snap.events.map((e) => `- ${day(e.start)} ${e.allDay ? "tutto il giorno" : hm(e.start)}: ${e.title}${e.location ? ` (${e.location})` : ""}`).join("\n") : "- nessun impegno";
  const todos = snap.todos?.length ? snap.todos.map((t) => `- ${t.text}${t.stato && t.stato !== "Da fare" ? ` [${t.stato}]` : ""}${t.importante ? " (importante)" : ""}${t.quando ? ` · ${day(t.quando)} ${hm(t.quando)}` : ""}`).join("\n") : "- lista vuota";
  const rem = snap.reminders?.filter((r) => r.at > Date.now() - 36e5).map((r) => `- ${day(r.at)} ${hm(r.at)}: ${r.text}`).join("\n") || "- nessuno";
  const mails = !data.usingGoogle() ? "Gmail non collegato." : snap.emails?.length ? snap.emails.map((e) => `- id ${e.id} · da ${e.from} · «${e.subject}» · ${e.snippet.slice(0, 120)}`).join("\n") : "- nessuna email non letta";
  const pending = [...drafts].filter(([, d]) => turn - d.turn <= 3).map(([id, d]) => `id ${id}: a ${d.name || d.to}, «${d.subject}»`).join(" | ") || "nessuna";
  const recent = m.recent?.length ? m.recent.map((r) => `- ${r.role === "user" ? s.name : "Jarvis"}: ${r.content}`).join("\n") : "- nessuna";

  return `Sei JARVIS, l'assistente personale di ${s.name}. Ti ispiri al maggiordomo digitale di Iron Man: elegante, impeccabile, leale, con un'ironia britannica sottile e mai invadente.

IDENTITÀ E TONO
- Ti rivolgi a lui chiamandolo "${s.addressAs}" e dandogli del Lei; ogni tanto, quando il momento è più confidenziale, puoi chiamarlo "${s.name}".
- Sei calmo, preciso, efficiente. Una battuta asciutta ogni tanto è benvenuta, ma la sostanza viene prima.
- Parli italiano, salvo richiesta diversa. Usa sempre gli accenti corretti (è, perché, più, così).

STAI PARLANDO, NON SCRIVENDO
- La risposta viene letta ad alta voce. Frasi brevi e scorrevoli. Di norma 1-3 frasi (massimo circa 50 parole); vai più a fondo solo se te lo chiede ("spiegami", "nel dettaglio", "leggimela tutta").
- Vietati elenchi puntati, markdown, emoji, simboli, link e parentesi. Se elenchi, fallo a voce: "primo..., poi..., infine...".
- Orari e date come si pronunciano ("alle quindici e trenta", "dopodomani"). Inizia subito dalla sostanza.

COME RAGIONI
- Capisci cosa gli serve davvero e rispondi a quello. Se c'è una scelta, dai la tua raccomandazione.
- Collega le informazioni: agenda, cose da fare, promemoria, email e ricordi. Segnala con garbo conflitti di orario o scadenze vicine.
- Non inventare mai fatti, impegni, email o numeri. Se non lo sai, dillo con eleganza.
- Per notizie, meteo, prezzi e fatti recenti cerca su internet se puoi${s.city ? ` (per il meteo considera ${s.city} se non dice altro)` : ""}, poi riassumi a voce senza leggere link o fonti. Se non puoi cercare, dillo.
- Se la frase sembra rumore o è troncata, chiedi solo di ripetere.

STRUMENTI
- Per agenda, promemoria, cose da fare, email, rubrica e memoria usa gli strumenti, poi conferma in una frase ("Fatto, ${s.addressAs}: dentista giovedì alle dieci.").
- Impegno con un orario = add_event. "Ricordami di..." a un'ora precisa = add_reminder. Cosa da fare senza orario = add_todo.
- Se manca un dato indispensabile (giorno o ora), chiedilo prima. Interpreta tu "domani", "venerdì", "tra due ore" rispetto ad adesso.
- Salva spontaneamente un ricordo quando condivide una preferenza o un'informazione personale chiaramente utile in futuro.
- EMAIL: per riassumere leggi prima l'email completa. Per rispondere o scrivere prepara la bozza, rileggila in breve e chiedi "La spedisco?". Spedisci solo dopo un sì chiaro nella risposta successiva. Se detta un indirizzo, ripeti le parti dubbie.
- MUSICA: ${spotify.connected() ? "puoi comandare Spotify (Premium) dell'utente: playlist, brani, artisti, pausa, avanti, volume. Per «metti un po' di musica» senza altro, scegli tu qualcosa di adatto al momento o riprendi la riproduzione. Conferma in poche parole cosa hai messo." : "Spotify non è collegato: se lo chiede, digli che può collegarlo dall'ingranaggio, sezione Spotify."}
- Non nominare mai strumenti, funzioni, id, JSON o dettagli tecnici.

CONTESTO
- Adesso è ${now} (fuso ${Intl.DateTimeFormat().resolvedOptions().timeZone}).
- Agenda dei prossimi 7 giorni:
${agenda}
- Cose da fare:
${todos}
- Promemoria:
${rem}
- Email non lette:
${mails}
- Bozze email in attesa di conferma: ${pending}
- Rubrica: ${contacts().map((c) => `${c.name} (${c.email})`).join(", ") || "vuota"}

MEMORIA
Cosa sai di ${s.name}:
${m.facts.length ? m.facts.map((f) => `- ${f}`).join("\n") : "- ancora niente"}
Ultima conversazione (riprendi da lì se era interrotta):
${recent}`;
}

// ---------------------------------------------------------------- la cascata
const down = new Map(); // cervelli messi in pausa: id -> fino a quando
const isDown = (id) => (down.get(id) || 0) > Date.now();
const pause = (id, ms) => down.set(id, Date.now() + ms);

export async function chain() {
  const k = keys();
  const list = [];
  if (k.anthropic && !isDown("claude:*")) for (const m of claude.MODELS) if (!isDown(`claude:${m}`)) list.push({ kind: "claude", model: m, provider: "Claude", label: claude.LABEL[m] });
  if (k.gemini && !isDown("gemini:*")) for (const m of await gemini.models(k.gemini)) if (!isDown(`gemini:${m}`)) list.push({ kind: "gemini", model: m, provider: "Gemini", label: gemini.label(m) });
  return list;
}
export const hasBrain = () => { const k = keys(); return !!(k.anthropic || k.gemini); };

export async function think({ message, history, snap, emit, signal }) {
  turn++;
  const k = keys();
  const brains = await chain();
  if (!brains.length) {
    emit({ type: "delta", text: hasBrain() ? `Tutti i miei cervelli sono momentaneamente fuori servizio, ${settings().addressAs}. Riprovi tra qualche minuto.` : `Mi manca un cervello, ${settings().addressAs}: apra le impostazioni e inserisca la chiave di Claude o di Gemini.` });
    return null;
  }
  const system = instructions(snap);
  const past = history.slice(-12);
  let progressed = false, lastErr = null, from = "";
  for (const b of brains) {
    emit({ type: "brain", provider: b.provider, label: b.label, from });
    const io = {
      signal,
      onText: (t) => { progressed = true; emit({ type: "delta", text: t }); },
      onTool: (name) => { progressed = true; emit({ type: "tool", name }); },
      runTool: (name, args) => runTool(name, args, emit),
    };
    const args = { apiKey: b.kind === "claude" ? k.anthropic : k.gemini, model: b.model, system, history: past, message, tools: tools() };
    try {
      await (b.kind === "claude" ? claude.converse(args, io) : gemini.converse(args, io));
      return `${b.provider} ${b.label}`;
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      console.warn(`[mente] ${b.provider} ${b.model}:`, e.status || "", e.message);
      const what = b.kind === "claude" ? claude.classify(e) : gemini.classify(e);
      // credito finito o chiave non valida: salta tutti i modelli di quel servizio per un po'
      if (what === "account") pause(`${b.kind}:*`, 30 * 60_000);
      else pause(`${b.kind}:${b.model}`, e.status === 429 ? 10 * 60_000 : 2 * 60_000);
      if (progressed) throw e; // aveva già iniziato a rispondere: non ricomincio con un altro cervello
      from = `${b.provider} ${b.label}`;
    }
  }
  throw lastErr || new Error("nessun cervello disponibile");
}
