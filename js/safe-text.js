// safe-text.js - mostra i testi degli utenti in modo sicuro. Da incollare in app-logic.js (nessun import).
//
// COSA FA
//   Prende il testo scritto da un utente e lo trasforma in HTML sicuro:
//   - permette SOLO grassetto <b>, corsivo <i> e sottolineato <u> (senza attributi) e gli a capo;
//   - tutto il resto (<script>, <img onerror=...>, <a href=...>, onclick=..., ecc.) diventa testo normale e innocuo.
//
// COME SI USA
//   Dove oggi scrivi:      elemento.innerHTML = testoDelloUtente;
//   scrivi invece:         elemento.innerHTML = formatUserText(testoDelloUtente);
//   Per i NOMI UTENTE (consigliato testo semplice, niente grassetto):
//                          elemento.textContent = nomeUtente;
//   Va usato in OGNI punto in cui si mostra un testo preso da Firebase: bio, nome, post, commenti, ZetaMail, ecc.
//   Cosi' sono protetti anche i testi gia' presenti nel database.

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatUserText(value) {
  // 1) tutto il testo diventa innocuo
  let out = escapeHtml(value == null ? '' : value);
  // 2) si riattivano solo le coppie complete <b>..</b>, <i>..</i>, <u>..</u> (senza attributi), anche annidate
  const pair = /&lt;(b|i|u)&gt;([\s\S]*?)&lt;\/\1&gt;/gi;
  let previous;
  do {
    previous = out;
    out = out.replace(pair, (all, tag, inner) => `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`);
  } while (out !== previous);
  // 3) a capo
  return out.replace(/\r?\n/g, '<br>');
}

// Per i link (immagine del profilo, banner, ecc.): accetta solo indirizzi https.
// Evita "javascript:..." e simili. Restituisce l'indirizzo pulito oppure una stringa vuota.
function safeHttpsUrl(value) {
  try {
    const u = new URL(String(value).trim());
    return u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}
