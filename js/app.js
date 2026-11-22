// Jarvis: collega sfera, voce, ascolto, pannelli e mente.
import { createScene } from "./scene.js";
import { Mouth, Ears } from "./voice.js";
import { think, chain, hasBrain } from "./brain.js";
import { tryCalc, sayNumber } from "./calc.js";
import * as data from "./data.js";
import * as google from "./google.js";
import * as claude from "./claude.js";
import * as gemini from "./gemini.js";
import * as store from "./store.js";
import { Music, LEVELS, saveTrack, deleteTrack } from "./music.js";

// musica di sottofondo: si abbassa quando Jarvis parla
const music = new Music();
const musicFor = (m) => { if (music.playing) music.fade(m === "speak" ? LEVELS.duck : LEVELS.bed, m === "speak" ? 0.4 : 1.5); };

const $ = (s) => document.querySelector(s);
const body = document.body;
const S = () => store.settings();

let mode = "boot", started = false, greeted = false, history = [], abortCtl = null, lastActivity = 0, sleepAfter = false;
const snap = { events: [], todos: [], reminders: [], emails: [] };

const WAKE = /\b(jarvis|jarvi|giarvis|jervis|gervis|charvis|giavis)\b/i;
const STANDBY = /\b(grazie jarvis|a dopo|vai in standby|standby|riposati|buonanotte|basta così|è tutto)\b/i;
const STOP = /^(stop|basta|fermati|zitto|silenzio)\b/i;

// ---------------------------------------------------------------- sfera, voce, orecchie
const scene = createScene($("#gl"), $("#labels")); // scena 3D originale
// tema chiaro o scuro, come le impostazioni dell'iPad (e cambia da solo se le cambi)
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => scene.setTheme(darkQuery.matches);
applyTheme();
darkQuery.addEventListener?.("change", applyTheme);
const orb = { setLevel: (v) => scene.setLevel(v), setMode: (m) => scene.setMode(m), burst: (n = 40) => scene.burstSynapses(n) };
const mouth = new Mouth({
  onLevel: (v) => orb.setLevel(v),
  onStart: (text) => showSays(text),
  onIdle: () => {
    if (mode !== "speak") return;
    if (sleepAfter) { sleepAfter = false; return goSleep(); }
    setMode("listen");
  },
  beforePlay: () => ears.waitStopped(), // su iPad il microfono acceso ammutolisce l'audio
});
const ears = new Ears({
  onFinal: heard,
  onInterim: (t) => { if (mode === "listen") { $("#you").textContent = t; $("#you").classList.add("live"); lastActivity = Date.now(); } },
  onState: (s) => { if (s === "blocked") toast("Microfono bloccato: consentilo in Impostazioni iPad → Safari → Microfono. Intanto puoi scrivere."); },
});

const STATUS = { boot: "Avvio", sleep: "In attesa", listen: "In ascolto", think: "Sto pensando", speak: "Risponde" };
function setMode(m) {
  mode = m;
  body.dataset.mode = m;
  orb.setMode(m);
  $("#statusText").textContent = STATUS[m] || m;
  $("#hint").textContent = m === "listen" ? "La ascolto…" : m === "sleep" ? "Dica «Jarvis»" : "";
  ears.mute(m === "speak"); // mentre parla non ascolta (non deve sentire sé stesso)
  if (m === "listen") lastActivity = Date.now();
  if (m === "think") { $("#says").textContent = ""; orb.burst(); }
  musicFor(m);
}

function showSays(text) {
  const el = $("#says");
  el.innerHTML = "";
  text.split(/\s+/).forEach((w, i) => {
    const s = document.createElement("span");
    s.textContent = w + " ";
    s.style.animationDelay = `${i * 0.07}s`;
    el.appendChild(s);
  });
}
function speak(text) {
  if (mode !== "speak") setMode("speak");
  mouth.say(text);
}
let toastTimer;
function toast(text, alarm = false, ms = 4500) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("alarm", alarm);
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), ms);
}

