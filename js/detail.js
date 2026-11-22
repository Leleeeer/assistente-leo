// Sezioni a tutto schermo che si aprono toccando un widget: Calendario, Mail, Da fare, Promemoria.
// Come le app di Apple: barra in alto con «‹ Jarvis» per tornare indietro.
import * as data from "./data.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hm = (d) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLong = (d) => d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
function at(date, time) {
  const [y, m, d] = date.split("-").map(Number), [h, mi] = (time || "0:0").split(":").map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0);
}

let ctx = null; // { ask(text), refresh(what), toast(text) }
let current = null;
const TITLES = { agenda: "Calendario", emails: "Mail", todos: "Da fare", reminders: "Promemoria" };

export function setupDetail(c) {
  ctx = c;
  $("#detailBack").addEventListener("click", closeDetail);
  addEventListener("keydown", (e) => e.key === "Escape" && closeDetail());
}
export function closeDetail() {
  document.body.classList.remove("show-detail");
  if (current) ctx.refresh(current);
  current = null;
}
export function openDetail(kind) {
  current = kind;
  $("#detailTitle").textContent = TITLES[kind];
  $("#detailBody").innerHTML = `<p class="loading">Carico…</p>`;
  document.body.classList.add("show-detail");
  ({ agenda: calendar, emails: mail, todos: todoView, reminders: reminderView })[kind]();
}
// chiede a Jarvis e torna alla schermata principale
function ask(text) { closeDetail(); ctx.ask(text); }
async function act(fn, what) {
  try { await fn(); } catch (e) { ctx.toast(e.message); }
  ctx.refresh(what);
}

