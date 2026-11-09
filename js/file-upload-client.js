// file-upload-client.js - da incollare in app-logic.js DOPO upload-client.js (usa la sua CDN_URL).
// Controlla i file e i link prima dell'invio e li carica sul worker. Il worker rifa' gli stessi
// controlli (questo serve solo a dare subito un messaggio chiaro): non e' una protezione.
//
// USO
//   File:  const info = await uploadAttachment(file, () => auth.currentUser.getIdToken());
//          // info.url = indirizzo da salvare nel post o nel commento
//   Link:  vedi link-protection.js

const FILE_BLOCK_HINT =
  'Per programmi, mod e file eseguibili non si caricano file: pubblica invece un link a una fonte valida e sicura (ad esempio Modrinth, CurseForge o il sito ufficiale).';
const ALLOWED_FILE_EXT = ['webp', 'png', 'jpg', 'jpeg', 'gif', 'txt', 'log', 'md', 'csv'];
const BLOCKED_FILE_EXT = [
  'exe', 'msi', 'msp', 'dll', 'sys', 'scr', 'com', 'pif', 'cpl', 'apk', 'aab', 'xapk', 'ipa', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'bin', 'elf', 'so', 'dex', 'class',
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'sh', 'bash', 'zsh', 'run', 'py', 'pl', 'rb', 'php', 'lua', 'reg', 'inf', 'lnk', 'url',
  'html', 'htm', 'xhtml', 'svg', 'xml', 'swf', 'docm', 'xlsm', 'pptm',
  'jar', 'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso', 'img', 'vhd', 'vhdx',
];

// Controllo veloce sul nome del file, prima di caricarlo.
function precheckFile(fileName) {
  const exts = String(fileName).toLowerCase().split('.').slice(1).filter(Boolean);
  if (exts.some((e) => BLOCKED_FILE_EXT.includes(e))) {
    return { ok: false, message: 'Questo tipo di file non si puo\' caricare. ' + FILE_BLOCK_HINT };
  }
  if (!exts.length || !ALLOWED_FILE_EXT.includes(exts[exts.length - 1])) {
    return { ok: false, message: 'Si possono caricare immagini e file di testo (.txt, .log, .md, .csv). ' + FILE_BLOCK_HINT };
  }
  return { ok: true };
}

// Immagine ridotta (max 1280 px sul lato lungo) e compressa in WebP: toglie anche posizione GPS e altri metadati.
async function compressImageForPost(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') throw new Error('Questo browser non supporta la compressione WebP');
    if (blob.size <= 250000) return blob;
  }
  throw new Error("Immagine troppo pesante, scegline una piu' leggera");
}

// Carica un'immagine o un file di testo. Restituisce { id, kind, name, size, url }.
async function uploadAttachment(file, getToken) {
  const pre = precheckFile(file.name);
  if (!pre.ok) throw new Error(pre.message);

  let body = file;
  let name = file.name;
  if (file.type.startsWith('image/')) {
    body = await compressImageForPost(file);
    name = file.name.replace(/\.[^.]*$/, '') + '.webp';
  }
  const res = await fetch(`${CDN_URL}/upload/file`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await getToken()}`, 'X-Filename': encodeURIComponent(name) },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Caricamento non riuscito');
  return data;
}

// I controlli sui link sono in link-protection.js (checkLink, checkLinksInText, safeLinkHtml).
