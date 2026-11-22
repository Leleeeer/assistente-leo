// Spotify: Jarvis comanda l'app Spotify (Spotify Connect). Serve Spotify Premium.
// Collegamento sicuro senza password né segreti: Spotify chiede il permesso e restituisce un "lasciapassare"
// che resta solo su questo iPad (metodo PKCE).
import { keys, load, save } from "./store.js";

const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read";
const API = "https://api.spotify.com/v1";
const auth = () => load("spotify", {});
export const connected = () => !!auth().refresh;
export const account = () => auth().name || "";
export const redirectUri = () => location.origin + location.pathname;
export function disconnect() { save("spotify", {}); }

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// 1) porta alla pagina di Spotify per dare il permesso
export async function connect() {
  const clientId = keys().spotifyClientId;
  if (!clientId) throw new Error("Inserisci prima il Client ID di Spotify.");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("jarvis:spotifyVerifier", verifier);
  try { localStorage.setItem("jarvis:spotifyVerifier", verifier); } catch {}
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri(), code_challenge_method: "S256", code_challenge: challenge, scope: SCOPES });
  location.href = `https://accounts.spotify.com/authorize?${q}`;
}

// 2) al ritorno da Spotify: completa il collegamento (da chiamare all'avvio della pagina)
export async function finishConnect() {
  const u = new URL(location.href);
  const code = u.searchParams.get("code"), err = u.searchParams.get("error");
  if (!code && !err) return null;
  history.replaceState(null, "", redirectUri()); // pulisce l'indirizzo
  if (err) throw new Error(err === "access_denied" ? "Collegamento a Spotify annullato." : `Spotify: ${err}`);
  const verifier = sessionStorage.getItem("jarvis:spotifyVerifier") || localStorage.getItem("jarvis:spotifyVerifier");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), client_id: keys().spotifyClientId, code_verifier: verifier || "" });
  save("spotify", { refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 });
  const me = await api("/me");
  save("spotify", { ...auth(), name: me.display_name || me.id, premium: me.product === "premium" });
  return { name: me.display_name || me.id, premium: me.product === "premium" };
}