// ---------------------------------------------------------------- CALENDARIO: mese + giorno scelto
const cal = { month: null, sel: null, events: [] };
async function calendar() {
  const today = new Date();
  cal.month ??= new Date(today.getFullYear(), today.getMonth(), 1);
  cal.sel ??= today;
  const first = cal.month, days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  try { cal.events = await data.events(days, first); } catch (e) { cal.events = []; ctx.toast(e.message); }
  if (current !== "agenda") return;
  const lead = (first.getDay() + 6) % 7; // lunedì come primo giorno
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<span></span>`);
  for (let d = 1; d <= days; d++) {
    const day = new Date(first.getFullYear(), first.getMonth(), d);
    const has = cal.events.some((e) => sameDay(e.start, day));
    cells.push(`<button class="d${sameDay(day, today) ? " today" : ""}${sameDay(day, cal.sel) ? " sel" : ""}" data-day="${d}">${d}${has ? "<i></i>" : ""}</button>`);
  }
  const list = cal.events.filter((e) => sameDay(e.start, cal.sel));
  $("#detailBody").innerHTML = `
    <div class="split">
      <section class="card month">
        <header><button class="link" data-m="-1" aria-label="Mese precedente">‹</button>
          <b>${first.toLocaleDateString("it-IT", { month: "long", year: "numeric" })}</b>
          <button class="link" data-m="1" aria-label="Mese successivo">›</button></header>
        <div class="wd"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div>
        <div class="grid">${cells.join("")}</div>
        <button class="ghost today-btn" data-today>Oggi</button>
      </section>
      <section class="card">
        <h4>${esc(dayLong(cal.sel))}</h4>
        <ol class="rows">${list.length ? list.map((e) => `<li><time>${e.allDay ? "giorno" : hm(e.start)}</time><span>${esc(e.title)}${e.location ? `<small>${esc(e.location)}</small>` : ""}</span><button class="x" data-del="${esc(e.id)}" aria-label="Cancella">×</button></li>`).join("") : `<li class="empty">Nessun impegno.</li>`}</ol>
        <form class="addform" id="evForm">
          <h5>Nuovo impegno</h5>
          <input name="title" placeholder="Titolo" required autocomplete="off">
          <div class="two"><input name="time" type="time"><select name="minutes"><option value="30">30 min</option><option value="60" selected>1 ora</option><option value="90">1 ora e ½</option><option value="120">2 ore</option><option value="0">Tutto il giorno</option></select></div>
          <button class="primary">Aggiungi al ${cal.sel.getDate()}</button>
        </form>
      </section>
    </div>`;
  const body = $("#detailBody");
  body.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { cal.month = new Date(first.getFullYear(), first.getMonth() + Number(b.dataset.m), 1); calendar(); }));
  body.querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => { cal.sel = new Date(first.getFullYear(), first.getMonth(), Number(b.dataset.day)); calendar(); }));
  body.querySelector("[data-today]").onclick = () => { cal.month = null; cal.sel = null; calendar(); };
  body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Cancellare questo impegno?")) return;
    await act(() => data.deleteEvent(b.dataset.del), "agenda");
    calendar();
  }));
  $("#evForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), minutes = Number(f.get("minutes")), time = f.get("time");
    const allDay = minutes === 0 || !time;
    await act(() => data.addEvent({ title: f.get("title").trim(), start: at(ymd(cal.sel), allDay ? "" : time), minutes: minutes || 60, allDay }), "agenda");
    calendar();
  };
}

// ---------------------------------------------------------------- MAIL: elenco a sinistra, email aperta a destra
const mailState = { filter: "unread", list: [], open: null };
async function mail() {
  if (!data.usingGoogle()) {
    $("#detailBody").innerHTML = `<div class="card center"><p>Gmail non è ancora collegato.</p><p class="sub">Apri l'ingranaggio in alto → Google → Collega Google.</p></div>`;
    return;
  }
  try { mailState.list = await data.emails(mailState.filter === "unread" ? "" : "in:inbox", 25); } catch (e) { mailState.list = []; ctx.toast(e.message); }
  if (current !== "emails") return;
  renderMail();
}
function renderMail() {
  const m = mailState.open;
  $("#detailBody").innerHTML = `
    <div class="split mail">
      <section class="card">
        <div class="seg"><button class="${mailState.filter === "unread" ? "on" : ""}" data-f="unread">Non lette</button><button class="${mailState.filter === "all" ? "on" : ""}" data-f="all">Tutte</button></div>
        <ol class="rows msgs">${mailState.list.length ? mailState.list.map((x) => `<li data-id="${esc(x.id)}" class="${x.unread ? "unread" : ""}${m?.id === x.id ? " sel" : ""}"><i class="u"></i><div><b>${esc(x.from)}</b><time>${x.date.toLocaleDateString("it-IT", { day: "numeric", month: "short" })}</time><em>${esc(x.subject)}</em><small>${esc(x.snippet)}</small></div></li>`).join("") : `<li class="empty">Nessuna email.</li>`}</ol>
      </section>
      <section class="card reader">${m ? `
        <header><b>${esc(m.from)}</b><small>${esc(m.fromEmail)} · ${esc(dayLong(m.date))} ${hm(m.date)}</small><h4>${esc(m.subject)}</h4></header>
        <div class="acts"><button data-a="sum">Riassumi</button><button data-a="reply">Rispondi</button><button data-a="read">Leggimela</button></div>
        <pre>${esc(m.text || "(email senza testo)")}</pre>` : `<p class="sub center">Scegli un'email dall'elenco.</p>`}
      </section>
    </div>`;
  const body = $("#detailBody");
  body.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { mailState.filter = b.dataset.f; mailState.open = null; mail(); }));
  body.querySelectorAll(".msgs li[data-id]").forEach((li) => (li.onclick = async () => {
    li.classList.add("sel");
    try {
      mailState.open = await data.readEmail(li.dataset.id);
      const x = mailState.list.find((y) => y.id === li.dataset.id);
      if (x) x.unread = false;
      renderMail();
    } catch (e) { ctx.toast(e.message); }
  }));
  if (m) body.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
    const ref = `l'email di ${m.from} con oggetto «${m.subject}» (id ${m.id})`;
    ask({ sum: `Riassumimi ${ref}.`, reply: `Aiutami a rispondere a ${ref}: prima dimmi in breve cosa chiede e proponimi una risposta.`, read: `Leggimi per intero ${ref}.` }[b.dataset.a]);
  }));
}

