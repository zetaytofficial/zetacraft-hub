// delete-account-button.js - il pulsante "Richiedi cancellazione account" apre una mail pronta per lo staff.
// Da incollare in app-logic.js. Nessun dato viene cancellato dall'app: lo fa lo staff dopo aver controllato la richiesta.
//
// HTML (nelle impostazioni del profilo):
//   <button id="delete-account-btn" type="button">🗑️ RICHIEDI CANCELLAZIONE ACCOUNT</button>
//   <p class="small">Se non si apre l'app della posta, scrivi a assistenza.zetacraft@proton.me</p>
//
// Collegamento (cambia `auth.currentUser` con il tuo modo di leggere l'utente loggato di Firebase):
//   document.getElementById('delete-account-btn').addEventListener('click', () => requestAccountDeletion(auth.currentUser));

const SUPPORT_EMAIL = 'assistenza.zetacraft@proton.me';

function buildDeletionMailto(user) {
  const clean = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, 100);
  const body = [
    'Voglio cancellare il mio account ZetaCraft Hub e tutti i miei dati.',
    '',
    'Nome utente: ' + clean(user.displayName),
    "Email dell'account: " + clean(user.email),
    'ID account: ' + clean(user.uid),
    '',
    'Non scrivere qui la tua password.',
  ].join('\n');
  return 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent('Cancellazione account') + '&body=' + encodeURIComponent(body);
}

function requestAccountDeletion(user) {
  if (!user || !user.uid) {
    window.alert('Accedi prima al tuo account.');
    return;
  }
  const ok = window.confirm(
    "Si aprira' una mail pronta per lo staff. Dopo la verifica cancelleremo il tuo account, i tuoi post e i tuoi messaggi (entro 30 giorni). L'operazione non si puo' annullare. Vuoi continuare?"
  );
  if (ok) window.location.href = buildDeletionMailto(user);
}
