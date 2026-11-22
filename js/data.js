// Agenda, cose da fare, promemoria ed email: se Google è collegato usa Google,
// altrimenti salva tutto qui sull'iPad (così Jarvis funziona anche prima di collegarlo).
import * as g from "./google.js";
import { load, save } from "./store.js";

const uid = () => Math.random().toString(36).slice(2, 10);
const local = () => ({ events: [], todos: [], reminders: [], ...load("local", {}) });
const saveLocal = (l) => save("local", l);
export const usingGoogle = () => g.connected();

// ---------------------------------------------------------------- agenda
export async function events(days = 7) {
  if (usingGoogle()) return g.events(days);
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 864e5);
  return local().events.map((e) => ({ ...e, start: new Date(e.start) })).filter((e) => e.start >= from && e.start < to).sort((a, b) => a.start - b.start);
}
export async function addEvent(ev) {
  if (usingGoogle()) return g.addEvent(ev);
  const l = local();
  l.events.push({ id: uid(), title: ev.title, start: ev.start.toISOString(), allDay: ev.allDay, minutes: ev.minutes });
  saveLocal(l);
}
export async function deleteEvent(id) {
  if (usingGoogle()) return g.deleteEvent(id);
  const l = local();
  l.events = l.events.filter((e) => e.id !== id);
  saveLocal(l);
}

// ---------------------------------------------------------------- cose da fare
export async function todos() {
  if (usingGoogle()) return g.todos();
  return local().todos;
}
export async function addTodo(text) {
  if (usingGoogle()) return g.addTodo(text);
  const l = local();
  l.todos.push({ id: uid(), text });
  saveLocal(l);
}
export async function completeTodo(id) {
  if (usingGoogle()) return g.completeTodo(id);
  const l = local();
  l.todos = l.todos.filter((t) => t.id !== id);
  saveLocal(l);
}

// ---------------------------------------------------------------- promemoria
export async function reminders() {
  const list = usingGoogle() ? await g.reminders() : local().reminders.map((r) => ({ ...r, at: new Date(r.at) }));
  return list.sort((a, b) => a.at - b.at);
}
export async function addReminder(text, at) {
  if (usingGoogle()) return g.addEvent({ title: text, start: at, minutes: 15, reminder: true });
  const l = local();
  l.reminders.push({ id: uid(), text, at: at.toISOString() });
  saveLocal(l);
}
export async function deleteReminder(id) {
  if (usingGoogle()) return g.deleteEvent(id);
  const l = local();
  l.reminders = l.reminders.filter((r) => r.id !== id);
  saveLocal(l);
}
// promemoria già annunciati a voce (per non ripeterli)
export const fired = () => new Set(load("fired", []));
export function markFired(id) { save("fired", [...fired(), id].slice(-200)); }

// ---------------------------------------------------------------- email (solo con Google)
export const emails = (q, max) => (usingGoogle() ? g.emails(q, max) : Promise.resolve([]));
export const readEmail = (id) => g.readEmail(id);
export const sendEmail = (m) => g.sendEmail(m);