// ---------------------------------------------------------------- DA FARE
async function todoView() {
  let list = [];
  try { list = await data.todos(); } catch (e) { ctx.toast(e.message); }
  if (current !== "todos") return;
  $("#detailBody").innerHTML = `
    <section class="card single">
      <form class="addform inline" id="tdForm"><input name="text" placeholder="Nuova cosa da fare" required autocomplete="off"><button class="primary">Aggiungi</button></form>
      ${data.usingCentro() ? `<p class="sub">Dal tuo centro di controllo: le modifiche si vedono anche lì.</p>` : ""}
      <ol class="rows big">${list.length ? list.map((t) => `<li class="todo"><button class="check" data-done="${esc(t.id)}" aria-label="Fatto"></button><span>${t.importante ? '<b class="star">★</b> ' : ""}${esc(t.text)}${t.descrizione ? `<small>${esc(t.descrizione)}</small>` : ""}${t.quando ? `<small>${esc(dayLong(t.quando))}${t.quando.getHours() || t.quando.getMinutes() ? ` · ${hm(t.quando)}` : ""}</small>` : ""}</span>${data.usingCentro() ? `<select class="stato-sel" data-st="${esc(t.id)}">${["Da fare", "In corso", "In revisione", "Bloccato", "Completato"].map((x) => `<option${x === t.stato ? " selected" : ""}>${x}</option>`).join("")}</select>` : ""}<button class="x" data-del="${esc(t.id)}" aria-label="Cancella">×</button></li>`).join("") : `<li class="empty">Niente da fare. Che lusso.</li>`}</ol>
    </section>`;
  const body = $("#detailBody");
  body.querySelectorAll("[data-done]").forEach((b) => (b.onclick = async () => { b.closest("li").classList.add("done"); await act(() => data.completeTodo(b.dataset.done), "todos"); setTimeout(todoView, 400); }));
  body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (!confirm("Eliminare questa attività?")) return; await act(() => data.deleteTodo(b.dataset.del), "todos"); todoView(); }));
  body.querySelectorAll("[data-st]").forEach((sel) => (sel.onchange = async () => { await act(() => data.setTodoStatus(sel.dataset.st, sel.value), "todos"); todoView(); }));
  $("#tdForm").onsubmit = async (e) => { e.preventDefault(); const v = new FormData(e.target).get("text").trim(); if (!v) return; await act(() => data.addTodo(v), "todos"); todoView(); };
}

// ---------------------------------------------------------------- PROMEMORIA
async function reminderView() {
  let list = [];
  try { list = await data.reminders(); } catch (e) { ctx.toast(e.message); }
  if (current !== "reminders") return;
  const now = Date.now(), next = list.filter((r) => r.at >= now), past = list.filter((r) => r.at < now).reverse();
  const row = (r) => `<li class="${r.at < now ? "past" : ""}"><time>${sameDay(r.at, new Date()) ? "oggi" : r.at.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })} ${hm(r.at)}</time><span>${esc(r.text)}</span><button class="x" data-del="${esc(r.id)}" aria-label="Cancella">×</button></li>`;
  const inHour = new Date(now + 36e5);
  $("#detailBody").innerHTML = `
    <section class="card single">
      <form class="addform" id="rmForm">
        <h5>Nuovo promemoria</h5>
        <input name="text" placeholder="Cosa devo ricordarti?" required autocomplete="off">
        <div class="two"><input name="date" type="date" value="${ymd(inHour)}" required><input name="time" type="time" value="${String(inHour.getHours()).padStart(2, "0")}:00" required></div>
        <button class="primary">Crea promemoria</button>
      </form>
      <h4>In arrivo</h4>
      <ol class="rows big">${next.length ? next.map(row).join("") : `<li class="empty">Nessun promemoria in arrivo.</li>`}</ol>
      ${past.length ? `<h4>Passati</h4><ol class="rows big">${past.slice(0, 10).map(row).join("")}</ol>` : ""}
    </section>`;
  const body = $("#detailBody");
  body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { await act(() => data.deleteReminder(b.dataset.del), "reminders"); reminderView(); }));
  $("#rmForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await act(() => data.addReminder(f.get("text").trim(), at(f.get("date"), f.get("time"))), "reminders");
    ctx.toast("Promemoria creato.");
    reminderView();
  };
}
