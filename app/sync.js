/* Sincronizzazione cifrata tra i dispositivi (PC, telefono) tramite ntfy.sh.
   ntfy vede solo testo cifrato su un canale dal nome casuale; la chiave resta sui dispositivi.
   Tipi di messaggio:
     data  – i dati della dashboard (da PC o dallo script pubblica-dati)
     fatto – una cosa da fare segnata/tolta come fatta
     conv  – righe della conversazione con Jarvis
     ctl   – inizio/fine/azzeramento conversazione (per passare da un dispositivo all'altro) */
(() => {
"use strict";
const J = window.J, store = J.store;
const HOST = (window.JARVIS_CONFIG.RELAY || "https://ntfy.sh").replace(/\/$/, "");
const DEV = (() => { let d = store.get("jarvis-v2-dev"); if (!d) { d = J.rnd(8); store.set("jarvis-v2-dev", d); } return d; })();
const RIPUBBLICA_DOPO = 6 * 3600e3;   /* ntfy tiene i messaggi 12 ore: se nessuno ha mandato i dati da 6 ore, li rimanda chi li ha */

const S = { sid: null, lines: new Map(), lastActivity: 0, active: null, activeAt: 0, activeName: "" };
const seen = new Set(), parts = new Map();
let K = null, es = null, lastId = null, enabled = false, status = "non collegata", lastDataMsg = 0;
let myActive = false, mySid = null, ownStartSeen = false, ownStartTime = 0, seq = 0, buf = [], flushT = null, stopWire = null, byeSent = false;
const hooks = { change() {}, takeover() {}, data() {}, fatto() {} };

async function wire(obj) {
  const s = await J.seal(K.aes, obj), id = J.rnd(8), n = Math.ceil(s.length / 3000) || 1, out = [];
  for (let i = 0; i < n; i++) out.push(JSON.stringify({ a: id, i, n, p: s.slice(i * 3000, (i + 1) * 3000) }));
  return out;
}
async function post(texts) {
  for (const t of texts) {
    let ok = false;
    for (let k = 0; k < 4 && !ok; k++) {
      try { const r = await fetch(HOST + "/" + K.topic, { method: "POST", body: t }); ok = r.ok; } catch {}
      if (!ok) await J.sleep(600 * (k + 1));
    }
    if (!ok) { setStatus("offline"); return false; }
  }
  setStatus("attiva");
  return true;
}
let q = Promise.resolve();
/* restituisce true solo se l'invio è andato davvero a buon fine */
const publish = obj => (q = q.then(async () => { if (!enabled) return false; try { return await post(await wire(obj)); } catch { return false; } }));

function setStatus(s) { status = s; hooks.change(); }

/* ---- ricezione ---- */
let iq = Promise.resolve();
const ingest = m => (iq = iq.then(() => ingestOne(m)).catch(() => {}));
async function ingestOne(m) {
  if (!m || m.event !== "message" || !m.message || seen.has(m.id)) return;
  seen.add(m.id); lastId = m.id;
  if (seen.size > 2000) seen.delete(seen.values().next().value);
  let w; try { w = JSON.parse(m.message); } catch { return; }
  if (!w || !w.a || typeof w.p !== "string" || !(w.n >= 1 && w.n <= 50) || !(w.i >= 0 && w.i < w.n)) return;
  const now = Date.now();
  for (const [k, e] of parts) if (now - e.t > 120e3) parts.delete(k);
  let e = parts.get(w.a); if (!e) { e = { n: w.n, p: [], t: now }; parts.set(w.a, e); }
  e.p[w.i] = w.p;
  if (e.p.filter(x => x != null).length < e.n) return;
  parts.delete(w.a);
  let obj; try { obj = await J.unseal(K.aes, e.p.join("")); } catch { return; }   /* chi non ha la chiave non può né leggere né falsificare */
  apply(obj, (m.time || 0) * 1000);
}
const lineKey = (o, i) => o.dev + ":" + o.sid + ":" + (o.seq0 + i);
function apply(o, t) {
  if (!o || typeof o !== "object") return;
  if (o.t === "conv" && Array.isArray(o.lines)) {
    S.sid = o.sid;
    let map = S.lines.get(o.sid); if (!map) { map = new Map(); S.lines.set(o.sid, map); }
    o.lines.forEach((l, i) => { const k = lineKey(o, i); if (!map.has(k)) map.set(k, { r: l.r, x: String(l.x || ""), dev: o.dev, dn: o.dn, n: o.seq0 + i, t }); });
    S.lastActivity = Math.max(S.lastActivity, t);
  } else if (o.t === "ctl") {
    S.lastActivity = Math.max(S.lastActivity, t);
    if (o.k === "reset") { S.sid = o.sid; if (!S.lines.has(o.sid)) S.lines.set(o.sid, new Map()); S.active = null; S.activeAt = t; if (myActive && o.dev !== DEV) hooks.takeover(o.dn); }
    if (o.k === "start") {
      S.sid = o.sid;
      if (!S.lines.has(o.sid)) S.lines.set(o.sid, new Map());
      if (t >= S.activeAt) { S.active = o.dev; S.activeName = o.dn; S.activeAt = t; }
      if (o.dev === DEV && myActive && o.sid === mySid) { ownStartSeen = true; ownStartTime = t; }
      else if (o.dev !== DEV && myActive && ownStartSeen && t >= ownStartTime) hooks.takeover(o.dn);
    }
    if (o.k === "stop" && S.active === o.dev && t >= S.activeAt) { S.active = null; S.activeAt = t; }
  } else if (o.t === "data" && o.d && typeof o.d === "object") {
    lastDataMsg = Math.max(lastDataMsg, t);
    hooks.data(o.d, o.agente || null, o.fatti || null);
  } else if (o.t === "fatto" && typeof o.id === "string") {
    hooks.fatto(o.id, !!o.on, +o.ts || t);
  }
  hooks.change();
}
async function catchUp() {
  try {
    const r = await fetch(HOST + "/" + K.topic + "/json?poll=1&since=" + (lastId || "12h"));
    if (!r.ok) throw 0;
    const txt = await r.text();
    for (const ln of txt.split("\n")) { if (!ln.trim()) continue; let m; try { m = JSON.parse(ln); } catch { continue; } await ingest(m); }
    setStatus("attiva");
  } catch { setStatus("offline"); }
}
let backoff = 2000;
function connect() {
  if (!enabled) return;
  try { if (es) es.close(); } catch {}
  try { es = new EventSource(HOST + "/" + K.topic + "/sse?since=" + (lastId || "12h")); } catch { setTimeout(connect, 5000); return; }
  es.onopen = () => { backoff = 2000; setStatus("attiva"); };
  es.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } ingest(m); };
  es.onerror = () => { try { es.close(); } catch {} setStatus("offline"); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); };
}

