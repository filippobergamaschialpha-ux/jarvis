/* Avvio: collegamento del dispositivo, dati, eventi dell'interfaccia. */
(() => {
"use strict";
const J = window.J, { $, el, pad, store } = J, Sync = J.Sync;
const LOCALE = location.protocol === "file:";      /* pagina aperta dal disco del PC: può leggere dati.js */
const stato = J.stato = { D: {}, agente: store.get("jarvis-v2-agente"), chiave: null, locale: false };

/* ---------- orologio e saluto ---------- */
const saluto = h => (h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera") + ", Filippo.";
function tick() { const d = new Date(); $("clockTime").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()); $("clockDate").textContent = J.oggiLungo(d); $("greet").textContent = saluto(d.getHours()); }
tick(); setInterval(tick, 15000);

/* pannelli aperti/chiusi ricordati */
document.querySelectorAll("details.sec").forEach(d => {
  const k = "jarvis-v2-open-" + d.id, v = store.get(k);
  if (v === "0") d.open = false; else if (v === "1") d.open = true;
  d.addEventListener("toggle", () => store.set(k, d.open ? "1" : "0"));
});

/* ---------- dati ---------- */
function mostra() { J.render(stato.D); }
async function salvaCache() {
  if (!stato.chiave || stato.locale || !stato.D.aggiornato) return;
  try { store.set("jarvis-v2-cache", await J.seal(stato.chiave.aes, stato.D)); } catch {}
}
async function leggiCache() {
  const c = store.get("jarvis-v2-cache"); if (!c || !stato.chiave) return;
  try { const d = await J.unseal(stato.chiave.aes, c); if (J.aggNum(d.aggiornato) > J.aggNum(stato.D.aggiornato)) { stato.D = d; mostra(); } } catch {}
}
function caricaScript(src) { return new Promise(res => { const s = document.createElement("script"); s.src = src; s.onload = () => { s.remove(); res(true); }; s.onerror = () => { s.remove(); res(false); }; document.head.append(s); }); }
async function leggiDatiLocali() {
  await caricaScript("../../dati.js?t=" + Date.now());
  if (window.JARVIS_DATI && window.JARVIS_DATI.aggiornato) {
    const nuovi = window.JARVIS_DATI.aggiornato !== stato.D.aggiornato;
    stato.D = window.JARVIS_DATI; stato.locale = true;
    if (nuovi) { mostra(); pubblicaLocali(); }
  }
}
/* sul PC: manda i dati agli altri dispositivi; si segna come "mandato" solo se l'invio riesce */
async function pubblicaLocali() {
  if (!stato.chiave || !stato.locale) return;
  const k = stato.D.aggiornato + "|" + stato.chiave.topic;
  const ok = await Sync.sendData(stato.D, stato.agente, J.Fatti.m, store.get("jarvis-v2-pub") !== k);
  if (ok) store.set("jarvis-v2-pub", k);
}

Sync.on({
  change: () => { try { J.renderSyncUi(); } catch {} },
  takeover: name => J.Voce.takeover(name),
  data: (d, agente, fatti) => {
    if (agente && /^agent_[A-Za-z0-9]+$/.test(agente) && agente !== stato.agente) { stato.agente = agente; store.set("jarvis-v2-agente", agente); }
    let ch = J.Fatti.merge(fatti);
    if (!stato.locale && J.aggNum(d.aggiornato) > J.aggNum(stato.D.aggiornato)) { stato.D = d; ch = true; salvaCache(); }
    if (ch) mostra();
  },
  fatto: (id, on, ts) => { if (J.Fatti.put(id, on, ts)) mostra(); }
});

/* ---------- tasto "fatto" ---------- */
$("task").addEventListener("click", e => {
  const b = e.target.closest("button.check"); if (!b) return;
  const id = b.dataset.id, on = !J.Fatti.is(id), ts = Date.now();
  J.Fatti.put(id, on, ts); mostra();
  const nb = $("task").querySelector('button.check[data-id="' + CSS.escape(id) + '"]'); if (nb) nb.focus();
  Sync.sendFatto(id, on, ts);
});

/* ---------- interfaccia sincronizzazione e dispositivo ---------- */
J.renderSyncUi = function () {
  const box = $("log"); box.replaceChildren();
  Sync.lines().slice(-8).forEach(l => { const d = el("div", "ln " + l.r); d.append(el("b", null, l.r === "u" ? "Tu" : "Jarvis"), document.createTextNode(l.x)); box.append(d); });
  box.scrollTop = box.scrollHeight;
  const h = $("handoff");
  if (Sync.enabled && Sync.active && Sync.active !== Sync.DEV && !J.Voce.attiva) { h.hidden = false; h.className = "handoff"; h.textContent = "Jarvis sta parlando con te sul " + Sync.activeName + ". Premi «Parla con Jarvis» qui per continuare: l'altro dispositivo si ferma."; }
  else if (Sync.enabled && Sync.myActive) { h.hidden = false; h.className = "handoff here"; h.textContent = "Conversazione attiva su questo " + J.DEV_NAME + "."; }
  else h.hidden = true;
  $("syncState").textContent = Sync.status;
};
$("newConv").onclick = async () => { if (J.Voce.attiva) await J.Voce.toggle(); Sync.reset(); $("live").textContent = "Nuova conversazione."; };
$("talk").onclick = () => J.Voce.toggle();
$("orbBtn").onclick = () => J.Voce.toggle();

$("showToken").onclick = async () => {
  const out = $("tokenOut");
  if (!out.hidden) { out.hidden = true; out.textContent = ""; return; }
  if (!stato.chiave) return;
  out.textContent = await stato.chiave.tokenWorker(); out.hidden = false;
};
$("unlink").onclick = async () => {
  if (!confirm("Scollegare questo dispositivo? Verranno cancellati il codice e i dati salvati qui. Per ricollegarlo servirà di nuovo il codice segreto.")) return;
  if (J.Voce.attiva) await J.Voce.toggle();
  await J.chiave.scollega(); location.reload();
};

/* ---------- collegamento del dispositivo ---------- */
function mostraSetup(on) { $("setup").hidden = !on; $("app").hidden = on; if (on) $("codeIn").focus(); }
$("setupForm").addEventListener("submit", async e => {
  e.preventDefault();
  const v = $("codeIn").value, msg = $("setupMsg");
  if (!J.codiceValido(v)) { msg.textContent = "Il codice deve avere 20 caratteri (lettere e numeri, i trattini non contano). Controlla e riprova."; return; }
  if (!window.crypto || !crypto.subtle || !window.indexedDB) { msg.textContent = "Questo browser non supporta la cifratura necessaria. Usa Safari o Chrome aggiornati."; return; }
  msg.textContent = "Collego…";
  try { $("codeIn").value = ""; await avvia(await J.chiave.salva(v)); }
  catch { msg.textContent = "Non sono riuscito a salvare il codice su questo dispositivo (navigazione privata?)."; }
});
$("newCode").onclick = () => {
  const c = J.nuovoCodice();
  $("newCodeOut").textContent = c; $("newCodeBox").hidden = false;
};
$("useNewCode").onclick = () => { $("codeIn").value = $("newCodeOut").textContent; $("setupForm").requestSubmit(); };

async function avvia(chiave) {
  stato.chiave = chiave;
  $("fp").textContent = chiave.impronta;
  mostraSetup(false);
  if (!stato.locale) await leggiCache();
  await Sync.init(chiave);
  if (stato.locale) await pubblicaLocali();
  else if (stato.D.aggiornato) Sync.sendData(stato.D, stato.agente, J.Fatti.m, false);   /* rimanda i dati solo se nel canale non ce ne sono di recenti */
  J.renderSyncUi();
}

(async () => {
  mostra();
  if (LOCALE) {
    await caricaScript("../locale/agente.js");
    if (window.JARVIS_AGENTE && /^agent_[A-Za-z0-9]+$/.test(window.JARVIS_AGENTE)) { stato.agente = window.JARVIS_AGENTE; store.set("jarvis-v2-agente", stato.agente); }
    await leggiDatiLocali();
    setInterval(leggiDatiLocali, 300000);    /* ricontrolla dati.js ogni 5 minuti */
  }
  let k = null; try { k = await J.chiave.carica(); } catch {}
  if (k) await avvia(k); else mostraSetup(true);
  setInterval(() => { try { J.renderSyncUi(); } catch {} }, 30000);
})();
})();