// ---------------------------------------------------------------- risveglio, standby, interruzione
function interrupt() {
  abortCtl?.abort();
  abortCtl = null;
  mouth.stop();
  setMode("listen");
}
function goSleep() {
  abortCtl?.abort();
  mouth.stop();
  setMode("sleep");
  $("#you").textContent = "";
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function wake(rest = "") {
  const q = rest.replace(/^[\s,.!?]*(ciao|ehi|hey|ok|buongiorno|buonasera|salve)?[\s,.!?]*/i, "").trim();
  if (!greeted) {
    greeted = true;
    scene.wake(); // onda di luce del risveglio
    if (S().musicAuto && music.loaded) music.play(LEVELS.intro).then(() => setTimeout(() => musicFor(mode), 1500));
    briefing();
    if (q.split(/\s+/).length >= 2) pending = q;
    return;
  }
  if (q.split(/\s+/).length >= 2) return process(q);
  speak(pick([`Sì, ${S().addressAs}?`, `Mi dica, ${S().addressAs}.`, `Al suo servizio, ${S().addressAs}.`]));
}
let pending = null;

function briefing() {
  const s = S(), h = new Date().getHours();
  const hello = h < 5 ? "Buonanotte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
  const today = todayEvents(), next = today.find((e) => !e.allDay && e.start > Date.now());
  const parts = [`${hello}, ${s.addressAs}. Tutti i sistemi sono operativi.`];
  if (today.length) parts.push(`Oggi ha ${today.length === 1 ? "un impegno" : `${today.length} impegni`}${next ? `, il prossimo alle ${hm(next.start)}: ${next.title}` : ""}.`);
  else parts.push("Oggi l'agenda è libera.");
  const extra = [];
  if (snap.emails.length) extra.push(`${snap.emails.length === 1 ? "un'email non letta" : `${snap.emails.length} email non lette`}`);
  if (snap.todos.length) extra.push(`${snap.todos.length === 1 ? "una cosa da fare" : `${snap.todos.length} cose da fare`}`);
  if (extra.length) parts.push(`Ha inoltre ${extra.join(" e ")}.`);
  parts.push("Come posso esserle utile?");
  for (const p of parts) speak(p);
}

// ---------------------------------------------------------------- cosa ha sentito
function heard(text, confidence) {
  text = text.trim();
  if (!text) return;
  if (mode === "sleep") {
    const m = text.match(WAKE);
    if (m) wake(text.slice(m.index + m[0].length));
    return;
  }
  if (mode === "think") { if (STOP.test(text)) interrupt(); return; }
  if (mode !== "listen") return;
  if (text.length < 3 || (confidence > 0 && confidence < 0.3 && text.split(" ").length < 3)) return;
  process(text.replace(/^(ciao |ehi |hey )?(jarvis)[,.]?\s*/i, "") || text);
}

async function process(text) {
  lastActivity = Date.now();
  $("#you").textContent = text;
  $("#you").classList.remove("live");
  if (STANDBY.test(text)) { sleepAfter = true; return speak(`Come desidera, ${S().addressAs}. Sono qui se ha bisogno.`); }
  // comandi della musica: istantanei, senza AI
  if (/\bmusica\b/i.test(text) && /\b(spegni|ferma|togli|stop|basta|interrompi)\b/i.test(text)) { music.stop(); return speak("Musica spenta."); }
  if (/\bmusica\b/i.test(text) && /\b(alza|più forte)\b/i.test(text)) { music.volume = Math.min(1, music.volume + 0.2); store.setSettings({ musicVol: Math.round(music.volume * 100) }); musicFor(mode); return speak("Alzo la musica."); }
  if (/\bmusica\b/i.test(text) && /\b(abbassa|più piano)\b/i.test(text)) { music.volume = Math.max(0.1, music.volume - 0.2); store.setSettings({ musicVol: Math.round(music.volume * 100) }); musicFor(mode); return speak("Abbasso la musica."); }
  if (/\b(metti|accendi|fai partire|riproduci|voglio|un po' di)\b.*\bmusica\b/i.test(text)) {
    if (!music.loaded) return speak(`Non ho ancora un brano, ${S().addressAs}: lo scelga nelle impostazioni, alla voce Musica.`);
    music.play(LEVELS.bed);
    return speak(pick([`Ecco un po' di musica, ${S().addressAs}.`, "Musica, maestro.", `Subito, ${S().addressAs}.`]));
  }
  const calc = tryCalc(text);
  if (calc !== null) {
    const said = `Fa ${sayNumber(calc)}, ${S().addressAs}.`;
    remember(text, said, null);
    return speak(said);
  }
  return askMind(text);
}

function remember(user, said, brain) {
  history.push({ role: "user", content: user }, { role: "assistant", content: said });
  history = history.slice(-12);
  store.afterTurn(history, brain);
}

const TOOL_LABEL = {
  add_event: "Aggiorno il calendario", delete_event: "Aggiorno il calendario", add_reminder: "Imposto il promemoria", delete_reminder: "Aggiorno i promemoria",
  add_todo: "Aggiorno la lista", complete_todo: "Aggiorno la lista", search_emails: "Consulto la posta", read_email: "Leggo l'email",
  prepare_email: "Scrivo la bozza", send_email: "Invio l'email", save_contact: "Aggiorno la rubrica", save_memory: "Memorizzo", web_search: "Cerco in rete",
};

async function askMind(text) {
  setMode("think");
  $("#thinkLabel").textContent = "Sto pensando…";
  const ctl = new AbortController();
  abortCtl = ctl;
  let buffer = "", full = "", spoke = false;
  const say = (s) => { s = s.trim(); if (!s || ctl.signal.aborted) return; spoke = true; speak(s); };
  const flush = (force) => {
    for (;;) {
      const m = buffer.match(/^[\s\S]*?[.!?…;:](?=\s|$)/);
      if (!m) break;
      let s = m[0];
      if (s.trim().length < 24) { const m2 = buffer.slice(s.length).match(/^[\s\S]*?[.!?…;:](?=\s|$)/); if (!m2) break; s += m2[0]; }
      buffer = buffer.slice(s.length);
      say(s);
    }
    if (force && buffer.trim()) { say(buffer); buffer = ""; }
  };
  const emit = (ev) => {
    if (ctl.signal.aborted) return;
    if (ev.type === "delta") { buffer += ev.text; full += ev.text; flush(false); }
    else if (ev.type === "brain") {
      showBrain(ev, !!ev.from);
      if (ev.from) { $("#thinkLabel").textContent = `Passo a ${ev.provider} ${ev.label}`; toast(`${ev.from} non disponibile: passo a ${ev.provider} ${ev.label}`); orb.burst(); }
    } else if (ev.type === "tool") { $("#thinkLabel").textContent = TOOL_LABEL[ev.name] || "Sto pensando…"; orb.burst(); }
    else if (ev.type === "changed") refresh(ev.what);
    else if (ev.type === "draft") showDraft(ev.draft);
    else if (ev.type === "memory") { toast(`Memorizzato: ${ev.text}`); scene.highlight(); }
  };
  let brain = null;
  try {
    brain = await think({ message: text, history, snap, emit, signal: ctl.signal });
    flush(true);
  } catch (e) {
    if (!ctl.signal.aborted) {
      console.warn("[mente]", e);
      flush(true);
      if (!spoke) say(`Mi perdoni, ${S().addressAs}: la connessione con i miei cervelli si è interrotta. Riprovi tra un istante.`);
    }
  } finally {
    if (abortCtl === ctl) abortCtl = null;
    if (full.trim()) remember(text, full.trim(), brain);
    if (!spoke && mode === "think") setMode("listen");
  }
}

function showBrain(b, switched) {
  const chip = $("#brainChip");
  chip.hidden = false;
  $("#brainName").textContent = `${b.provider} · ${b.label}`;
  if (switched) { chip.classList.remove("flash"); void chip.offsetWidth; chip.classList.add("flash"); }
}
function showDraft(d) {
  $("#draft").hidden = !d;
  if (!d) return;
  $("#draftTo").textContent = `A: ${d.name ? `${d.name} · ` : ""}${d.to}`;
  $("#draftSubject").textContent = d.subject;
  $("#draftBody").textContent = d.body;
}

// ---------------------------------------------------------------- pannelli
const hm = (d) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const todayEvents = () => snap.events.filter((e) => sameDay(e.start, new Date()));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderAgenda() {
  const now = new Date(), tomorrow = new Date(now.getTime() + 864e5);
  const today = todayEvents(), tom = snap.events.filter((e) => sameDay(e.start, tomorrow));
  $("#agendaDay").textContent = now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric" });
  let nextDone = false;
  const row = (e) => {
    const past = !e.allDay && e.start < now;
    const next = !past && !nextDone && !e.allDay && (nextDone = true);
    return `<li class="${past ? "past" : ""}${next ? " next" : ""}"><time>${e.allDay ? "giorno" : hm(e.start)}</time><span>${esc(e.title)}</span><i></i></li>`;
  };
  let html = today.length ? today.map(row).join("") : `<li class="empty">Nessun impegno oggi.</li>`;
  if (tom.length) html += `<li class="day">Domani</li>` + tom.slice(0, 4).map(row).join("");
  $("#agenda").innerHTML = html;
}
function renderTodos() {
  $("#todoCount").textContent = snap.todos.length ? String(snap.todos.length) : "";
  $("#todos").innerHTML = snap.todos.length
    ? snap.todos.map((t) => `<li data-id="${esc(t.id)}"><button class="check" aria-label="Fatto"></button><span>${esc(t.text)}</span><i></i></li>`).join("")
    : `<li class="empty">Niente da fare. Che lusso.</li>`;
}
function renderReminders() {
  const now = Date.now();
  const list = snap.reminders.filter((r) => r.at > now - 36e5);
  $("#remCount").textContent = list.length ? String(list.length) : "";
  const day = (d) => (sameDay(d, new Date()) ? "" : `${d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric" })} `);
  $("#reminders").innerHTML = list.length
    ? list.map((r) => `<li class="${r.at < now ? "past" : ""}" data-id="${esc(r.id)}"><time>${day(r.at)}${hm(r.at)}</time><span>${esc(r.text)}</span><button class="x" aria-label="Cancella">×</button></li>`).join("")
    : `<li class="empty">Nessun promemoria. Dica per esempio «ricordami di chiamare Marco alle 17».</li>`;
}
function renderEmails() {
  if (!data.usingGoogle()) {
    $("#emailCount").textContent = "";
    $("#emails").innerHTML = `<li class="empty">Gmail non collegato. Tocca l'ingranaggio in alto → Google.</li>`;
    return;
  }
  $("#emailCount").textContent = snap.emails.length ? `${snap.emails.length} non lette` : "";
  $("#emails").innerHTML = snap.emails.length
    ? snap.emails.map((m) => `<li data-id="${esc(m.id)}"><i class="u"></i><div><b>${esc(m.from)}</b><small>${esc(m.subject)} — ${esc(m.snippet)}</small>
        <div class="acts"><button data-act="sum">Riassumi</button><button data-act="reply">Rispondi</button><button data-act="read">Leggimela</button></div></div></li>`).join("")
    : `<li class="empty">Nessuna email non letta.</li>`;
}

const loaders = {
  agenda: async () => { snap.events = await data.events(7); renderAgenda(); },
  todos: async () => { snap.todos = await data.todos(); renderTodos(); },
  reminders: async () => { snap.reminders = await data.reminders(); renderReminders(); },
  emails: async () => { snap.emails = await data.emails("", 12); renderEmails(); },
};
const panelOf = { agenda: "#pAgenda", todos: "#pTodo", reminders: "#pRem", emails: "#pEmail" };
async function refresh(what, flash = true) {
  try {
    await loaders[what]();
    if (flash) { const p = $(panelOf[what]); p.classList.remove("flash"); void p.offsetWidth; p.classList.add("flash"); }
  } catch (e) {
    console.warn(`[${what}]`, e);
    if (e.notConnected) { toast(e.message); renderEmails(); }
  }
}
const refreshAll = () => Promise.all(Object.keys(loaders).map((w) => refresh(w, false)));

// tocchi sui pannelli
$("#todos").addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li || !e.target.closest(".check")) return;
  li.classList.add("done");
  try { await data.completeTodo(li.dataset.id); setTimeout(() => refresh("todos", false), 500); } catch (err) { li.classList.remove("done"); toast(err.message); }
});
$("#todoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inp = e.target.querySelector("input"), v = inp.value.trim();
  if (!v) return;
  inp.value = "";
  try { await data.addTodo(v); refresh("todos"); } catch (err) { toast(err.message); }
});
$("#reminders").addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li || !e.target.closest(".x")) return;
  try { await data.deleteReminder(li.dataset.id); refresh("reminders", false); } catch (err) { toast(err.message); }
});
$("#emails").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) { li.classList.toggle("open"); return; }
  const m = snap.emails.find((x) => x.id === li.dataset.id);
  if (!m) return;
  const ref = `l'email di ${m.from} con oggetto «${m.subject}» (id ${m.id})`;
  ensureStarted();
  if (mode === "speak" || mode === "think") interrupt();
  process({ sum: `Riassumimi ${ref}.`, reply: `Aiutami a rispondere a ${ref}: prima dimmi in breve cosa chiede e proponimi una risposta.`, read: `Leggimi per intero ${ref}.` }[act]);
});
$("#emailRefresh").addEventListener("click", () => refresh("emails"));
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ask]");
  if (!b) return;
  ensureStarted();
  if (mode === "speak" || mode === "think") interrupt();
  process(b.dataset.ask);
});

