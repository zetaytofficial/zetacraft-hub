// upload-client.js - da incollare in app-logic.js (nessun import).
// Comprime l'immagine in WebP nel browser e la carica sul worker.
//
// PRIMA DI USARLO imposta l'indirizzo del worker:
//   const CDN_URL = 'https://cdn.zetayt.workers.dev';
//
// ESEMPIO (adatta `auth` al tuo Firebase Auth):
//   const url = await uploadProfileImage('avatar', fileInput.files[0], () => auth.currentUser.getIdToken());
//   // poi salva `url` nel profilo (Firestore) al posto del vecchio "Link Immagine Profilo"
//
// NOTE
//   - Disegnare l'immagine su un canvas elimina i metadati (posizione GPS, modello del telefono).
//   - Mostra nel profilo SOLO indirizzi che iniziano con CDN_URL: i link esterni possono rivelare l'IP di chi li apre.

const CDN_URL = 'https://cdn.zetayt.workers.dev';

const IMAGE_SPECS = {
  avatar: { width: 256, height: 256 },
  banner: { width: 960, height: 320 },
};
const MAX_UPLOAD_BYTES = 250000; // sotto il limite di 300 KB del worker

// Ritaglia al centro (come "cover"), ridimensiona e comprime in WebP finche' pesa poco.
async function compressToWebp(file, kind) {
  const spec = IMAGE_SPECS[kind];
  if (!spec) throw new Error('Tipo di immagine non valido');
  if (!file || !file.type.startsWith('image/')) throw new Error('Scegli un\'immagine');

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');

  const scale = Math.max(spec.width / bitmap.width, spec.height / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (spec.width - w) / 2, (spec.height - h) / 2, w, h);
  bitmap.close();

  for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') throw new Error('Questo browser non supporta la compressione WebP');
    if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error('Immagine troppo pesante, scegline una piu\' semplice');
}

// kind = 'avatar' | 'banner'. getToken = funzione che restituisce il token Firebase dell'utente.
async function uploadProfileImage(kind, file, getToken) {
  const blob = await compressToWebp(file, kind);
  const token = await getToken();
  const res = await fetch(`${CDN_URL}/upload/${kind}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Caricamento non riuscito');
  return data.url; // es. https://cdn.zetayt.workers.dev/img/<uid>/avatar?v=1762442000
}

// Cancella le immagini dell'utente (da chiamare quando elimina l'account).
async function deleteMyImages(uid, getToken) {
  const token = await getToken();
  const res = await fetch(`${CDN_URL}/img/${uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Cancellazione non riuscita');
}
