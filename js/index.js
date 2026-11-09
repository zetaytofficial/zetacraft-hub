// cdn-worker - avatar e banner di ZetaCraft Hub su Cloudflare Workers + D1.
//
// COSA FA
//   PUT    /upload/avatar | /upload/banner   carica la TUA immagine (corpo = file .webp, header Authorization: Bearer <token Firebase>)
//   GET    /img/<uid>/avatar | banner        mostra un'immagine (pubblica)
//   DELETE /img/<uid>[/avatar|banner]        cancella: solo il proprietario o gli admin (ADMIN_UIDS).
//                                            Senza "avatar|banner" cancella tutto l'utente (anche i file dei post).
//   PUT    /upload/file                      file per post e commenti: immagini WebP e testo (.txt .log .md .csv).
//                                            Header: Authorization, X-Filename (nome codificato). Programmi, script
//                                            e archivi sono rifiutati con il consiglio di usare un link sicuro.
//   GET    /f/<id>                           mostra il file (immagine o testo semplice)
//   DELETE /f/<id>                           cancella un file: proprietario o admin
//
// SICUREZZA
//   - Il caricamento richiede un token Firebase valido, controllato qui (firma Google, scadenza, progetto).
//   - Il proprietario dell'immagine e' SEMPRE l'uid del token, mai un valore scelto dal client.
//   - Si accettano solo file WebP veri (controllo dei primi byte), max 300 KB.
//   - Massimo 10 caricamenti all'ora per utente.
//   - Nessun segreto nel codice: il progetto Firebase e' un valore pubblico (vedi wrangler.toml).
//
// La compressione in WebP la fa il browser prima dell'invio (vedi upload-client.js).

import { createRemoteJWKSet, jwtVerify } from 'jose';

const MAX_BYTES = 300000;           // deve coincidere con il CHECK di schema.sql
const MAX_UPLOADS_PER_HOUR = 10;
const KINDS = new Set(['avatar', 'banner']);
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const FILE_ID_RE = /^[a-f0-9]{32}$/;
const WEBP_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X']);

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// Verifica il token di accesso di Firebase e restituisce l'uid dell'utente.
async function verifyFirebaseToken(token, env) {
  const { payload } = await jwtVerify(token, JWKS, {
    algorithms: ['RS256'],
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    audience: env.FIREBASE_PROJECT_ID,
  });
  if (typeof payload.sub !== 'string' || !UID_RE.test(payload.sub)) throw new Error('uid non valido');
  return payload.sub;
}

