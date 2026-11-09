// ZetaMail cifrato (E2E): incolla TUTTO questo blocco in app-logic.js. Nessun import.
// Uso: const mail = ZetaMail.create({ fb: {db, doc, getDoc, setDoc, collection, addDoc, query, orderBy, onSnapshot}, uid, ...ZetaMail.defaultUi });
//      await mail.init(); await mail.send(uidAltro, 'ciao'); mail.listen(uidAltro, (messaggi) => ..., (problema) => ...);

const ZetaCrypto = (() => {

const enc = new TextEncoder();
const dec = new TextDecoder();

const EC = { name: 'ECDH', namedCurve: 'P-256' };
const PBKDF2_ITERATIONS = 600000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const b64 = {
  to(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  },
  from(str) {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  },
};

/** Genera un codice casuale da 160 bit, tipo "7K2M-9QXA-....". Mostralo UNA volta. */
function generateRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += ALPHABET[bytes[i] & 31]; // 256 è divisibile per 32: nessun bias
    if (i % 4 === 3 && i < 31) out += '-';
  }
  return out;
}

/** Normalizza quello che scrive l'utente (minuscole, spazi, trattini, O/I/L). */
function normalizeCode(code) {
  const c = String(code)
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (c.length !== 32 || [...c].some((ch) => !ALPHABET.includes(ch))) {
    throw new Error('Codice di recupero non valido');
  }
  return c;
}

async function deriveWrapKey(code, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw',
    enc.encode(normalizeCode(code)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function wrapPrivateKey(pkcs8, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWrapKey(code, salt, PBKDF2_ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pkcs8);
  return {
    v: 1,
    iterations: PBKDF2_ITERATIONS,
    salt: b64.to(salt),
    iv: b64.to(iv),
    data: b64.to(data),
  };
}

function importPrivateKey(pkcs8) {
  return crypto.subtle.importKey('pkcs8', pkcs8, EC, false, ['deriveBits']);
}

/**
 * Da chiamare UNA volta, alla creazione dell'account ZetaMail.
 * Restituisce:
 *  - publicJwk:    da salvare su Firebase (pubblica)
 *  - backup:       da salvare su Firebase (cifrato, solo proprietario)
 *  - recoveryCode: da mostrare all'utente UNA volta, NON salvare da nessuna parte
 *  - privateKey:   da tenere sul dispositivo con saveKeyLocally()
 */
async function createIdentity() {
  const pair = await crypto.subtle.generateKey(EC, true, ['deriveBits']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const recoveryCode = generateRecoveryCode();
  const backup = await wrapPrivateKey(pkcs8, recoveryCode);
  const privateKey = await importPrivateKey(pkcs8);
  return { publicJwk, backup, recoveryCode, privateKey };
}

/** Nuovo dispositivo: scarica il backup da Firebase e inserisci il codice. */
async function recoverPrivateKey(backup, code) {
  const salt = b64.from(backup.salt);
  const iv = b64.from(backup.iv);
  const key = await deriveWrapKey(code, salt, backup.iterations);
  let pkcs8;
  try {
    pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64.from(backup.data));
  } catch {
    throw new Error('Codice di recupero errato');
  }
  return importPrivateKey(pkcs8);
}

/**
 * Calcola la chiave di conversazione tra me e un altro utente.
 * Entrambi ottengono la stessa chiave, il server non la conosce mai.
 */
async function deriveConversationKey(myPrivateKey, theirPublicJwk) {
  const theirPublic = await crypto.subtle.importKey('jwk', theirPublicJwk, EC, true, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirPublic }, myPrivateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('ZetaMail v1') },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Cifra un messaggio. `aad` lega il messaggio a un contesto (es. l'id della chat):
 * se qualcuno lo sposta in un'altra chat, la decifratura fallisce.
 */
async function encryptMessage(text, conversationKey, aad = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // nuovo IV per OGNI messaggio
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    conversationKey,
    enc.encode(text)
  );
  return { v: 1, iv: b64.to(iv), ct: b64.to(ct) };
}

async function decryptMessage(message, conversationKey, aad = '') {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64.from(message.iv), additionalData: enc.encode(aad) },
    conversationKey,
    b64.from(message.ct)
  );
  return dec.decode(pt);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('zetamail', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Salva la chiave privata (non estraibile) sul dispositivo. */
async function saveKeyLocally(uid, privateKey) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(privateKey, uid);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/** Restituisce la chiave privata salvata, oppure undefined (serve il recupero). */
async function loadKeyLocally(uid) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('keys').objectStore('keys').get(uid);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

return { generateRecoveryCode, createIdentity, recoverPrivateKey, deriveConversationKey,
         encryptMessage, decryptMessage, saveKeyLocally, loadKeyLocally };
})();

