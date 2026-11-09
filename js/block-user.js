// block-user.js - ogni utente puo' bloccarne altri: non vede piu' i loro contenuti e non riceve loro messaggi.
// I dati stanno in users/<io>/blocked/<altro>. Le regole di Firestore (vedi sotto) impediscono anche l'invio dei messaggi.
function createBlocklist({ fb, uid }) {
  const { db, doc, setDoc, deleteDoc, collection, getDocs } = fb;
  let blocked = new Set();
  return {
    async load() {
      const snap = await getDocs(collection(db, 'users', uid, 'blocked'));
      blocked = new Set(snap.docs.map((d) => d.id));
      return blocked;
    },
    async block(otherUid) {
      if (!otherUid || otherUid === uid) throw new Error('Utente non valido');
      await setDoc(doc(db, 'users', uid, 'blocked', otherUid), { at: Date.now() });
      blocked.add(otherUid);
    },
    async unblock(otherUid) {
      await deleteDoc(doc(db, 'users', uid, 'blocked', otherUid));
      blocked.delete(otherUid);
    },
    isBlocked: (otherUid) => blocked.has(otherUid),
    // toglie da una lista (post, commenti, messaggi) quelli scritti da utenti bloccati
    filter: (items, authorKey = 'authorId') => items.filter((item) => !blocked.has(item[authorKey])),
  };
}
