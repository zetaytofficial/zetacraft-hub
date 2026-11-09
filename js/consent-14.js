// consent-14.js - casella "ho almeno 14 anni e accetto Termini e Privacy". Da incollare in app-logic.js (nessun import).
//
// USO
//   1) Dove vuoi la casella (di solito sopra "Accedi con i social" e nel modulo di registrazione):
//        <div id="consent-box"></div>
//      e in app-logic.js, a pagina caricata:
//        document.getElementById('consent-box').innerHTML = consentHtml();
//        setupConsent('consent-check', '.social-login-btn');   // .social-login-btn = i tuoi pulsanti di accesso
//      (il secondo valore e' il selettore CSS dei pulsanti che restano BLOCCATI finche' la casella non e' spuntata;
//       se i pulsanti hanno un'altra classe, scrivi quella, ad esempio '#login-google, #login-github')
//   2) Quando l'utente accede o si registra, salva la prova del consenso nel suo profilo Firebase:
//        await setDoc(doc(db, 'users', uid), { consent: consentRecord() }, { merge: true });
//   3) Se hai cambiato i Termini, cambia CONSENT_VERSION: potrai richiedere di nuovo l'accettazione.
//
// NOTA: e' un controllo di buona fede (basta spuntare), non una verifica dell'eta'. Per la legge italiana basta che
// l'utente dichiari di avere almeno 14 anni; se hai dubbi sull'eta' di qualcuno, lo staff puo' chiedere di verificare.

const CONSENT_VERSION = '1.4';
const LEGAL_PAGE = 'documenti-legali.html';

function consentHtml() {
  return `
<style>
  .consent { display:flex; gap:10px; align-items:flex-start; margin:12px 0; font-size:14px; line-height:1.4; text-align:left; }
  .consent input { margin-top:3px; width:18px; height:18px; flex:none; }
  .consent a { text-decoration:underline; }
  .consent-locked { opacity:.45; pointer-events:none; cursor:not-allowed; filter:grayscale(.6); }
  .consent-hint { font-size:13px; opacity:.8; margin:4px 0 8px; }
</style>
<label class="consent">
  <input type="checkbox" id="consent-check">
  <span>Dichiaro di avere <b>almeno 14 anni</b> e accetto i
    <a href="${LEGAL_PAGE}#termini" target="_blank" rel="noopener">Termini e Condizioni</a> e la
    <a href="${LEGAL_PAGE}#privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span>
</label>
<div class="consent-hint" id="consent-hint">Spunta la casella per poter accedere.</div>`;
}

// Blocca gli elementi indicati (pulsanti di accesso) finche' la casella non e' spuntata.
function setupConsent(checkboxId, lockedSelector) {
  const box = document.getElementById(checkboxId);
  if (!box) return;
  const hint = document.getElementById('consent-hint');
  const apply = () => {
    document.querySelectorAll(lockedSelector).forEach((el) => {
      el.classList.toggle('consent-locked', !box.checked);
      if ('disabled' in el) el.disabled = !box.checked;
      el.setAttribute('aria-disabled', String(!box.checked));
    });
    if (hint) hint.style.display = box.checked ? 'none' : '';
  };
  box.addEventListener('change', apply);
  apply();
  // Se i pulsanti compaiono dopo (per esempio il menu "Accedi con i social" che si apre), si bloccano anche loro.
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
}

function consentGiven() {
  const box = document.getElementById('consent-check');
  return !!(box && box.checked);
}

// Da salvare nel profilo dell'utente.
function consentRecord() {
  return { ageConfirmed: true, termsVersion: CONSENT_VERSION, acceptedAt: Date.now() };
}