// ---------------------------------------------------------------- promemoria: avviso all'ora giusta
function checkReminders() {
  const now = Date.now(), fired = data.fired();
  for (const r of snap.reminders) {
    if (r.at <= now && r.at > now - 10 * 60_000 && !fired.has(r.id)) {
      data.markFired(r.id);
      toast(`⏰ ${r.text}`, true, 15000);
      if (started) {
        const line = `${S().addressAs[0].toUpperCase()}${S().addressAs.slice(1)}, le ricordo: ${r.text}.`;
        if (mode === "think") mouth.say(line); else speak(line);
      }
      renderReminders();
    }
  }
}

// ---------------------------------------------------------------- orologio e ritmi
setInterval(() => {
  const d = new Date();
  $("#clock").textContent = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  $("#date").textContent = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  const h = d.getHours(), hello = h < 5 ? "Buonanotte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
  const greet = `${hello}, ${S().name}`;
  if ($("#greet").textContent !== greet) $("#greet").textContent = greet;
  if (mode === "listen" && Date.now() - lastActivity > 40_000 && !mouth.busy) goSleep();
  if (pending && mode === "listen") { const q = pending; pending = null; process(q); }
}, 500);
setInterval(checkReminders, 15_000);
setInterval(() => { if (!document.hidden) { refresh("agenda", false); refresh("todos", false); refresh("reminders", false); } }, 60_000);
setInterval(() => { if (!document.hidden && data.usingGoogle()) refresh("emails", false); }, 120_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); });

