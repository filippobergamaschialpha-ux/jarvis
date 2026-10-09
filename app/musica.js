/* Musica di sottofondo (facoltativa, spenta di default).
   YouTube viene caricato solo se la musica è attiva e premi "Parla con Jarvis";
   il lettore resta visibile (piccolo) come chiedono le regole di YouTube. */
(() => {
"use strict";
const J = window.J, { $, store } = J;
const YT_ID = "pAgnJDJN4VA", YT_START = 3;
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const box = $("musicBox"), opt = $("musicOn");
let yt = null, ready = false, want = false, vol = 0, fadeT = null, loading = false;

opt.checked = store.get("jarvis-v2-musica") === "1";
opt.addEventListener("change", () => { store.set("jarvis-v2-musica", opt.checked ? "1" : "0"); if (!opt.checked) stop(); });

function load() {
  if (loading) return; loading = true;
  window.onYouTubeIframeAPIReady = () => {
    try {
      yt = new YT.Player("ytPlayer", {
        width: "200", height: "200", videoId: YT_ID, host: "https://www.youtube-nocookie.com",
        playerVars: { playsinline: 1, rel: 0, loop: 1, playlist: YT_ID },
        events: { onReady: () => { ready = true; if (want) start(); } }
      });
    } catch {}
  };
  const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; sc.async = true; document.head.append(sc);
}
function setVol(v) { vol = v; if (IOS || !ready) return; try { yt.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100)); } catch {} }
function fade(v, done) {
  clearInterval(fadeT);
  if (IOS) { vol = v; if (done) done(); return; }
  fadeT = setInterval(() => { const d = v - vol; if (Math.abs(d) < 0.02) { setVol(v); clearInterval(fadeT); if (done) done(); } else setVol(vol + Math.sign(d) * 0.03); }, 40);
}
function start() {
  if (!opt.checked) return;
  want = true; box.hidden = false;
  if (!ready) { load(); return; }
  try { clearInterval(fadeT); yt.unMute(); yt.seekTo(YT_START, true); setVol(0.35); yt.playVideo(); } catch {}
}
function stop() {
  want = false;
  if (!ready) { box.hidden = true; return; }
  fade(0, () => { try { if (!want) { yt.pauseVideo(); box.hidden = true; } } catch {} });
}
function duck(speaking) {
  if (!ready || !want) return;
  if (IOS) { try { speaking ? yt.mute() : yt.unMute(); } catch {} return; }
  fade(speaking ? 0.06 : 0.14);
}
J.Musica = { start, stop, duck };
})();
