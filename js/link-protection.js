// link-protection.js - protezione dei link nei post e nei commenti. Da incollare in app-logic.js (nessun import).
//
// IMPORTANTE: se hai gia' incollato file-upload-client.js, CANCELLA da quel file tutta la parte che inizia con
// "// ---------- LINK" fino alla fine (contiene una vecchia checkLink). Questo file la sostituisce.
//
// USO
//   Un link solo (campo "inserisci link"):
//     const r = checkLink(testo);
//     if (r.status === 'blocked') mostraErrore(r.message);       // non si pubblica
//     else if (r.status === 'unknown') mostraAvviso(r.message);  // si pubblica con avviso
//     else /* 'trusted' */ pubblica(r.url);
//
//   Link dentro un testo (post o commento): controlla tutti gli indirizzi che compaiono
//     const problemi = checkLinksInText(testoDelPost);           // [{ link, status, message }, ...]  (solo 'blocked' e 'unknown')
//     if (problemi.some((p) => p.status === 'blocked')) mostraErrore(problemi.find((p) => p.status === 'blocked').message);
//
//   Per mostrare un link cliccabile in modo sicuro usa SOLO safeLinkHtml(r) (vedi in fondo).

// Fonti considerate sicure: nessun avviso. Aggiungine quando vuoi (basta il dominio, senza https://).
const TRUSTED_LINK_DOMAINS = [
  // Minecraft e mod
  'modrinth.com', 'curseforge.com', 'minecraft.net', 'minecraft.wiki', 'planetminecraft.com',
  'papermc.io', 'spigotmc.org', 'fabricmc.net', 'minecraftforge.net', 'neoforged.net',
  // Negozi ufficiali
  'play.google.com', 'apps.apple.com', 'store.steampowered.com', 'amazon.com', 'amazon.it', 'amzn.to',
  // Siti noti
  'youtube.com', 'youtu.be', 'twitch.tv', 'discord.com', 'discord.gg', 'github.com', 'gitlab.com',
  'wikipedia.org', 'google.com', 'proton.me', 'zetacraft-hub.zetayt.workers.dev',
];

// Servizi che nascondono dove porta il link. Bloccati. Il blocco vale per il dominio e per tutto cio' che segue
// (per esempio short.tips/QUALSIASICOSA). I link ufficiali di siti noti (amzn.to, youtu.be, wa.me, ...) NON sono qui.
const LINK_SHORTENERS = [
  'bit.ly', 'bitly.com', 'tinyurl.com', 'cutt.ly', 'is.gd', 'v.gd', 'rb.gy', 'rebrand.ly',
  'shorturl.at', 'adf.ly', 'goo.gl', 'ow.ly', 'tiny.cc', 'buff.ly', 'trib.al', 'soo.gd', 's.id',
  'clck.ru', 'shorte.st', 'bc.vc', 'ouo.io', 'ouo.press', 'linkvertise.com', 'link-to.net',
  'urlz.fr', 'x.co', 'po.st', 'snip.ly', 'short.io', 'shrtco.de', 'tr.ee', 'bl.ink', 'dub.sh',
  'short.tips', 'shorturl.com', 'shorturl.asia', 'shortlink.st', 'surl.li', 'qrco.de', 'sh.st',
  't.ly', 'tny.im', 'chilp.it', 'mcaf.ee', 'u.to', 'zpr.io', 'gg.gg', 'lc.cx',
];

// Link diretti a programmi, archivi e file pericolosi.
const LINK_BLOCKED_EXT = [
  'exe', 'msi', 'msp', 'dll', 'sys', 'scr', 'com', 'pif', 'cpl', 'apk', 'aab', 'xapk', 'ipa', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'bin', 'elf', 'so', 'dex', 'class',
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'sh', 'bash', 'zsh', 'run', 'py', 'pl', 'rb', 'php', 'lua', 'reg', 'inf', 'lnk', 'url',
  'html', 'htm', 'xhtml', 'svg', 'xml', 'swf', 'docm', 'xlsm', 'pptm',
  'jar', 'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso', 'img', 'vhd', 'vhdx',
];