async function init(chiave) {
  K = chiave; enabled = true;
  await catchUp(); connect();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && enabled) { catchUp(); connect(); } });
  window.addEventListener("online", () => { if (enabled) { catchUp(); connect(); } });
  const bye = () => { if (myActive && stopWire && !byeSent) { byeSent = true; for (const t of stopWire) { let sent = false; try { sent = navigator.sendBeacon && navigator.sendBeacon(HOST + "/" + K.topic, t); } catch {} if (!sent) { try { fetch(HOST + "/" + K.topic, { method: "POST", body: t, keepalive: true }); } catch {} } } } };
  window.addEventListener("pagehide", bye);
}

/* ---- dati della dashboard ----
   force: dati nuovi letti da dati.js sul PC. Altrimenti si rimandano solo se nel canale non ci sono dati recenti. */
async function sendData(d, agente, fatti, force) {
  if (!enabled || !d || !d.aggiornato) return false;
  if (!force && Date.now() - lastDataMsg < RIPUBBLICA_DOPO) return false;
  const ok = await publish({ t: "data", agg: d.aggiornato, d, agente: agente || undefined, fatti: fatti || undefined });
  if (ok) lastDataMsg = Date.now();
  return ok;
}
const sendFatto = (id, on, ts) => publish({ t: "fatto", id, on, ts });