// ---------------------------------------------------------------- avvio (serve un tocco per audio e microfono)
function ensureStarted() {
  if (started) return;
  started = true;
  mouth.unlock();
  music.unlock();
  music.volume = S().musicVol / 100;
  music.load().catch(() => {});
  ears.start();
  $("#gate").classList.add("hide");
  setMode("sleep");
  if (!ears.supported) toast("Questo browser non riconosce la voce: scriva nella barra in basso (o usi il microfono della tastiera).", false, 7000);
}
$("#gate").addEventListener("click", () => {
  ensureStarted();
  if (!hasBrain()) return openSettings();
  wake("");
});
$("#mic").addEventListener("click", () => {
  const first = !started;
  ensureStarted();
  if (!hasBrain()) return openSettings();
  ears.start();
  if (mode === "speak" || mode === "think") return interrupt();
  if (mode === "listen" && !first) return goSleep();
  if (!greeted) return wake("");
  setMode("listen");
  $("#you").textContent = "";
});
$("#ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#askInput").value.trim();
  $("#askInput").value = "";
  $("#askInput").blur();
  if (!v) return;
  ensureStarted();
  if (!hasBrain()) return openSettings();
  if (mode === "speak" || mode === "think") interrupt();
  greeted = true;
  process(v);
});

// ---------------------------------------------------------------- impostazioni
function state(id, text, kind = "") { const el = $(id); el.textContent = text; el.className = `state ${kind}`; }
async function renderChain() {
  const list = await chain();
  $("#chain").innerHTML = list.length
    ? `<i>Ordine:</i>` + list.map((b) => `<span class="${b.kind === "gemini" ? "g" : ""}">${b.provider} ${b.label}</span>`).join("<i>→</i>")
    : `<i>Nessun cervello configurato.</i>`;
}
function openSettings() {
  const k = store.keys(), s = S(), m = store.memory();
  body.classList.add("show-settings");
  $("#kAnthropic").value = k.anthropic; $("#kGemini").value = k.gemini;
  $("#kEleven").value = k.elevenlabs; $("#kVoice").value = k.elevenVoice;
  const preset = $("#kVoicePreset"), known = [...preset.options].some((o) => o.value === k.elevenVoice);
  preset.value = !k.elevenVoice ? "onwK4e9ZLuTAKqWW03F9" : known ? k.elevenVoice : "custom";
  $("#settings").classList.toggle("voice-custom", preset.value === "custom");
  $("#kModel").value = k.elevenModel;
  $("#kGid").value = k.googleClientId; $("#kGsecret").value = k.googleClientSecret;
  $("#sAddress").value = s.addressAs; $("#sName").value = s.name; $("#sCity").value = s.city;
  $("#memFacts").value = m.facts.join("\n");
  state("#sBrains", m.brains.length ? `Ultimi cervelli usati: ${m.brains.slice(0, 4).map((b) => b.label).join(", ")}` : "");
  $("#origin").textContent = location.origin;
  state("#sGoogle", google.connected() ? `Collegato · ${google.account()}` : "Non collegato", google.connected() ? "ok" : "");
  state("#sAnthropic", k.anthropic ? "Salvata" : "", k.anthropic ? "ok" : "");
  state("#sGemini", k.gemini ? "Salvata" : "", k.gemini ? "ok" : "");
  state("#sEleven", k.elevenlabs ? "Voce ElevenLabs attiva" : "Voce dell'iPad", k.elevenlabs ? "ok" : "");
  $("#settingsError").textContent = "";
  $("#musicAuto").checked = s.musicAuto;
  $("#musicVol").value = s.musicVol;
  state("#sMusic", music.loaded ? `♪ ${music.name}` : "Nessun brano scelto", music.loaded ? "ok" : "");
  renderChain();
  google.prepare().catch(() => {});
}