const LINK_MAX_LENGTH = 2000;

// Valuta un link: { status: 'trusted' | 'unknown' | 'blocked', message, url }
function checkLink(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return { status: 'blocked', message: 'Il link e\' vuoto.' };
  if (raw.length > LINK_MAX_LENGTH) return { status: 'blocked', message: 'Il link e\' troppo lungo.' };

  let u;
  try {
    u = new URL(raw);
  } catch {
    return { status: 'blocked', message: 'Il link non e\' valido. Scrivilo completo, ad esempio https://modrinth.com/...' };
  }
  if (u.protocol !== 'https:') return { status: 'blocked', message: 'Sono ammessi solo link che iniziano con https://' };
  if (u.username || u.password) return { status: 'blocked', message: 'Link con nome utente o password non ammessi.' };

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const onList = (list) => list.some((d) => host === d || host.endsWith('.' + d));

  if (!host.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) {
    return { status: 'blocked', message: 'Link con indirizzo numerico o interno non ammessi: usa il sito vero.' };
  }
  if (onList(LINK_SHORTENERS)) {
    return { status: 'blocked', message: 'I link accorciati nascondono la destinazione: incolla il link completo.' };
  }

  // Link diretto a un programma o a un archivio (controlla anche i nomi tipo "mod.exe.png").
  const exts = u.pathname.toLowerCase().split('/').pop().split('.').slice(1);
  if (exts.some((e) => LINK_BLOCKED_EXT.includes(e))) {
    return { status: 'blocked', message: 'Non si possono pubblicare link diretti a programmi o archivi. Metti il link alla pagina ufficiale della mod o del programma.' };
  }

  const trusted = onList(TRUSTED_LINK_DOMAINS);

  // Controllo in piu': dominio cortissimo + poche lettere casuali dopo la barra (x.ab/Kq9fZ) = quasi sempre un accorciatore nuovo.
  const nomeDominio = host.split('.').slice(-2, -1)[0] || '';
  const percorso = u.pathname.replace(/^\/+|\/+$/g, '');
  if (!trusted && nomeDominio.length <= 6 && /^[A-Za-z0-9_-]{3,10}$/.test(percorso) && !u.search) {
    return { status: 'blocked', message: 'Sembra un link accorciato: incolla il link completo.' };
  }

  if (host.split('.').some((part) => part.startsWith('xn--'))) {
    return { status: 'unknown', url: u.href, message: 'Attenzione: l\'indirizzo usa caratteri speciali e potrebbe imitare un altro sito.' };
  }
  if (trusted) return { status: 'trusted', url: u.href, message: '' };
  return { status: 'unknown', url: u.href, message: 'Link esterno non verificato: apri con attenzione e non scaricare programmi sconosciuti.' };
}

// Trova i link scritti dentro un testo e li valuta. Restituisce solo quelli con problemi ('blocked' o 'unknown').
function checkLinksInText(text) {
  const found = String(text == null ? '' : text).match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
  const problems = [];
  for (const piece of new Set(found)) {
    const clean = piece.replace(/[.,;:!?)\]]+$/, '');
    const r = checkLink(/^www\./i.test(clean) ? 'https://' + clean : clean);
    if (r.status !== 'trusted') problems.push({ link: clean, status: r.status, message: r.message });
  }
  return problems;
}

// HTML sicuro per un link cliccabile: solo se e' https e non bloccato. Apre in una nuova scheda senza dare accesso al sito.
// Richiede escapeHtml() di safe-text.js.
function safeLinkHtml(result, label) {
  if (!result || result.status === 'blocked' || !result.url) return '';
  const text = escapeHtml(label || result.url);
  return `<a href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer nofollow ugc">${text}</a>`;
}
