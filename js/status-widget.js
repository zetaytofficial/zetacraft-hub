// status-widget.js - mostra nel sito lo stato del server letto da Firestore.
// Funziona con uno script normale (nessun import): ti serve solo il tuo `db` di Firebase.
//
// REGOLE FIRESTORE DA AGGIUNGERE (solo lettura pubblica di questo documento, scrittura vietata):
//   match /status/server {
//     allow read: if true;
//     allow write: if false;   // scrive solo il bot con firebase-admin, che ignora le regole
//   }
//
// COME USARLO (adatta i nomi a quelli che gia' usi nell'app):
//   1) Nell'HTML aggiungi un elemento, ad esempio:  <span id="server-status">...</span>
//   2) Nel tuo codice, dopo aver creato il tuo `db` di Firestore:
//        watchServerStatus({ db, doc, onSnapshot }, (s) =>
//          renderServerStatus(document.getElementById('server-status'), s));
//      (`doc` e `onSnapshot` sono le funzioni di Firestore che importi gia' per leggere i post)
//   3) Per colorare il badge usa l'attributo data-state, ad esempio in CSS:
//        #server-status[data-state="online"]  { color: #4ade80; }
//        #server-status[data-state="offline"] { color: #f87171; }

const STALE_MS = 10 * 60 * 1000; // se il bot non scrive da 10 minuti, il dato e' considerato vecchio

function watchServerStatus(fb, render) {
  const { db, doc, onSnapshot } = fb;
  let data = null;

  const emit = () => {
    if (!data) return render({ state: 'unknown', players: 0, max: 0 });
    const ts = data.updatedAt && typeof data.updatedAt.toMillis === 'function' ? data.updatedAt.toMillis() : 0;
    const stale = !ts || Date.now() - ts > STALE_MS;
    render(stale ? { state: 'stale', players: 0, max: 0 } : data);
  };

  const unsubscribe = onSnapshot(
    doc(db, 'status', 'server'),
    (snap) => {
      data = snap.exists() ? snap.data() : null;
      emit();
    },
    () => render({ state: 'unknown', players: 0, max: 0 })
  );

  // ricontrolla ogni minuto, cosi' il badge diventa "non aggiornato" anche senza nuovi dati
  const timer = setInterval(emit, 60 * 1000);
  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}

function renderServerStatus(el, s) {
  if (!el) return;
  const labels = {
    online: 'ONLINE',
    offline: 'OFFLINE',
    starting: 'IN AVVIO',
    stale: 'STATO NON AGGIORNATO',
    unknown: 'STATO NON DISPONIBILE',
  };
  const base = labels[s.state] || labels.unknown;
  // textContent (mai innerHTML): il testo non viene mai interpretato come HTML
  el.textContent = s.state === 'online' && s.max ? base + ' · ' + s.players + '/' + s.max + ' giocatori' : base;
  el.dataset.state = s.state;
}
