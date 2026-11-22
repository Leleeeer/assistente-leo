// Collegamento all'account Google: Gmail (email), Google Calendar (agenda e promemoria), Google Tasks (cose da fare).
// L'accesso si fa una volta con il pulsante "Collega Google"; poi Jarvis rinnova da solo il permesso.
import { keys, load, save } from "./store.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
].join(" ");
const TAG = "jarvis"; // segno lasciato sugli eventi che sono promemoria

const auth = () => load("google", {});
export const connected = () => !!auth().refresh;
export const account = () => auth().email || "";
export function disconnect() { save("google", {}); }

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = ok;
    s.onerror = () => ko(new Error("Non riesco a raggiungere Google."));
    document.head.appendChild(s);
  });
}
// Va chiamata subito dopo un tocco (l'iPad apre la finestra di Google solo così).
let gisReady = null;
export const prepare = () => (gisReady ??= loadGis().catch((e) => { gisReady = null; throw e; }));

export async function connect() {
  const { googleClientId: client_id, googleClientSecret: client_secret } = keys();
  if (!client_id || !client_secret) throw new Error("Inserisci prima ID client e segreto client di Google.");
  await prepare();
  const code = await new Promise((ok, ko) => {
    window.google.accounts.oauth2
      .initCodeClient({
        client_id, scope: SCOPES, ux_mode: "popup", select_account: true,
        callback: (r) => (r.code ? ok(r.code) : ko(new Error(r.error_description || r.error || "Accesso annullato."))),
        error_callback: (e) => ko(new Error(e?.type === "popup_closed" ? "Finestra di Google chiusa prima di finire." : e?.message || "Accesso non riuscito.")),
      })
      .requestCode();
  });
  const t = await tokenRequest({ code, client_id, client_secret, redirect_uri: "postmessage", grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("Google non ha dato il permesso permanente: scollega Jarvis dal tuo account Google (myaccount.google.com/permissions) e riprova.");
  save("google", { refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 });
  const me = await api("https://gmail.googleapis.com/gmail/v1/users/me/profile");
  save("google", { ...auth(), email: me.emailAddress });
  return me.emailAddress;
}

async function tokenRequest(params) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `Google ${r.status}`), { status: r.status, code: j.error });
  return j;
}