// ---------------------------------------------------------------- impostazioni della musica (salvate subito)
$("#musicFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  state("#sMusic", "Carico il brano…");
  try {
    await saveTrack(file);
    music.unlock();
    const wasPlaying = music.playing;
    music.stop(0.2);
    if (!(await music.load())) throw new Error("formato non supportato");
    state("#sMusic", `♪ ${music.name}`, "ok");
    if (wasPlaying) music.play(LEVELS.bed);
  } catch (err) {
    state("#sMusic", `Non riesco a usare questo brano (${err.message}). Prova un mp3.`, "err");
  }
});
$("#musicAuto").addEventListener("change", (e) => store.setSettings({ musicAuto: e.target.checked }));
$("#musicVol").addEventListener("input", (e) => {
  music.volume = Number(e.target.value) / 100;
  store.setSettings({ musicVol: Number(e.target.value) });
  musicFor(mode);
});
$("#musicTest").addEventListener("click", async () => {
  music.unlock();
  if (music.playing) { music.stop(); $("#musicTest").textContent = "Ascolta"; return; }
  if (!music.loaded && !(await music.load())) return state("#sMusic", "Prima scegli un brano.", "err");
  await music.play(LEVELS.bed * 2);
  $("#musicTest").textContent = "Ferma";
});
$("#musicDel").addEventListener("click", async () => {
  music.stop(0.3);
  await deleteTrack().catch(() => {});
  music.buffer = null; music.name = "";
  $("#musicTest").textContent = "Ascolta";
  state("#sMusic", "Brano rimosso.");
});
const closeSettings = () => body.classList.remove("show-settings");
$("#gear").addEventListener("click", openSettings);
$("#settingsClose").addEventListener("click", closeSettings);

