/* Impostazioni pubbliche di Jarvis. Qui NON vanno mai chiavi, password o token.
   SIGNER: indirizzo del Cloudflare Worker che consegna l'accesso firmato all'agente
   (es. "https://jarvis-firma.tuonome.workers.dev"). Finché è null si usa l'ID agente
   ricevuto in modo cifrato dal PC. */
window.JARVIS_CONFIG = {
  SIGNER: "https://jarvis-firma.filippo-bergamaschi-alpha.workers.dev",
  RELAY: "https://ntfy.sh"
};
