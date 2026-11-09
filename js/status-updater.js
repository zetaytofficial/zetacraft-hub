'use strict';
// status-updater.js - scrive su Firestore lo stato del server ZetaCraft.
// Gira SUL COMPUTER/SERVIZIO DEL BOT, mai nel sito.
//
// INSTALLAZIONE
//   npm install firebase-admin minecraft-server-util
//
// CHIAVE DI FIREBASE (segreta!)
//   Scarica da Firebase > Impostazioni progetto > Account di servizio il file JSON,
//   salvalo FUORI dalla cartella del sito e dal repository (o aggiungilo a .gitignore) e avvia con:
//     GOOGLE_APPLICATION_CREDENTIALS=/percorso/chiave.json node status-updater.js
//   In alternativa metti il contenuto del JSON nella variabile FIREBASE_SERVICE_ACCOUNT.
//   Mai committarla, mai incollarla in chat o nel sito. Se esce per errore, rigenerala subito.
//
// USO
//   - Da solo:            node status-updater.js   (controlla il server col ping ogni minuto)
//   - Dentro il tuo bot:  const { publishStatus } = require('./status-updater');
//                         publishStatus({ state: 'online', players: 3, max: 20 });
//     (utile se il tuo bot sa gia' lo stato in un altro modo, ad esempio dai messaggi di Aternos)
//
// DEBUG
//   DEBUG=1 node status-updater.js   stampa la risposta grezza del server: usala una volta
//   a server spento e una a server acceso per verificare che il riconoscimento funzioni.
//
// Documento scritto: status/server  ->  { state, players, max, updatedAt }
//   state = 'online' | 'offline' | 'starting'

const HOST = process.env.MC_HOST || 'zetacraft-ita.aternos.me';
const PORT = Number(process.env.MC_PORT || 25565);
const CHECK_EVERY_MS = 60 * 1000;     // controllo ogni minuto
const HEARTBEAT_MS = 5 * 60 * 1000;   // riscrive comunque ogni 5 minuti (il sito capisce che il bot e' vivo)
const DOC_PATH = 'status/server';

let db = null;
function getDb() {
  if (db) return db;
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const credential = process.env.FIREBASE_SERVICE_ACCOUNT
      ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : admin.credential.applicationDefault(); // legge GOOGLE_APPLICATION_CREDENTIALS
    admin.initializeApp({ credential });
  }
  db = admin.firestore();
  return db;
}

// Trasforma la risposta del ping in { state, players, max }.
// Aternos, a server spento o in avvio, risponde con un testo di stato: da verificare con DEBUG=1.
function classify(res) {
  const version = String((res && res.version && res.version.name) || '');
  const motd = String((res && res.motd && res.motd.clean) || '');
  const players = Number((res && res.players && res.players.online) || 0);
  const max = Number((res && res.players && res.players.max) || 0);

  if (/offline/i.test(version + ' ' + motd)) return { state: 'offline', players: 0, max: 0 };
  if (/(starting|loading|preparing|saving|stopping|queue)/i.test(version)) {
    return { state: 'starting', players: 0, max: 0 };
  }
  return { state: 'online', players, max };
}

async function detectStatus() {
  const util = require('minecraft-server-util');
  try {
    const res = await util.status(HOST, PORT, { timeout: 8000 });
    if (process.env.DEBUG) console.log('Risposta del server:', JSON.stringify(res));
    return classify(res);
  } catch (err) {
    if (process.env.DEBUG) console.log('Errore del ping:', err.message);
    return { state: 'offline', players: 0, max: 0 };
  }
}

let last = null;
let lastWrite = 0;

// Scrive su Firestore solo se qualcosa e' cambiato (o ogni 5 minuti): risparmia scritture e letture.
async function publishStatus(s) {
  const status = { state: s.state, players: s.players || 0, max: s.max || 0 };
  const changed = !last || last.state !== status.state || last.players !== status.players || last.max !== status.max;
  const due = Date.now() - lastWrite > HEARTBEAT_MS;
  if (!changed && !due) return;

  const admin = require('firebase-admin');
  await getDb().doc(DOC_PATH).set({
    ...status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  last = status;
  lastWrite = Date.now();
}

async function tick() {
  try {
    await publishStatus(await detectStatus());
  } catch (err) {
    console.error('Errore aggiornamento stato:', err.message);
  }
}

if (require.main === module) {
  console.log(`Controllo ${HOST}:${PORT} ogni ${CHECK_EVERY_MS / 1000} secondi...`);
  tick();
  setInterval(tick, CHECK_EVERY_MS);
}

module.exports = { classify, detectStatus, publishStatus };