let refreshing = null;
async function accessToken(force = false) {
  const a = auth();
  if (!a.refresh) throw Object.assign(new Error("Google non è collegato."), { notConnected: true });
  if (!force && a.access && Date.now() < a.exp) return a.access;
  refreshing ??= (async () => {
    const { googleClientId: client_id, googleClientSecret: client_secret } = keys();
    try {
      const t = await tokenRequest({ client_id, client_secret, refresh_token: a.refresh, grant_type: "refresh_token" });
      save("google", { ...auth(), access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 });
      return t.access_token;
    } catch (e) {
      if (e.code === "invalid_grant") { save("google", {}); throw Object.assign(new Error("Il permesso di Google è scaduto: ricollega Google dalle impostazioni."), { notConnected: true }); }
      throw e;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

async function api(url, opts = {}, retry = true) {
  const r = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(opts.body ? { "Content-Type": "application/json" } : {}), ...opts.headers },
  });
  if (r.status === 401 && retry) { await accessToken(true); return api(url, opts, false); }
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Google ${r.status}`), { status: r.status });
  return j;
}

// ---------------------------------------------------------------- Calendar
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const startOf = (e) => new Date(e.start?.dateTime || `${e.start?.date}T00:00:00`);

export async function events(days = 7) {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 864e5);
  const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" });
  const j = await api(`${CAL}?${q}`);
  return (j.items || [])
    .filter((e) => e.extendedProperties?.private?.[TAG] !== "promemoria")
    .map((e) => ({ id: e.id, title: e.summary || "(senza titolo)", start: startOf(e), allDay: !e.start?.dateTime, location: e.location || "" }));
}
export async function addEvent({ title, start, minutes = 60, allDay = false, reminder = false }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const end = new Date(start.getTime() + (allDay ? 864e5 : minutes * 6e4));
  const d = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const body = {
    summary: title,
    start: allDay ? { date: d(start) } : { dateTime: start.toISOString(), timeZone: tz },
    end: allDay ? { date: d(end) } : { dateTime: end.toISOString(), timeZone: tz },
    ...(reminder ? { extendedProperties: { private: { [TAG]: "promemoria" } }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] }, transparency: "transparent" } : {}),
  };
  return api(CAL, { method: "POST", body: JSON.stringify(body) });
}
export const deleteEvent = (id) => api(`${CAL}/${encodeURIComponent(id)}`, { method: "DELETE" });

export async function reminders() {
  const from = new Date(Date.now() - 864e5);
  const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: new Date(Date.now() + 30 * 864e5).toISOString(), singleEvents: "true", orderBy: "startTime", privateExtendedProperty: `${TAG}=promemoria`, maxResults: "50" });
  const j = await api(`${CAL}?${q}`);
  return (j.items || []).map((e) => ({ id: e.id, text: e.summary || "", at: startOf(e) }));
}

// ---------------------------------------------------------------- Tasks
const TASKS = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks";
export async function todos() {
  const j = await api(`${TASKS}?showCompleted=false&maxResults=100`);
  return (j.items || []).filter((t) => t.title?.trim()).map((t) => ({ id: t.id, text: t.title, due: t.due || null }));
}
export const addTodo = (text) => api(TASKS, { method: "POST", body: JSON.stringify({ title: text }) });
export const completeTodo = (id) => api(`${TASKS}/${id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
export const deleteTodo = (id) => api(`${TASKS}/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------- Gmail
const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
const header = (m, name) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
function sender(from) {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim() || m[2], email: m[2] } : { name: from, email: from };
}
function summary(m) {
  const f = sender(header(m, "From"));
  return { id: m.id, threadId: m.threadId, from: f.name, fromEmail: f.email, subject: header(m, "Subject") || "(senza oggetto)", date: new Date(Number(m.internalDate)), snippet: decodeEntities(m.snippet || ""), unread: (m.labelIds || []).includes("UNREAD") };
}
function decodeEntities(s) {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

// query in stile Gmail; vuota = non lette in arrivo
export async function emails(query = "", max = 10) {
  const q = new URLSearchParams({ q: query || "is:unread in:inbox", maxResults: String(max) });
  const list = await api(`${GM}/messages?${q}`);
  const ids = (list.messages || []).map((m) => m.id);
  const out = await Promise.all(ids.map((id) => api(`${GM}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)));
  return out.map(summary);
}

function b64decode(data) {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function bodyText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return b64decode(part.body.data);
  for (const p of part.parts || []) { const t = bodyText(p); if (t) return t; }
  if (part.mimeType === "text/html" && part.body?.data) {
    const d = new DOMParser().parseFromString(b64decode(part.body.data), "text/html");
    return d.body?.innerText || d.body?.textContent || "";
  }
  return "";
}
export async function readEmail(id, markRead = true) {
  const m = await api(`${GM}/messages/${encodeURIComponent(id)}?format=full`);
  if (markRead && (m.labelIds || []).includes("UNREAD"))
    api(`${GM}/messages/${m.id}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) }).catch(() => {});
  return { ...summary(m), messageId: header(m, "Message-ID") || header(m, "Message-Id"), references: header(m, "References"), text: bodyText(m.payload).replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000) };
}

const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`);
export async function sendEmail({ to, subject, body, reply }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${encWord(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    ...(reply?.messageId ? [`In-Reply-To: ${reply.messageId}`, `References: ${[reply.references, reply.messageId].filter(Boolean).join(" ")}`] : []),
    "",
    btoa(unescape(encodeURIComponent(body))).replace(/.{76}/g, "$&\r\n"),
  ];
  const raw = btoa(lines.join("\r\n")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return api(`${GM}/messages/send`, { method: "POST", body: JSON.stringify({ raw, ...(reply?.threadId ? { threadId: reply.threadId } : {}) }) });
}
