/* Musica di sottofondo quando parli con Jarvis.
   1) Se su questo dispositivo hai scelto un file della canzone ("Questo dispositivo > Scegli canzone"),
      suona quello: parte subito, niente internet, niente YouTube. Il file resta SOLO sul dispositivo.
   2) Altrimenti usa "Back in Black" da YouTube (lettore invisibile; se arriva una pubblicità resta
      muta e la canzone riparte appena finisce).
   Si toglie con la spunta sotto il pulsante (la scelta viene ricordata). */
(() => {
"use strict";
const J = window.J, { $, store } = J;
const YT_ID = "pAgnJDJN4VA";
const YT_START = 3;          /* secondi: nel video parte già dentro il riff di chitarra */
const SONG_MIN = 200;        /* durata minima (s) della canzone vera: un video più corto è una pubblicità */
const MAX_MB = 40;
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const opt = $("musicOn");
let src = null;              /* "file" | "yt" */
let ctx = null, gain = null, audio = null, yt = null, ytErr = null, ytReady = false, want = false, vol = 0, fadeT = null, adSeen = false, ytLoading = false;

opt.checked = store.get("jarvis-v2-musica") !== "0";   /* accesa di default */
opt.addEventListener("change", () => { store.set("jarvis-v2-musica", opt.checked ? "1" : "0"); if (opt.checked) prepara(); else stop(); });
/* volume della musica scelto da Filippo (0-1); mentre Jarvis ascolta/parla si abbassa ancora */
const livello = () => { const v = +store.get("jarvis-v2-musica-vol"); return v > 0 ? Math.min(1, v) : 0.25; };
const daSecondo = () => Math.max(0, Math.min(600, +store.get("jarvis-v2-canzone-da") || 0));

/* ---------- canzone dal dispositivo ---------- */
function usaFile(rec) {
  if (audio) { try { audio.pause(); URL.revokeObjectURL(audio.src); } catch {} }
  audio = new Audio(); gain = null;
  audio.src = URL.createObjectURL(rec.blob);
  audio.loop = true; audio.preload = "auto"; audio.setAttribute("playsinline", "");
  src = "file";
  if (yt) { try { yt.pauseVideo(); } catch {} }
  $("songName").textContent = rec.name || "canzone salvata";
  $("songDel").hidden = false;
}

/* ---------- YouTube ---------- */
function isAd() { try { const d = yt.getDuration(); return d > 0 && d <= SONG_MIN; } catch { return false; } }
function checkAd() {
  if (src !== "yt" || !ytReady || !want) return;
  let st = -1; try { st = yt.getPlayerState(); } catch {}
  if (st !== 1 && st !== 3) return;
  if (isAd()) { adSeen = true; try { yt.mute(); } catch {} }
  else if (adSeen) { adSeen = false; try { yt.seekTo(YT_START, true); yt.unMute(); if (!IOS) yt.setVolume(Math.round(Math.max(0.03, vol) * 100)); } catch {} }
}
setInterval(checkAd, 700);
function caricaYT() {
  src = "yt";
  if (ytLoading) return; ytLoading = true;
  window.onYouTubeIframeAPIReady = () => {
    try {
      yt = new YT.Player("ytPlayer", {
        width: "200", height: "200", videoId: YT_ID,
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, loop: 1, playlist: YT_ID },
        events: {
          onReady: () => { ytReady = true; if (want && opt.checked && src === "yt") start(); },
          onStateChange: () => checkAd(),
          onError: e => { ytErr = e && e.data; }
        }
      });
    } catch {}
  };
  const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; sc.async = true; document.head.append(sc);
}

/* prepara subito il lettore giusto: su iPhone deve essere pronto quando tocchi il pulsante */
async function prepara() {
  let rec = null; try { rec = await J.idb.get("canzone"); } catch {}
  if (rec && rec.blob) usaFile(rec); else if (opt.checked) caricaYT();
}

/* ---------- comandi comuni ---------- */
/* Il file passa da un regolatore Web Audio: è l'unico modo per cambiare il volume anche su iPhone. */
function regolatore() {
  if (gain || !audio) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = ctx || new AC();
    const srcNode = ctx.createMediaElementSource(audio);
    gain = ctx.createGain(); gain.gain.value = 0;
    srcNode.connect(gain).connect(ctx.destination);
  } catch { gain = null; }
}
const fileVolOk = () => src === "file" && audio && (gain || !IOS);
function setVol(v) {
  vol = Math.max(0, Math.min(1, v));
  try {
    if (src === "file" && audio) { if (gain) gain.gain.value = vol; else if (!IOS) audio.volume = vol; }
    else if (src === "yt" && ytReady && !IOS) yt.setVolume(Math.round(vol * 100));   /* YouTube su iPhone: solo muto/non muto */
  } catch {}
}
function fade(v, done) {
  clearInterval(fadeT);
  if (IOS && !fileVolOk()) { vol = v; if (done) done(); return; }
  fadeT = setInterval(() => { const d = v - vol; if (Math.abs(d) < 0.02) { setVol(v); clearInterval(fadeT); if (done) done(); } else setVol(vol + Math.sign(d) * 0.03); }, 40);
}
function start() {
  if (!opt.checked) return;
  want = true; adSeen = false; clearInterval(fadeT);
  if (src === "file" && audio) {
    regolatore();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    try { audio.currentTime = daSecondo(); } catch {}
    audio.muted = false; setVol(livello());
    const p = audio.play(); if (p && p.catch) p.catch(() => {});
    return;
  }
  if (!ytReady) { caricaYT(); return; }             /* partirà da sola appena il lettore è pronto */
  try { yt.unMute(); yt.seekTo(YT_START, true); setVol(livello()); yt.playVideo(); } catch {}
}
function stop() {
  want = false; adSeen = false;
  if (src === "file" && audio) { fade(0, () => { if (!want) audio.pause(); }); return; }
  if (!ytReady) return;
  fade(0, () => { try { if (!want) yt.pauseVideo(); } catch {} });
}
function duck(speaking) {
  if (!want || adSeen) return;
  if (src === "file" && audio) { if (fileVolOk()) fade(livello() * (speaking ? 0.15 : 0.45)); else audio.muted = speaking; return; }
  if (!ytReady) return;
  if (IOS) { try { speaking ? yt.mute() : yt.unMute(); } catch {} return; }
  fade(livello() * (speaking ? 0.15 : 0.45));
}