async function tokenRequest(params) {
  const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `Spotify ${r.status}`), { code: j.error });
  return j;
}
let refreshing = null;
async function token(force = false) {
  const a = auth();
  if (!a.refresh) throw Object.assign(new Error("Spotify non è collegato."), { notConnected: true });
  if (!force && a.access && Date.now() < a.exp) return a.access;
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: a.refresh, client_id: keys().spotifyClientId })
    .then((t) => { save("spotify", { ...auth(), access: t.access_token, refresh: t.refresh_token || a.refresh, exp: Date.now() + (t.expires_in - 60) * 1000 }); return t.access_token; })
    .catch((e) => { if (e.code === "invalid_grant") save("spotify", {}); throw Object.assign(new Error("Il permesso di Spotify è scaduto: ricollegalo dalle impostazioni."), { notConnected: true }); })
    .finally(() => { refreshing = null; });
  return refreshing;
}
async function api(path, opts = {}, retry = true) {
  const r = await fetch(path.startsWith("http") ? path : API + path, { ...opts, headers: { Authorization: `Bearer ${await token()}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
  if (r.status === 401 && retry) { await token(true); return api(path, opts, false); }
  if (r.status === 204 || r.status === 202) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const reason = j?.error?.reason || "";
    throw Object.assign(new Error(
      reason === "NO_ACTIVE_DEVICE" || r.status === 404 ? "Nessun dispositivo Spotify attivo: apri l'app Spotify sull'iPad (o sul telefono) e riprova."
      : reason === "PREMIUM_REQUIRED" || r.status === 403 ? "Per comandare Spotify serve Spotify Premium."
      : j?.error?.message || `Spotify ${r.status}`), { status: r.status });
  }
  return j;
}

// ---------------------------------------------------------------- dispositivo su cui suonare
async function device() {
  const { devices = [] } = (await api("/me/player/devices")) || {};
  if (!devices.length) throw new Error("Non vedo l'app Spotify aperta da nessuna parte: aprila sull'iPad (basta un attimo, poi torna su Jarvis) e riprova.");
  return devices.find((d) => d.is_active) || devices.find((d) => /ipad|tablet/i.test(d.type + d.name)) || devices[0];
}

// ---------------------------------------------------------------- comandi
export async function nowPlaying() {
  const s = await api("/me/player?additional_types=episode");
  if (!s?.item) return null;
  return { playing: s.is_playing, title: s.item.name, artist: (s.item.artists || []).map((a) => a.name).join(", ") || s.item.show?.name || "", device: s.device?.name || "", volume: s.device?.volume_percent ?? null, supportsVolume: !!s.device?.supports_volume };
}

// kind: "playlist" | "track" | "artist" | "album" | "" (Jarvis decide). Cerca prima tra le playlist dell'utente.
export async function play(query, kind = "") {
  const d = await device();
  query = String(query || "").trim();
  if (!query) { await api(`/me/player/play?device_id=${d.id}`, { method: "PUT" }); return `Riprendo la musica su ${d.name}.`; }
  if (!kind || kind === "playlist") {
    const mine = (await api("/me/playlists?limit=50"))?.items || [];
    const q = query.toLowerCase();
    const p = mine.find((x) => x?.name?.toLowerCase() === q) || mine.find((x) => x?.name?.toLowerCase().includes(q));
    if (p) { await api(`/me/player/play?device_id=${d.id}`, { method: "PUT", body: JSON.stringify({ context_uri: p.uri }) }); return `Metto la tua playlist «${p.name}» su ${d.name}.`; }
  }
  if (/^(brani|canzoni) (che mi piacciono|preferit)/i.test(query)) {
    const liked = (await api("/me/tracks?limit=50"))?.items || [];
    if (liked.length) { await api(`/me/player/play?device_id=${d.id}`, { method: "PUT", body: JSON.stringify({ uris: liked.map((x) => x.track.uri) }) }); return "Metto i tuoi brani preferiti."; }
  }
  const types = kind && kind !== "playlist" ? kind : "track,artist,playlist,album";
  const res = await api(`/search?${new URLSearchParams({ q: query, type: types, limit: "5", market: "from_token" })}`);
  const first = (k) => (res?.[`${k}s`]?.items || []).filter(Boolean)[0];
  const order = kind ? [kind] : ["track", "artist", "playlist", "album"];
  // con la ricerca libera: se il nome coincide con un artista preferisco l'artista, altrimenti il brano
  const artist = first("artist");
  if (!kind && artist && artist.name.toLowerCase() === query.toLowerCase()) order.unshift("artist");
  for (const k of order) {
    const it = first(k);
    if (!it) continue;
    const body = k === "track" ? { uris: [it.uri] } : { context_uri: it.uri };
    await api(`/me/player/play?device_id=${d.id}`, { method: "PUT", body: JSON.stringify(body) });
    const who = k === "track" ? ` di ${(it.artists || []).map((a) => a.name).join(", ")}` : "";
    return `Metto ${{ track: "il brano", artist: "l'artista", playlist: "la playlist", album: "l'album" }[k]} «${it.name}»${who} su ${d.name}.`;
  }
  return `Su Spotify non trovo «${query}».`;
}

export async function control(action) {
  const s = await api("/me/player");
  const id = s?.device?.id;
  if (!id && action !== "resume") throw new Error("Spotify non sta suonando su nessun dispositivo.");
  const dev = id ? `?device_id=${id}` : "";
  switch (action) {
    case "pause": await api(`/me/player/pause${dev}`, { method: "PUT" }); return "Musica in pausa.";
    case "resume": { const d = id ? s.device : await device(); await api(`/me/player/play?device_id=${d.id}`, { method: "PUT" }); return "Riprendo."; }
    case "next": await api(`/me/player/next${dev}`, { method: "POST" }); return "Brano successivo.";
    case "previous": await api(`/me/player/previous${dev}`, { method: "POST" }); return "Brano precedente.";
    case "volume_up": case "volume_down": {
      if (!s.device.supports_volume) return "Da qui non posso cambiare il volume di quel dispositivo: usa i tasti del volume.";
      const v = Math.max(0, Math.min(100, (s.device.volume_percent ?? 50) + (action === "volume_up" ? 15 : -15)));
      await api(`/me/player/volume?volume_percent=${v}${id ? `&device_id=${id}` : ""}`, { method: "PUT" });
      return `Volume al ${v} per cento.`;
    }
    case "shuffle": await api(`/me/player/shuffle?state=true${id ? `&device_id=${id}` : ""}`, { method: "PUT" }); return "Riproduzione casuale attivata.";
  }
  return "Comando non riconosciuto.";
}

// mentre Jarvis parla abbassa Spotify (solo sui dispositivi che lo permettono), poi lo rialza
let ducked = null;
export async function duck(on) {
  try {
    if (on && ducked === null) {
      const s = await api("/me/player");
      if (!s?.is_playing || !s.device?.supports_volume) return;
      ducked = { v: s.device.volume_percent, id: s.device.id };
      await api(`/me/player/volume?volume_percent=${Math.round(ducked.v * 0.35)}&device_id=${ducked.id}`, { method: "PUT" });
    } else if (!on && ducked) {
      const d = ducked; ducked = null;
      await api(`/me/player/volume?volume_percent=${d.v}&device_id=${d.id}`, { method: "PUT" });
    }
  } catch { ducked = null; }
}