const ZetaMail = (() => {
  const MAX_TEXT = 2000;
  const members = (a, b) => (a < b ? [a, b] : [b, a]);
  const chatIdOf = (a, b) => members(a, b).join('_');
  const codeError = (code, message) => Object.assign(new Error(message), { code });

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const fingerprint = (jwk) => sha256Hex(`${jwk.x}.${jwk.y}`);
  const group = (hex, size, count) => hex.slice(0, size * count).toUpperCase().match(new RegExp(`.{${size}}`, 'g')).join(' ');

  const defaultUi = {
    showRecoveryCode: async (code) => {
      window.prompt('CODICE DI RECUPERO ZETAMAIL - copialo e salvalo in un posto sicuro (non verra\' mostrato di nuovo):', code);
      return window.confirm('Hai salvato il codice? Se perdi il dispositivo E il codice, perdi i vecchi messaggi. Premi OK solo se l\'hai salvato.');
    },
    askRecoveryCode: async (attempt) =>
      window.prompt(attempt ? 'Codice errato, riprova (oppure annulla):' : 'Inserisci il tuo codice di recupero ZetaMail per leggere i messaggi su questo dispositivo:'),
  };

  const defaultPinStore = {
    get: async (me, peer) => { try { return localStorage.getItem(`zm-pin:${me}:${peer}`); } catch { return null; } },
    set: async (me, peer, fp) => { try { localStorage.setItem(`zm-pin:${me}:${peer}`, fp); } catch { /* ignora */ } },
  };

  function create({ fb, uid, showRecoveryCode, askRecoveryCode, keyStore, pinStore }) {
    const { db, doc, getDoc, setDoc, collection, addDoc, query, orderBy, onSnapshot } = fb;
    keyStore = keyStore || { load: ZetaCrypto.loadKeyLocally, save: ZetaCrypto.saveKeyLocally };
    pinStore = pinStore || defaultPinStore;
    let privateKey = null;
    let myJwk = null;
    const keyRef = (id, name) => doc(db, 'users', id, 'keys', name);

    async function createNew() {
      const id = await ZetaCrypto.createIdentity();
      if (!(await showRecoveryCode(id.recoveryCode))) return { state: 'cancelled' };
      await setDoc(keyRef(uid, 'public'), { jwk: id.publicJwk, createdAt: Date.now() });
      await setDoc(keyRef(uid, 'backup'), id.backup);
      await keyStore.save(uid, id.privateKey);
      privateKey = id.privateKey;
      myJwk = id.publicJwk;
      return { state: 'created' };
    }

    async function init() {
      const [pub, backup, local] = [await getDoc(keyRef(uid, 'public')), await getDoc(keyRef(uid, 'backup')), await keyStore.load(uid)];
      if (local && pub.exists()) {
        privateKey = local;
        myJwk = pub.data().jwk;
        return { state: 'ready' };
      }
      if (pub.exists() && backup.exists()) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = await askRecoveryCode(attempt);
          if (!code) return { state: 'locked' };
          try {
            const key = await ZetaCrypto.recoverPrivateKey(backup.data(), code);
            await keyStore.save(uid, key);
            privateKey = key;
            myJwk = pub.data().jwk;
            return { state: 'recovered' };
          } catch {
            /* codice errato: si richiede */
          }
        }
        return { state: 'locked' };
      }
      return createNew();
    }

    const requireReady = () => {
      if (!privateKey) throw codeError('not_ready', 'ZetaMail non e\' pronto: chiama init() prima');
    };

    async function peerJwk(peerUid) {
      const snap = await getDoc(keyRef(peerUid, 'public'));
      if (!snap.exists()) throw codeError('peer_no_keys', 'Questo utente non ha ancora attivato ZetaMail cifrato');
      const jwk = snap.data().jwk;
      const fp = await fingerprint(jwk);
      const pinned = await pinStore.get(uid, peerUid);
      if (pinned && pinned !== fp) throw codeError('key_changed', 'Il codice di sicurezza di questo utente e\' cambiato');
      if (!pinned) await pinStore.set(uid, peerUid, fp);
      return jwk;
    }

    async function conversationKey(peerUid) {
      return ZetaCrypto.deriveConversationKey(privateKey, await peerJwk(peerUid));
    }

    async function send(peerUid, text) {
      requireReady();
      const clean = String(text == null ? '' : text).trim();
      if (!clean) throw codeError('empty', 'Messaggio vuoto');
      if (clean.length > MAX_TEXT) throw codeError('too_long', `Massimo ${MAX_TEXT} caratteri`);
      const key = await conversationKey(peerUid);
      const chatId = chatIdOf(uid, peerUid);
      const chatRef = doc(db, 'mail', chatId);
      if (!(await getDoc(chatRef)).exists()) await setDoc(chatRef, { members: members(uid, peerUid) });
      const msg = await ZetaCrypto.encryptMessage(clean, key, `${chatId}|${uid}`);
      await addDoc(collection(db, 'mail', chatId, 'messages'), { from: uid, v: msg.v, iv: msg.iv, ct: msg.ct, at: Date.now() });
    }

    function listen(peerUid, onMessages, onProblem) {
      requireReady();
      const chatId = chatIdOf(uid, peerUid);
      const q = query(collection(db, 'mail', chatId, 'messages'), orderBy('at'));
      let key = null;
      return onSnapshot(
        q,
        async (snap) => {
          try {
            key = key || (await conversationKey(peerUid));
          } catch (err) {
            if (onProblem) onProblem(err.code || 'error');
            return;
          }
          const out = [];
          for (const d of snap.docs) {
            const m = d.data();
            const base = { id: d.id, from: m.from, mine: m.from === uid, at: m.at };
            try {
              out.push({ ...base, text: await ZetaCrypto.decryptMessage(m, key, `${chatId}|${m.from}`) });
            } catch {
              out.push({ ...base, text: null }); // manomesso, spostato o cifrato per una chiave vecchia
            }
          }
          onMessages(out);
        },
        () => onProblem && onProblem('permission')
      );
    }

    async function safetyCode(peerUid) {
      requireReady();
      const mine = await fingerprint(myJwk);
      const theirs = await fingerprint((await getDoc(keyRef(peerUid, 'public'))).data().jwk);
      return group(await sha256Hex([mine, theirs].sort().join('|')), 4, 5);
    }

    async function trustPeer(peerUid) {
      const snap = await getDoc(keyRef(peerUid, 'public'));
      if (snap.exists()) await pinStore.set(uid, peerUid, await fingerprint(snap.data().jwk));
    }

    return { init, send, listen, safetyCode, trustPeer, reset: createNew };
  }

  return { create, chatIdOf, defaultUi };
})();
