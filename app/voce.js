/* Conversazione a voce con l'agente ElevenLabs. */
(() => {
"use strict";
const J = window.J, { $ } = J, Sync = J.Sync, CFG = window.JARVIS_CONFIG;
let conv = null, mode = "idle", starting = false, ctxSent = false;

/* Musica più bassa quando parla Jarvis E quando parli tu (così senti che ti sta ascoltando).
   La tua voce si riconosce dal volume del microfono, con una soglia che si adatta al rumore di fondo. */
let tuParli = false, ultimaVoce = 0, fondo = 0.02, abbassata = null, micT = null;
function aggiornaMusica() {
  const giu = mode === "speaking" || tuParli;
  if (giu !== abbassata) { abbassata = giu; J.Musica.duck(giu); }
}
function ascoltaMicrofono() {
  clearInterval(micT); tuParli = false; abbassata = null; fondo = 0.02;
  micT = setInterval(() => {
    if (!conv) return;
    let v = 0; try { v = conv.getInputVolume(); } catch {}
    const now = Date.now();
    if (mode !== "speaking") {
      fondo = v < fondo ? fondo * 0.9 + v * 0.1 : fondo * 0.995 + v * 0.005;   /* rumore di fondo: scende in fretta, sale piano */
      if (v > Math.max(0.05, fondo * 2.5)) { tuParli = true; ultimaVoce = now; }
    }
    if (tuParli && now - ultimaVoce > 900) tuParli = false;                  /* 0,9 s di silenzio: la musica risale */
    aggiornaMusica();
  }, 100);
}

J.setState = (text, isErr) => { $("state").textContent = text; $("state").className = "state" + (isErr ? " err" : ""); };
const clean = t => String(t || "").replace(/\[[a-z ]+\]\s*/gi, "").trim();
J.orbActive = () => !!conv;
J.orbLevel = () => { if (!conv) return 0; try { return mode === "speaking" ? conv.getOutputVolume() : conv.getInputVolume() * 0.6; } catch { return 0; } };

/* Prima di ogni modifica (Notion, bozze Gmail) Jarvis chiede conferma qui. */
function chiediConferma(call, ctx) {
  return new Promise(resolve => {
    const box = $("approve");
    const nome = String(call.tool_name || "azione").replace(/^JARVIS_/, "").replace(/_/g, " ");
    let par = ""; try { par = Object.entries(call.parameters || {}).filter(([k, v]) => v !== "" && v != null && !/^_/.test(k)).map(([k, v]) => k + ": " + (typeof v === "object" ? JSON.stringify(v) : v)).join("\n"); } catch {}
    $("approveText").textContent = nome + (par ? "\n\n" + par : "");
    box.hidden = false; $("approveYes").focus();
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    const done = ok => { box.hidden = true; $("approveYes").onclick = $("approveNo").onclick = null; resolve(ok); };
    $("approveYes").onclick = () => done(true);
    $("approveNo").onclick = () => done(false);
    if (ctx && ctx.signal) ctx.signal.addEventListener("abort", () => { box.hidden = true; }, { once: true });
  });
}

function sendCtx(c, hist) {
  if (ctxSent) return; ctxSent = true;
  try { c.sendContextualUpdate(J.contesto(J.stato.D) + (hist ? "\n\n" + hist : "")); } catch {}
}

async function accesso() {
  if (CFG.SIGNER) {
    if (!J.stato.chiave) throw new Error("collega prima questo dispositivo con il codice segreto");
    const r = await fetch(CFG.SIGNER, { headers: { "X-Jarvis-Token": await J.stato.chiave.tokenWorker() } });
    if (!r.ok) throw new Error("accesso negato dal servizio di firma (codice cambiato? aggiorna il token su Cloudflare)");
    return { signedUrl: (await r.json()).signed_url };
  }
  if (!J.stato.agente) throw new Error("manca l'ID dell'agente: aspetta che arrivino i dati dal PC");
  return { agentId: J.stato.agente };
}

async function start() {
  if (starting || conv) return;
  if (!window.ElevenLabsClient) { J.setState("Libreria vocale non caricata: controlla la connessione e ricarica la pagina.", true); return; }
  starting = true; ctxSent = false;
  try {
    J.setState("collegamento…"); J.Musica.start(); $("talk").classList.add("on"); $("talkLabel").textContent = "Termina"; J.orbWake();
    await Sync.ready(2500);
    Sync.beginSession();
    const hist = Sync.historyText();
    const acc = await accesso();
    let c = null;
    c = await ElevenLabsClient.Conversation.startSession({
      ...acc,
      connectionType: "websocket",
      ...(hist ? { overrides: { agent: { firstMessage: "Eccomi, sono qui." } } } : {}),
      onMCPToolApprovalRequest: chiediConferma,
      onConnect: () => { if (c) sendCtx(c, hist); },
      onStatusChange: ({ status }) => { if (status === "connected") J.setState("in ascolto"); if (status === "disconnected") stopUi(); },
      onModeChange: ({ mode: m }) => { const was = mode; mode = m; if (m === "speaking") tuParli = false; aggiornaMusica(); J.setState(m === "speaking" ? "parlo" : "in ascolto"); if (was === "speaking" && m === "listening") setTimeout(() => Sync.flush(), 500); },
      onMessage: ({ message, source }) => { const x = clean(message); if (!x) return; $("live").textContent = (source === "user" ? "Tu: " : "Jarvis: ") + x; Sync.line(source === "user" ? "u" : "a", x); },
      onError: msg => J.setState("Errore: " + String(msg).slice(0, 120), true),
      onDisconnect: () => stopUi()
    });
    conv = c; J.orbWake(); ascoltaMicrofono();
    sendCtx(c, hist);
    setTimeout(() => { if (conv === c) { ctxSent = false; sendCtx(c, hist); } }, 1500);
    J.renderSyncUi();
  } catch (e) {
    stopUi();
    const m = String(e && (e.message || e));
    J.setState(/permission|notallowed|denied/i.test(m) ? "Serve il permesso del microfono: consentilo nelle impostazioni del browser." : "Non riesco a collegarmi a Jarvis: " + m.slice(0, 140), true);
  } finally { starting = false; }
}
function stopUi() {
  clearInterval(micT); micT = null; tuParli = false; abbassata = null;
  J.Musica.stop(); const was = conv; conv = null; mode = "idle";
  $("talk").classList.remove("on"); $("talkLabel").textContent = "Parla con Jarvis";
  if (!$("state").classList.contains("err")) J.setState("pronto");
  if (was || Sync.myActive) Sync.endSession();
  J.renderSyncUi();
}
async function toggle() { if (conv) { const c = conv; stopUi(); try { await c.endSession(); } catch {} } else start(); }

J.Voce = {
  toggle, stopUi,
  get attiva() { return !!conv; },
  /* un altro dispositivo ha preso la conversazione: qui ci fermiamo */
  takeover(name) { if (!conv) return; const c = conv; Sync.endSession(true); stopUi(); try { c.endSession(); } catch {} J.setState("continui sul " + name); $("live").textContent = "La conversazione è passata sul " + name + "."; }
};
})();
