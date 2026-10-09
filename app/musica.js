/* Musica di sottofondo: "Back in Black" (video ufficiale AC/DC, YouTube IFrame API).
   Come nella prima versione: lettore invisibile, parte già dentro il riff quando premi
   "Parla con Jarvis"; se YouTube mette una pubblicità resta muta e la canzone riparte
   appena finisce. Si toglie con la spunta sotto il pulsante (la scelta viene ricordata). */
(() => {
"use strict";
const J = window.J, { $, store } = J;
const YT_ID = "pAgnJDJN4VA";
const YT_START = 3;          /* secondi: parte già dentro il riff di chitarra */
const SONG_MIN = 200;        /* durata minima (s) della canzone vera: un video più corto è una pubblicità */
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const opt = $("musicOn");
let ytErr = null, yt = null, ytReady = false, ytWant = false, ytVol = 0, fadeT = null, adSeen = false, loading = false;

opt.checked = store.get("jarvis-v2-musica") !== "0";   /* accesa di default */
opt.addEventListener("change", () => { store.set("jarvis-v2-musica", opt.checked ? "1" : "0"); if (opt.checked) load(); else stop(); });

function isAd() { try { const d = yt.getDuration(); return d > 0 && d <= SONG_MIN; } catch { return false; } }
function audioOn() { try { yt.unMute(); if (!IOS) yt.setVolume(Math.round(Math.max(0.06, ytVol) * 100)); } catch {} }
/* pubblicità mentre la musica è richiesta: muta; finita la pubblicità, la canzone riparte dal riff */
function checkAd() {
  if (!ytReady || !ytWant) return;
  let st = -1; try { st = yt.getPlayerState(); } catch {}
  if (st !== 1 && st !== 3) return;
  if (isAd()) { adSeen = true; try { yt.mute(); } catch {} }
  else if (adSeen) { adSeen = false; try { yt.seekTo(YT_START, true); } catch {} audioOn(); }
}
setInterval(checkAd, 700);

/* il lettore si prepara subito all'apertura (su iPhone deve essere pronto quando tocchi il pulsante) */
function load() {
  if (loading) return; loading = true;
  window.onYouTubeIframeAPIReady = () => {
    try {
      yt = new YT.Player("ytPlayer", {
        width: "200", height: "200", videoId: YT_ID,
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, loop: 1, playlist: YT_ID },
        events: {
          onReady: () => { ytReady = true; if (ytWant && opt.checked) start(); },
          onStateChange: () => checkAd(),
          onError: e => { ytErr = e && e.data; }
        }
      });
    } catch {}
  };
  const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; sc.async = true; document.head.append(sc);
}
function setVol(v) { ytVol = v; if (IOS) return; try { if (ytReady) yt.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100)); } catch {} }
function fade(v, done) {
  clearInterval(fadeT);
  if (IOS) { ytVol = v; if (done) done(); return; }   /* su iPhone il volume da codice non funziona: si usa muto/non muto */
  fadeT = setInterval(() => {
    const d = v - ytVol;
    if (Math.abs(d) < 0.02) { setVol(v); clearInterval(fadeT); if (done) done(); }
    else setVol(ytVol + Math.sign(d) * 0.03);
  }, 40);
}
function start() {
  if (!opt.checked) return;
  ytWant = true; adSeen = false;
  if (!ytReady) { load(); return; }     /* partirà da sola appena il lettore è pronto */
  try { clearInterval(fadeT); yt.unMute(); yt.seekTo(YT_START, true); setVol(0.35); yt.playVideo(); } catch {}
}
function stop() {
  ytWant = false; adSeen = false;
  if (!ytReady) return;
  fade(0, () => { try { if (!ytWant) yt.pauseVideo(); } catch {} });
}
function duck(speaking) {
  if (!ytReady || !ytWant || adSeen) return;
  if (IOS) { try { speaking ? yt.mute() : yt.unMute(); } catch {} return; }
  fade(speaking ? 0.06 : 0.14);
}
if (opt.checked) load();
/* stato per controlli (console: J.Musica.info()) */
const info = () => ({ pronto: ytReady, richiesta: ytWant, pubblicita: adSeen, stato: yt && yt.getPlayerState ? yt.getPlayerState() : null, secondo: yt && yt.getCurrentTime ? Math.round(yt.getCurrentTime()) : null, durata: yt && yt.getDuration ? Math.round(yt.getDuration()) : null, muto: yt && yt.isMuted ? yt.isMuted() : null, errore: ytErr });
J.Musica = { start, stop, duck, info };
})();