/* ---------- pannello "Questo dispositivo": scelta della canzone ---------- */
$("songFile").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = "";
  if (!f) return;
  const msg = $("songMsg");
  if (f.size > MAX_MB * 1048576) { msg.textContent = "File troppo grande (massimo " + MAX_MB + " MB)."; return; }
  const rec = { blob: f, name: f.name };
  try { await J.idb.put("canzone", rec); msg.textContent = "Canzone salvata su questo dispositivo."; }
  catch { msg.textContent = "Non sono riuscito a salvarla: la userò solo finché la pagina resta aperta."; }
  usaFile(rec);
});
$("songDel").addEventListener("click", async () => {
  stop(); try { await J.idb.del("canzone"); } catch {}
  if (audio) { try { URL.revokeObjectURL(audio.src); } catch {} audio = null; }
  $("songName").textContent = "Back in Black da YouTube"; $("songDel").hidden = true; $("songMsg").textContent = "Torno a YouTube.";
  if (opt.checked) caricaYT();
});
$("songVol").value = Math.round(livello() * 100);
$("songVol").addEventListener("input", e => {
  const v = Math.max(5, Math.min(100, +e.target.value || 25)) / 100;
  store.set("jarvis-v2-musica-vol", String(v));
  if (want) setVol(v);                   /* si sente subito se la musica sta suonando */
});
$("songFrom").value = daSecondo();
$("songFrom").addEventListener("change", e => store.set("jarvis-v2-canzone-da", String(Math.max(0, Math.round(+e.target.value || 0)))));

prepara();

/* stato per controlli (console: J.Musica.info()) */
const info = () => ({
  fonte: src, volume: Math.round(vol * 100), regolatore: !!gain, richiesta: want, pubblicita: adSeen, errore: ytErr,
  secondo: src === "file" && audio ? Math.round(audio.currentTime) : (yt && yt.getCurrentTime ? Math.round(yt.getCurrentTime()) : null),
  suona: src === "file" && audio ? !audio.paused : (yt && yt.getPlayerState ? yt.getPlayerState() === 1 : false)
});
J.Musica = { start, stop, duck, info };
})();