function ascii(bytes, offset, text) {
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

// Un WebP vero inizia con "RIFF", la dimensione, "WEBP" e un blocco VP8/VP8L/VP8X.
export function isWebp(b) {
  if (b.length < 20 || b.length > MAX_BYTES) return false;
  if (!ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return false;
  const riffSize = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
  if (riffSize + 8 !== b.length) return false;
  return WEBP_CHUNKS.has(String.fromCharCode(b[12], b[13], b[14], b[15]));
}

// ---------------------------------------------------------------------------
// FILE NEI POST E NEI COMMENTI
// Si accettano SOLO immagini (WebP, gia' compresse dal browser) e file di testo.
// Programmi, script, archivi e simili sono rifiutati, anche se rinominati:
// per quelli si chiede all'utente di pubblicare un link a una fonte sicura.
// ---------------------------------------------------------------------------
const MAX_USER_BYTES = 5000000; // spazio totale per utente (5 MB)
const IMAGE_EXT = new Set(['webp']);
const TEXT_EXT = new Set(['txt', 'log', 'md', 'csv']);
const DANGEROUS_EXT = new Set([
  // programmi e installer
  'exe', 'msi', 'msp', 'dll', 'sys', 'scr', 'com', 'pif', 'cpl', 'apk', 'aab', 'xapk', 'ipa', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'bin', 'elf', 'so', 'dex', 'class',
  // script
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'sh', 'bash', 'zsh', 'run', 'py', 'pl', 'rb', 'php', 'lua', 'reg', 'inf', 'lnk', 'url',
  // pagine e documenti con contenuto attivo
  'html', 'htm', 'xhtml', 'svg', 'xml', 'swf', 'docm', 'xlsm', 'pptm',
  // archivi, dischi e pacchetti (ci si nasconde di tutto)
  'jar', 'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso', 'img', 'vhd', 'vhdx',
]);
const BLOCK_HINT =
  "Per programmi, mod e file eseguibili non si caricano file: pubblica invece un link a una fonte valida e sicura (ad esempio Modrinth, CurseForge o il sito ufficiale).";

// Nome file sicuro oppure null: niente percorsi, caratteri di controllo o inversione del testo (".exe" nascosto).
export function cleanFilename(raw) {
  let name;
  try {
    name = decodeURIComponent(String(raw || ''));
  } catch {
    return null;
  }
  name = name.split(/[\\/]/).pop().normalize('NFKC').trim();
  if (!name || name.length > 80) return null;
  if (/[\u0000-\u001f\u007f‪-‮⁦-⁩]/.test(name)) return null;
  if (!/^[\p{L}\p{N} ._()\-]+$/u.test(name)) return null;
  return name;
}

// Tutte le estensioni del nome: "a.exe.txt" -> ["exe", "txt"]
function extensions(name) {
  return name.toLowerCase().split('.').slice(1).filter(Boolean);
}

function startsWith(b, ...sig) {
  return sig.every((v, i) => b[i] === v);
}

// Riconosce programmi, archivi e script dai primi byte, qualunque sia il nome del file.
function looksExecutable(b) {
  if (startsWith(b, 0x4d, 0x5a) && b.subarray(0, 64).includes(0)) return true; // MZ (exe, dll): binario con byte nulli
  return (
    startsWith(b, 0x7f, 0x45, 0x4c, 0x46) || // ELF (Linux, Android .so)
    startsWith(b, 0x50, 0x4b, 0x03, 0x04) || // ZIP (anche .apk, .jar, .docx)
    startsWith(b, 0x50, 0x4b, 0x05, 0x06) ||
    startsWith(b, 0xfe, 0xed, 0xfa) || // Mach-O (macOS)
    startsWith(b, 0xce, 0xfa, 0xed, 0xfe) ||
    startsWith(b, 0xcf, 0xfa, 0xed, 0xfe) ||
    startsWith(b, 0xca, 0xfe, 0xba, 0xbe) || // classe Java / binario universale
    startsWith(b, 0x23, 0x21) || // "#!" script con interprete
    startsWith(b, 0x52, 0x61, 0x72, 0x21) || // RAR
    startsWith(b, 0x37, 0x7a, 0xbc, 0xaf) || // 7-Zip
    startsWith(b, 0x1f, 0x8b) || // gzip
    startsWith(b, 0x64, 0x65, 0x78, 0x0a) // DEX di Android
  );
}

function isPlainText(b) {
  if (b.length === 0) return false;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return false;
  }
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
}

function hasActiveContent(b) {
  const head = new TextDecoder('utf-8').decode(b.subarray(0, 1024)).toLowerCase();
  return /<script|<html|<!doctype html|<svg|<\?xml|<iframe|javascript:/.test(head);
}

const refuse = (code, error) => ({ ok: false, code, error });

// Decide se il file si puo' caricare: { ok: true, kind: 'image' | 'text' } oppure { ok: false, code, error }
export function classifyFile(name, bytes) {
  const exts = extensions(name);
  if (exts.length === 0) return refuse('type_not_allowed', "Il file deve avere un'estensione consentita.");
  if (exts.some((e) => DANGEROUS_EXT.has(e)) || looksExecutable(bytes)) {
    return refuse('blocked_executable', `Questo tipo di file non si puo' caricare. ${BLOCK_HINT}`);
  }
  const ext = exts[exts.length - 1];
  if (IMAGE_EXT.has(ext)) {
    return isWebp(bytes) ? { ok: true, kind: 'image' } : refuse('invalid_image', "L'immagine non e' valida: usa il pulsante di caricamento dell'app.");
  }
  if (TEXT_EXT.has(ext)) {
    if (!isPlainText(bytes)) return refuse('invalid_text', "Il file di testo non e' valido (deve essere solo testo).");
    if (hasActiveContent(bytes)) return refuse('blocked_content', 'Il file contiene codice di pagine web o script e non si puo\' caricare.');
    return { ok: true, kind: 'text' };
  }
  return refuse('type_not_allowed', `Tipo di file non consentito. Si possono caricare immagini e file di testo (.txt, .log, .md, .csv). ${BLOCK_HINT}`);
}

function corsHeaders(origin, env) {
  const h = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && origin === env.ALLOWED_ORIGIN) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

export function createHandler({ verify }) {
  async function authenticate(request, env) {
    const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
    if (!m) return null;
    try {
      return await verify(m[1], env);
    } catch {
      return null;
    }
  }

  async function upload(request, env, cors, kind) {
    const uid = await authenticate(request, env);
    if (!uid) return json({ error: 'Accesso richiesto' }, 401, cors);

    const len = Number(request.headers.get('Content-Length'));
    if (!Number.isFinite(len) || len <= 0) return json({ error: 'Content-Length mancante' }, 411, cors);
    if (len > MAX_BYTES) return json({ error: 'Immagine troppo grande (max 300 KB)' }, 413, cors);

    const buf = await request.arrayBuffer();
    if (!isWebp(new Uint8Array(buf))) return json({ error: 'Serve un file WebP valido' }, 415, cors);

    const now = Math.floor(Date.now() / 1000);
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM upload_log WHERE uid = ? AND at > ?')
      .bind(uid, now - 3600)
      .first();
    if (recent && recent.n >= MAX_UPLOADS_PER_HOUR) {
      return json({ error: 'Troppi caricamenti, riprova tra un po\'' }, 429, cors);
    }

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO images (uid, kind, data, content_type, size, updated_at)
         VALUES (?, ?, ?, 'image/webp', ?, ?)
         ON CONFLICT (uid, kind) DO UPDATE SET
           data = excluded.data, size = excluded.size, updated_at = excluded.updated_at`
      ).bind(uid, kind, buf, buf.byteLength, now),
      env.DB.prepare('INSERT INTO upload_log (uid, at) VALUES (?, ?)').bind(uid, now),
      env.DB.prepare('DELETE FROM upload_log WHERE uid = ? AND at < ?').bind(uid, now - 86400),
    ]);

    const url = `${new URL(request.url).origin}/img/${uid}/${kind}?v=${now}`;
    return json({ ok: true, url }, 200, cors);
  }

  async function show(request, env, cors, uid, kind) {
    const row = await env.DB.prepare('SELECT data, content_type, updated_at FROM images WHERE uid = ? AND kind = ?')
      .bind(uid, kind)
      .first();
    if (!row) {
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60', ...cors } });
    }
    const etag = `"${row.updated_at}"`;
    const hasVersion = new URL(request.url).searchParams.has('v');
    const headers = {
      'Content-Type': 'image/webp', // sempre fisso: mai quello salvato o scelto dal client
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': hasVersion ? 'public, max-age=86400' : 'public, max-age=300',
      'ETag': etag,
      ...cors,
    };
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
    // D1 puo' restituire i BLOB come ArrayBuffer o come array di numeri, a seconda della versione.
    const data = Array.isArray(row.data) ? new Uint8Array(row.data) : row.data;
    return new Response(data, { status: 200, headers });
  }

  async function remove(request, env, cors, target, kind) {
    const caller = await authenticate(request, env);
    if (!caller) return json({ error: 'Accesso richiesto' }, 401, cors);
    const admins = new Set(String(env.ADMIN_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean));
    if (caller !== target && !admins.has(caller)) return json({ error: 'Non consentito' }, 403, cors);

    if (kind) {
      await env.DB.prepare('DELETE FROM images WHERE uid = ? AND kind = ?').bind(target, kind).run();
    } else {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM images WHERE uid = ?').bind(target),
        env.DB.prepare('DELETE FROM upload_log WHERE uid = ?').bind(target),
        env.DB.prepare('DELETE FROM attachments WHERE uid = ?').bind(target),
      ]);
    }
    return json({ ok: true }, 200, cors);
  }

  async function uploadFile(request, env, cors) {
    const uid = await authenticate(request, env);
    if (!uid) return json({ error: 'Accesso richiesto' }, 401, cors);

    const name = cleanFilename(request.headers.get('X-Filename'));
    if (!name) return json({ error: 'Nome del file non valido', code: 'bad_name' }, 400, cors);

    const len = Number(request.headers.get('Content-Length'));
    if (!Number.isFinite(len) || len <= 0) return json({ error: 'Content-Length mancante' }, 411, cors);
    if (len > MAX_BYTES) return json({ error: 'File troppo grande (max 300 KB)', code: 'too_big' }, 413, cors);

    const buf = await request.arrayBuffer();
    const verdict = classifyFile(name, new Uint8Array(buf));
    if (!verdict.ok) return json({ error: verdict.error, code: verdict.code }, 415, cors);

    const now = Math.floor(Date.now() / 1000);
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM upload_log WHERE uid = ? AND at > ?')
      .bind(uid, now - 3600)
      .first();
    if (recent && recent.n >= MAX_UPLOADS_PER_HOUR) {
      return json({ error: "Troppi caricamenti, riprova tra un po'", code: 'rate_limit' }, 429, cors);
    }
    const used = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM attachments WHERE uid = ?').bind(uid).first();
    if ((used ? used.total : 0) + buf.byteLength > MAX_USER_BYTES) {
      return json({ error: 'Spazio esaurito: elimina qualche file vecchio', code: 'quota' }, 413, cors);
    }

    const id = crypto.randomUUID().replaceAll('-', '');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO attachments (id, uid, kind, name, data, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
        id, uid, verdict.kind, name, buf, buf.byteLength, now
      ),
      env.DB.prepare('INSERT INTO upload_log (uid, at) VALUES (?, ?)').bind(uid, now),
      env.DB.prepare('DELETE FROM upload_log WHERE uid = ? AND at < ?').bind(uid, now - 86400),
    ]);
    return json({ ok: true, id, kind: verdict.kind, name, size: buf.byteLength, url: `${new URL(request.url).origin}/f/${id}` }, 200, cors);
  }

  async function showFile(request, env, cors, id) {
    const row = await env.DB.prepare('SELECT data, kind, name FROM attachments WHERE id = ?').bind(id).first();
    if (!row) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60', ...cors } });
    const etag = `"${id}"`;
    const headers = {
      // Tipo SEMPRE deciso qui: un file di testo non viene mai servito come pagina web o programma.
      'Content-Type': row.kind === 'image' ? 'image/webp' : 'text/plain; charset=utf-8',
      'Content-Disposition': `inline; filename="${String(row.name).replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'public, max-age=86400',
      'ETag': etag,
      ...cors,
    };
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
    const data = Array.isArray(row.data) ? new Uint8Array(row.data) : row.data;
    return new Response(data, { status: 200, headers });
  }

  async function removeFile(request, env, cors, id) {
    const caller = await authenticate(request, env);
    if (!caller) return json({ error: 'Accesso richiesto' }, 401, cors);
    const row = await env.DB.prepare('SELECT uid FROM attachments WHERE id = ?').bind(id).first();
    if (!row) return json({ error: 'Non trovato' }, 404, cors);
    const admins = new Set(String(env.ADMIN_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean));
    if (caller !== row.uid && !admins.has(caller)) return json({ error: 'Non consentito' }, 403, cors);
    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
    return json({ ok: true }, 200, cors);
  }

  return async function handle(request, env) {
    const cors = corsHeaders(request.headers.get('Origin'), env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    try {
      if (request.method === 'PUT' && parts[0] === 'upload' && parts[1] === 'file' && parts.length === 2) {
        return await uploadFile(request, env, cors);
      }
      if (parts[0] === 'f' && parts.length === 2) {
        if (!FILE_ID_RE.test(parts[1])) return json({ error: 'Richiesta non valida' }, 400, cors);
        if (request.method === 'GET') return await showFile(request, env, cors, parts[1]);
        if (request.method === 'DELETE') return await removeFile(request, env, cors, parts[1]);
      }
      if (request.method === 'PUT' && parts[0] === 'upload' && parts.length === 2) {
        if (!KINDS.has(parts[1])) return json({ error: 'Tipo non valido' }, 400, cors);
        return await upload(request, env, cors, parts[1]);
      }
      if (parts[0] === 'img' && (parts.length === 2 || parts.length === 3)) {
        const [, uid, kind] = parts;
        if (!UID_RE.test(uid) || (kind !== undefined && !KINDS.has(kind))) return json({ error: 'Richiesta non valida' }, 400, cors);
        if (request.method === 'GET' && kind) return await show(request, env, cors, uid, kind);
        if (request.method === 'DELETE') return await remove(request, env, cors, uid, kind);
      }
      return json({ error: 'Non trovato' }, 404, cors);
    } catch (err) {
      console.error('Errore:', err && err.message);
      return json({ error: 'Errore interno' }, 500, cors);
    }
  };
}

const handle = createHandler({ verify: verifyFirebaseToken });

export default {
  fetch: (request, env) => handle(request, env),
};
