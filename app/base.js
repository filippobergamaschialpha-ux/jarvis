/* Strumenti comuni + gestione del codice segreto del dispositivo. */
(() => {
"use strict";
const J = window.J = {};

J.$ = id => document.getElementById(id);
J.el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
J.store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
J.pad = n => String(n).padStart(2, "0");
J.sleep = ms => new Promise(r => setTimeout(r, ms));
J.mobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
J.DEV_NAME = J.mobile ? "telefono" : "PC";

/* Pulizia della vecchia versione: il link con #k=… non vale più. Togliamo il frammento
   dall'indirizzo e cancelliamo chiave e dati salvati dalla v1 su questo dispositivo. */
if (location.hash) { try { history.replaceState(null, "", location.pathname + location.search); } catch {} }
["jarvis-sync-key", "jarvis-data-cache", "jarvis-data-pub", "jarvis-agent", "jarvis-token"].forEach(J.store.del);

/* ---------- codice segreto ----------
   Formato: 20 caratteri (alfabeto senza lettere ambigue), mostrati in 5 gruppi da 4.
   Da questo codice si ricavano: nome del canale, chiave AES-256 e token per il Worker.
   Sul dispositivo resta solo una chiave NON esportabile dentro IndexedDB: nemmeno uno
   script estraneo può leggerla e copiarla altrove. */
const ALFA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const te = new TextEncoder();
J.te = te; J.td = new TextDecoder();

J.normCodice = s => String(s || "").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
J.codiceValido = s => { const c = J.normCodice(s); return c.length === 20 && [...c].every(ch => ALFA.includes(ch)); };
J.formattaCodice = c => J.normCodice(c).match(/.{1,4}/g).join("-");
J.nuovoCodice = () => J.formattaCodice(Array.from(crypto.getRandomValues(new Uint8Array(20)), b => ALFA[b & 31]).join(""));

const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
J.b64 = b64;
J.unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
J.b64u = u8 => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
J.hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, "0")).join("");

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("jarvis-v2", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("k");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("k", mode), st = tx.objectStore("k"), req = fn(st);
    tx.oncomplete = () => { db.close(); res(req && req.result); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}

const hkdf = (base, info, bits) => crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode(info) }, base, bits).then(b => new Uint8Array(b));

/* Restituisce { topic, aes, impronta, tokenWorker() } oppure null se il dispositivo non è collegato. */
J.chiave = {
  async carica() {
    let base = null;
    try { base = await idbDo("readonly", st => st.get("base")); } catch {}
    return base ? this._deriva(base) : null;
  },
  async salva(codice) {
    const base = await crypto.subtle.importKey("raw", te.encode(J.normCodice(codice)), "HKDF", false, ["deriveBits", "deriveKey"]);
    await idbDo("readwrite", st => st.put(base, "base"));
    return this._deriva(base);
  },
  async scollega() {
    try { await idbDo("readwrite", st => st.delete("base")); } catch {}
    Object.keys(localStorage).filter(k => k.startsWith("jarvis")).forEach(J.store.del);
  },
  async _deriva(base) {
    const tb = await hkdf(base, "jarvis-v2-topic", 128);
    const aes = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode("jarvis-v2-aes") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const imp = await hkdf(base, "jarvis-v2-impronta", 32);
    return {
      topic: "jv2" + J.hex(tb), aes,
      impronta: J.hex(imp).toUpperCase().match(/.{4}/g).join(" "),
      tokenWorker: async () => J.b64u(await hkdf(base, "jarvis-v2-worker", 256))
    };
  }
};

/* Cifratura dei messaggi: [iv 12 byte][testo cifrato + tag]; il primo byte del testo in chiaro dice se è compresso. */
const canGz = typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
async function pipe(u8, T) { const st = new Blob([u8]).stream().pipeThrough(new T("gzip")); return new Uint8Array(await new Response(st).arrayBuffer()); }
J.seal = async (aes, obj) => {
  let body = te.encode(JSON.stringify(obj)), flag = 0;
  if (canGz) { try { body = await pipe(body, CompressionStream); flag = 1; } catch {} }
  const plain = new Uint8Array(body.length + 1); plain[0] = flag; plain.set(body, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, plain));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
};
J.unseal = async (aes, str) => {
  const raw = J.unb64(str);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, aes, raw.subarray(12)));
  let body = plain.subarray(1);
  if (plain[0] === 1) body = await pipe(body, DecompressionStream);
  return JSON.parse(J.td.decode(body));
};
J.rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join("");

/* "GG/MM/AAAA HH:MM" -> numero confrontabile (più grande = più recente) */
J.aggNum = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(s || ""); return m ? +(m[3] + m[2] + m[1] + m[4] + m[5]) : 0; };
})();