$("#kVoicePreset").addEventListener("change", (e) => $("#settings").classList.toggle("voice-custom", e.target.value === "custom"));
function readKeyFields() {
  const preset = $("#kVoicePreset").value;
  store.setKeys({
    anthropic: $("#kAnthropic").value.trim(), gemini: $("#kGemini").value.trim(),
    elevenlabs: $("#kEleven").value.trim(), elevenVoice: preset === "custom" ? $("#kVoice").value.trim() : preset,
    elevenModel: $("#kModel").value,
    googleClientId: $("#kGid").value.trim(), googleClientSecret: $("#kGsecret").value.trim(),
  });
}
$("#settingsSave").addEventListener("click", async () => {
  const btn = $("#settingsSave");
  btn.disabled = true; btn.textContent = "Verifico…";
  $("#settingsError").textContent = "";
  try {
    const before = store.keys();
    readKeyFields();
    store.setSettings({ addressAs: $("#sAddress").value.trim() || "signore", name: $("#sName").value.trim() || "Leo", city: $("#sCity").value.trim() });
    store.setFacts($("#memFacts").value.split("\n"));
    const k = store.keys();
    let bad = false;
    if (k.anthropic && k.anthropic !== before.anthropic) {
      const r = await claude.checkKey(k.anthropic);
      state("#sAnthropic", r.ok ? "Chiave valida" : r.error, r.ok ? "ok" : "err"); bad ||= !r.ok;
    }
    if (k.gemini && k.gemini !== before.gemini) {
      const r = await gemini.checkKey(k.gemini);
      state("#sGemini", r.ok ? `Chiave valida · ${r.models.length} modelli Gemini trovati` : r.error, r.ok ? "ok" : "err"); bad ||= !r.ok;
    }
    mouth.cache.clear();
    await renderChain();
    if (!hasBrain()) { $("#settingsError").textContent = "Serve almeno una chiave: Claude o Gemini."; return; }
    if (bad) { $("#settingsError").textContent = "Controlla i campi in rosso."; return; }
    closeSettings();
    toast("Impostazioni salvate.");
    refreshAll();
  } finally {
    btn.disabled = false; btn.textContent = "Salva";
  }
});
$("#voiceTest").addEventListener("click", () => {
  readKeyFields();
  ensureStarted();
  mouth.unlock(); // siamo dentro un tocco: sblocco di nuovo l'audio
  mouth.stop();
  mouth.cache.clear();
  mouth.elevenDown = 0;
  mouth.lastError = "";
  state("#sEleven", "Provo…");
  speak(`Buonasera ${S().addressAs}. Questa è la mia voce. Spero sia di suo gradimento.`);
  setTimeout(() => {
    const k = store.keys();
    if (mouth.lastError) state("#sEleven", `${mouth.lastError}${k.elevenlabs ? " · intanto uso la voce dell'iPad" : ""}`, "err");
    else state("#sEleven", k.elevenlabs ? "Voce ElevenLabs attiva" : "Voce dell'iPad (nessuna chiave ElevenLabs)", k.elevenlabs ? "ok" : "");
  }, 4000);
});
$("#gConnect").addEventListener("click", async () => {
  readKeyFields();
  state("#sGoogle", "Si apre la finestra di Google…");
  try {
    const email = await google.connect();
    state("#sGoogle", `Collegato · ${email}`, "ok");
    toast("Google collegato: email, agenda e cose da fare ora sono sincronizzate.");
    refreshAll();
  } catch (e) {
    state("#sGoogle", e.message, "err");
  }
});
$("#gDisconnect").addEventListener("click", () => {
  google.disconnect();
  state("#sGoogle", "Scollegato: agenda e liste tornano su questo iPad.");
  refreshAll();
});
$("#exportBtn").addEventListener("click", async () => {
  readKeyFields();
  const code = store.exportAll();
  try { await navigator.clipboard.writeText(code); toast("Codice copiato. Incollalo sull'altro dispositivo (e non condividerlo con nessuno)."); }
  catch { prompt("Copia questo codice:", code); }
});
$("#importBtn").addEventListener("click", () => {
  const code = prompt("Incolla qui il codice delle impostazioni:");
  if (!code) return;
  try { store.importAll(code); toast("Impostazioni importate."); openSettings(); refreshAll(); }
  catch { toast("Codice non valido."); }
});

// ---------------------------------------------------------------- partenza
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
setMode("boot");
renderAgenda(); renderTodos(); renderReminders(); renderEmails();
refreshAll().then(checkReminders);
if (!hasBrain()) $("#gateText").textContent = "Tocca per configurare";