/* ---- conversazione ---- */
function ready(ms) { return enabled ? Promise.race([catchUp(), J.sleep(ms)]) : Promise.resolve(); }
function curLines(sid) { const map = S.lines.get(sid || S.sid); return map ? Array.from(map.values()).sort((a, b) => a.n - b.n || a.dev.localeCompare(b.dev)) : []; }
function historyText() {
  const L = curLines(mySid).filter(l => l.x);
  if (!L.length) return "";
  let t = L.slice(-60).map(l => (l.r === "u" ? "Filippo" : "Jarvis") + ": " + l.x).join("\n");
  if (t.length > 7000) t = "…" + t.slice(-7000);
  return "CONVERSAZIONE GIÀ IN CORSO (iniziata sul " + (L[0].dn || "altro dispositivo") + ", ora Filippo continua sul " + J.DEV_NAME + "). Trascrizione fin qui:\n" + t + "\nContinua esattamente da qui: non salutare di nuovo, non ripresentarti, non riassumere.";
}
function beginSession() {
  const now = Date.now();
  mySid = (S.sid && curLines(S.sid).length && now - S.lastActivity < 6 * 3600e3) ? S.sid : J.rnd(10);
  S.sid = mySid; if (!S.lines.has(mySid)) S.lines.set(mySid, new Map());
  myActive = true; byeSent = false; ownStartSeen = false; ownStartTime = 0; seq = Math.floor(now / 1000) * 1000;
  buf = []; S.lastActivity = now; S.active = DEV; S.activeName = J.DEV_NAME; S.activeAt = Math.max(S.activeAt, Math.floor(now / 1000) * 1000);
  if (enabled) {
    wire({ t: "ctl", k: "stop", sid: mySid, dev: DEV, dn: J.DEV_NAME }).then(w => { stopWire = w; }).catch(() => {});
    publish({ t: "ctl", k: "start", sid: mySid, dev: DEV, dn: J.DEV_NAME });
  }
  hooks.change();
}
function line(r, x) {
  if (!x) return;
  const n = seq++;
  const map = S.lines.get(mySid) || new Map(); S.lines.set(mySid, map);
  map.set(DEV + ":" + mySid + ":" + n, { r, x, dev: DEV, dn: J.DEV_NAME, n, t: Date.now() });
  buf.push({ r, x, n }); hooks.change();
  clearTimeout(flushT); flushT = setTimeout(flush, 4000);
}
function flush() {
  clearTimeout(flushT); flushT = null;
  if (!buf.length || !enabled) { buf = []; return Promise.resolve(); }
  const items = buf; buf = [];
  const groups = []; let g = null;
  for (const it of items) { if (g && it.n === g.seq0 + g.lines.length) g.lines.push({ r: it.r, x: it.x }); else { g = { t: "conv", sid: mySid, dev: DEV, dn: J.DEV_NAME, seq0: it.n, lines: [{ r: it.r, x: it.x }] }; groups.push(g); } }
  return Promise.all(groups.map(publish));
}
async function endSession(silent) {
  if (!myActive) return;
  const sid = mySid;
  myActive = false;
  if (S.active === DEV) S.active = null;
  await flush();
  if (!silent && enabled) await publish({ t: "ctl", k: "stop", sid, dev: DEV, dn: J.DEV_NAME });
  hooks.change();
}
function reset() {
  const sid = J.rnd(10); S.sid = sid; S.lines.set(sid, new Map()); S.active = null;
  if (enabled) publish({ t: "ctl", k: "reset", sid, dev: DEV, dn: J.DEV_NAME });
  hooks.change();
}

J.Sync = {
  init, ready, beginSession, endSession, line, flush, historyText, reset, sendData, sendFatto, DEV,
  lines: () => curLines(S.sid),
  get active() { return (S.active && Date.now() - S.lastActivity < 10 * 60e3) ? S.active : null; },
  get activeName() { return S.activeName; },
  get status() { return status; }, get enabled() { return enabled; }, get myActive() { return myActive; },
  on(h) { Object.assign(hooks, h); }
};
})();
