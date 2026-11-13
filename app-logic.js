// ============================================================================
// ZETACRAFT HUB - APP LOGIC (VERSIONE AGGIORNATA E OTTIMIZZATA)
// ============================================================================

const MINECRAFT_SERVER_IP = "zetacraft-ita.aternos.me";
const APP_SHARE_URL = "https://zetacraft-hub.zetayt.workers.dev";
const CDN_URL = "https://zetacraft-hub-upload.zetayt.workers.dev";
const SUPPORT_EMAIL = 'zetalabs.by.zetayt@proton.me';
const CONSENT_VERSION = '1.4';
const LEGAL_PAGE = 'documenti-legali.html';

// CONFIGURAZIONE FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyDoKoRYGIT9ZQ5tMBwDueb5G4zXpDX2bmc",
  authDomain: "zetacraft-hub-app.firebaseapp.com",
  projectId: "zetacraft-hub-app",
  storageBucket: "zetacraft-hub-app.firebasestorage.app",
  messagingSenderId: "936104735638",
  appId: "1:936104735638:web:3ee3080c96b14f03d523b7",
};

let db = null;
let auth = null;
let currentUserProfile = null;
let isRegisterMode = false;
let currentPostFilter = 'all';

let dynamicBlockedWordsCache = [];
let lastBannedWordsFetchTime = 0;
const BANNED_WORDS_CACHE_TTL = 60000;

let fallbackPosts = [];
let userBlocklist = null;

try {
    if (firebaseConfig.apiKey !== "" && typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        auth = firebase.auth();
    }
} catch (e) {
    console.warn("Errore di inizializzazione Firebase:", e);
}

let isAudioEnabled = true;
let isDarkTheme = true;
let isSaveLoginEnabled = true;

const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

// ----------------------------------------------------------------------------
// 1. UTILITY DI SICUREZZA TESTO E FORMATTAZIONE
// ----------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatUserText(value) {
  let out = escapeHtml(value);
  const pair = /&lt;(b|i|u)&gt;([\s\S]*?)&lt;\/\1&gt;/gi;
  let previous;
  do {
    previous = out;
    out = out.replace(pair, (all, tag, inner) => `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`);
  } while (out !== previous);
  return out.replace(/\r?\n/g, '<br>');
}

function safeHttpsUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return '';
    return u.href;
  } catch {
    return '';
  }
}

function safeProfileBanner(value) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return { color: raw, image: '' };
  const image = safeHttpsUrl(raw);
  return image ? { color: 'transparent', image } : { color: '#0077ff', image: '' };
}

// ----------------------------------------------------------------------------
// 2. PROTEZIONE E CONTROLLO LINK
// ----------------------------------------------------------------------------
const TRUSTED_LINK_DOMAINS = [
  'modrinth.com', 'curseforge.com', 'minecraft.net', 'minecraft.wiki', 'planetminecraft.com',
  'papermc.io', 'spigotmc.org', 'fabricmc.net', 'minecraftforge.net', 'neoforged.net',
  'play.google.com', 'apps.apple.com', 'store.steampowered.com', 'amazon.com', 'amazon.it', 'amzn.to',
  'youtube.com', 'youtu.be', 'twitch.tv', 'discord.com', 'discord.gg', 'github.com', 'gitlab.com',
  'wikipedia.org', 'google.com', 'proton.me', 'zetacraft-hub.zetayt.workers.dev',
  'zetacraft-hub-upload.zetayt.workers.dev',
];

const LINK_SHORTENERS = [
  'bit.ly', 'bitly.com', 'tinyurl.com', 'cutt.ly', 'is.gd', 'v.gd', 'rb.gy', 'rebrand.ly',
  'shorturl.at', 't.ly', 'tr.ee', 'lnk.to', 'shrtco.de'
];

const LINK_BLOCKED_EXT = [
  'exe', 'msi', 'dll', 'sys', 'scr', 'apk', 'ipa', 'dmg', 'bin', 'sh', 'bat', 'cmd', 'ps1',
  'vbs', 'js', 'py', 'jar', 'zip', 'rar', '7z', 'iso'
];

function checkLink(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return { status: 'blocked', message: 'Il link è vuoto.' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { status: 'blocked', message: 'Il link non è valido. Usa un indirizzo https://...' };
  }
  if (u.protocol !== 'https:') return { status: 'blocked', message: 'Sono ammessi solo link https://' };

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const onList = (list) => list.some((d) => host === d || host.endsWith('.' + d));

  if (onList(LINK_SHORTENERS)) {
    return { status: 'blocked', message: 'I link accorciati non sono ammessi: incolla il link completo.' };
  }

  const exts = u.pathname.toLowerCase().split('/').pop().split('.').slice(1);
  if (exts.some((e) => LINK_BLOCKED_EXT.includes(e))) {
    return { status: 'blocked', message: 'Non si possono pubblicare link diretti a programmi o archivi.' };
  }

  if (onList(TRUSTED_LINK_DOMAINS)) return { status: 'trusted', url: u.href, message: '' };
  return { status: 'unknown', url: u.href, message: 'Link esterno non verificato: apri con attenzione.' };
}

function safeLinkHtml(result, label) {
  if (!result || result.status === 'blocked' || !result.url) return '';
  const text = escapeHtml(label || result.url);
  return `<a href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer nofollow ugc" style="color:#00d4ff; text-decoration:underline;">${text}</a>`;
}

// ----------------------------------------------------------------------------
// 3. CONSENSO 14 ANNI
// ----------------------------------------------------------------------------
function consentGiven() {
  const box = document.getElementById('consent-check');
  return !!(box && box.checked);
}

function consentRecord() {
  return { ageConfirmed: true, termsVersion: CONSENT_VERSION, acceptedAt: Date.now() };
}

// ----------------------------------------------------------------------------
// 4. GESTIONE BLOCCO UTENTI (BLOCKLIST)
// ----------------------------------------------------------------------------
function createBlocklist({ fb, uid }) {
  const { db } = fb;
  let blocked = new Set();
  return {
    async load() {
      if (!db || !uid) return blocked;
      const snap = await db.collection('users').doc(uid).collection('blocked').get();
      blocked = new Set(snap.docs.map((d) => d.id));
      return blocked;
    },
    async block(otherUid) {
      if (!otherUid || otherUid === uid) throw new Error('Utente non valido');
      await db.collection('users').doc(uid).collection('blocked').doc(otherUid).set({ at: Date.now() });
      blocked.add(otherUid);
    },
    async unblock(otherUid) {
      await db.collection('users').doc(uid).collection('blocked').doc(otherUid).delete();
      blocked.delete(otherUid);
    },
    isBlocked: (otherUid) => blocked.has(otherUid),
    filter: (items, authorKey = 'authorId') => items.filter((item) => !blocked.has(item[authorKey])),
  };
}

// ----------------------------------------------------------------------------
// 5. CANCELLAZIONE ACCOUNT
// ----------------------------------------------------------------------------
function requestAccountDeletion(user) {
  if (!user || !user.uid) {
    window.alert('Accedi prima al tuo account.');
    return;
  }
  const ok = window.confirm("Si aprirà un'email pronta per inviare la richiesta allo staff. Vuoi procedere?");
  if (ok) {
    const clean = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, 100);
    const body = [
      'Richiesta Cancellazione Account ZetaCraft Hub',
      '',
      'Nome utente: ' + clean(user.displayName),
      "Email: " + clean(user.email),
      'ID Account: ' + clean(user.uid),
    ].join('\n');
    window.location.href = 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent('Cancellazione account') + '&body=' + encodeURIComponent(body);
  }
}

// ----------------------------------------------------------------------------
// 6. AUDIO ED EFFETTI
// ----------------------------------------------------------------------------
function playClickSound() {
    if (!isAudioEnabled) return;
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(180, audioCtx.currentTime + 0.035);

        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.035);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + 0.035);
    } catch (e) {}
}

function getRandomHexColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// ----------------------------------------------------------------------------
// 7. ZETAMAIL (MESSAGGI PRIVATI)
// ----------------------------------------------------------------------------
function getZetaMailAddress(usernameTag) {
    if (!usernameTag) return "utente@zh.net";
    let clean = usernameTag.replace('@', '').toLowerCase().trim();
    if (clean.endsWith('@zh.net')) return clean;
    return `${clean}@zh.net`;
}

function listenZetaMailMessages() {
    const listElem = document.getElementById('zetamail-messages-list');
    if (!currentUserProfile || !db) {
        if (listElem) listElem.innerHTML = `<p style="font-size: 10px; color: #888; text-align: center; margin: 10px 0;">Accedi per visualizzare i tuoi messaggi privati.</p>`;
        return;
    }

    const myEmail = getZetaMailAddress(currentUserProfile.usernameTag);

    db.collection("private_messages")
        .where("recipientUid", "==", currentUserProfile.uid)
        .orderBy("createdAt", "desc")
        .onSnapshot(snapshot => {
            if (!listElem) return;
            if (snapshot.empty) {
                listElem.innerHTML = `<p style="font-size: 10px; color: #888; text-align: center; margin: 10px 0;">Nessun messaggio privato ricevuto.</p>`;
                return;
            }

            listElem.innerHTML = snapshot.docs.map(doc => {
                const msg = doc.data();
                if (userBlocklist && userBlocklist.isBlocked(msg.senderUid)) return '';

                const dateStr = msg.createdAt && msg.createdAt.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recente';
                return `
                    <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(0,212,255,0.2); padding: 10px; border-radius: 10px; text-align: left; margin-bottom: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <strong style="font-size: 11px; color: #00d4ff;">Da: ${escapeHtml(msg.senderEmail)}</strong>
                            <span style="font-size: 9px; color: #aaa;">${dateStr}</span>
                        </div>
                        <p style="font-size: 11px; color: #fff; margin: 0; word-break: break-word;">${formatUserText(msg.text)}</p>
                    </div>
                `;
            }).join('');
        }, err => {
            if (listElem) listElem.innerHTML = `<p style="font-size: 10px; color: #ff4757; text-align: center;">Errore caricamento messaggi.</p>`;
        });
}

async function sendZetaMailMessage() {
    if (!currentUserProfile) return alert("Accedi per inviare messaggi privati!");
    if (!consentGiven() && !currentUserProfile.consent) return alert("Devi accettare i Termini prima di inviare messaggi.");

    const recipientInput = document.getElementById('zetamail-recipient-input');
    const textInput = document.getElementById('zetamail-text-input');

    if (!recipientInput || !textInput) return;

    let rawRecipient = recipientInput.value.trim().toLowerCase();
    const rawText = textInput.value.trim();

    if (!rawRecipient || !rawText) return alert("Compila tutti i campi!");

    const recipientTag = rawRecipient.startsWith('@') ? rawRecipient : '@' + rawRecipient.replace(/@zh\.net$/i, '');
    const recipientQuery = await db.collection("users").where("usernameTag", "==", recipientTag).limit(1).get();
    if (recipientQuery.empty) return alert("Destinatario ZetaMail non trovato.");
    const recipientDoc = recipientQuery.docs[0];
    if (recipientDoc.id === currentUserProfile.uid) return alert("Non puoi inviarti un messaggio da solo.");

    const text = await filterProfanity(rawText);

    try {
        await db.collection("private_messages").add({
            senderUid: currentUserProfile.uid,
            senderEmail: getZetaMailAddress(currentUserProfile.usernameTag),
            recipientUid: recipientDoc.id,
            recipientEmail: getZetaMailAddress(recipientTag),
            text: text,
            read: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert("✅ ZetaMail inviata!");
        textInput.value = "";
        recipientInput.value = "";
    } catch (e) {
        alert("Errore invio: " + e.message);
    }
}

// ----------------------------------------------------------------------------
// 8. DIAMANTI E GESTIONE PROFILO (CHIAVE UNIFICATA: zetacraft_diamonds)
// ----------------------------------------------------------------------------
async function addDiamondsToUser(amount = 1) {
    // Il client non assegna valuta: il saldo è letto esclusivamente da Firestore.
    // I premi saranno riattivati dopo l'integrazione dell'endpoint Worker autorizzato.
    const requested = Number(amount);
    if (!Number.isSafeInteger(requested) || requested <= 0) {
        throw new Error("Quantità di diamanti non valida.");
    }
    if (!auth || !auth.currentUser || !currentUserProfile || !db) {
        throw new Error("Accedi con Firebase per visualizzare il saldo.");
    }
    const userRef = db.collection("users").doc(auth.currentUser.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error("Profilo utente non trovato.");
    const balance = Number(userDoc.data().diamonds || 0);
    currentUserProfile.diamonds = Number.isSafeInteger(balance) && balance >= 0 ? balance : 0;
    return currentUserProfile.diamonds;
}

function updateUIWithProfile(profile) {
    const loggedBox = document.getElementById('auth-logged-box');
    const formBox = document.getElementById('auth-form-box');
    const textInput = document.getElementById('post-text-input');
    const linkInput = document.getElementById('post-link-input');
    const publishBtn = document.getElementById('publish-post-btn');
    const profileImgElem = document.getElementById('user-profile-img');
    const bannerPreview = document.getElementById('user-banner-preview');
    const zhAddressElem = document.getElementById('user-zh-address');

    if (profile) {
        currentUserProfile = profile;
        userBlocklist = createBlocklist({ fb: { db }, uid: profile.uid });
        userBlocklist.load().then(() => listenCommunityPosts());

        const displayNameElem = document.getElementById('user-display-name');
        const usernameTagElem = document.getElementById('user-username-tag');

        if (displayNameElem) displayNameElem.innerText = `👋 ${profile.displayName} (${profile.role || 'user'})`;
        if (usernameTagElem) usernameTagElem.innerText = profile.usernameTag;
        if (zhAddressElem) zhAddressElem.innerText = getZetaMailAddress(profile.usernameTag);

        if (profileImgElem) profileImgElem.src = safeHttpsUrl(profile.imgprofile) || "https://visage.surgeplay.com/face/64/Steve";

        if (bannerPreview) {
            const banner = safeProfileBanner(profile.bannerUrl);
            bannerPreview.style.backgroundImage = banner.image ? `url("${banner.image}")` : 'linear-gradient(135deg, #0077ff, #00d4ff)';
            bannerPreview.style.backgroundColor = banner.color;
        }

        if (loggedBox) loggedBox.style.display = "flex";
        if (formBox) formBox.style.display = "none";

        if (textInput) { textInput.disabled = false; textInput.placeholder = "Scrivi qualcosa..."; }
        if (linkInput) { linkInput.disabled = false; linkInput.placeholder = "Incolla un link https://..."; }
        if (publishBtn) { publishBtn.disabled = false; publishBtn.style.opacity = "1"; publishBtn.style.cursor = "pointer"; }

        listenZetaMailMessages();
    } else {
        currentUserProfile = null;
        userBlocklist = null;
        if (loggedBox) loggedBox.style.display = "none";
        if (formBox) formBox.style.display = "flex";

        if (textInput) { textInput.disabled = true; textInput.placeholder = "Accedi per pubblicare..."; }
        if (linkInput) linkInput.disabled = true;
        if (publishBtn) { publishBtn.disabled = true; publishBtn.style.opacity = "0.4"; }
        if (zhAddressElem) zhAddressElem.innerText = "@zh.net";
    }

    listenCommunityPosts();
}

function initAuthListener() {
    if (!auth) return;

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            let profileData = null;
            try {
                const doc = await db.collection("users").doc(user.uid).get();
                if (doc.exists) {
                    profileData = { uid: user.uid, ...doc.data() };
                } else {
                    profileData = {
                        uid: user.uid,
                        displayName: user.displayName || "Utente",
                        usernameTag: "@" + (user.displayName ? user.displayName.toLowerCase().replace(/\s+/g, '_') : "utente"),
                        imgprofile: user.photoURL || "https://visage.surgeplay.com/face/64/Steve",
                        bannerUrl: getRandomHexColor(),
                        bio: "",
                        email: user.email || "",
                        showEmail: false,
                        role: "user",
                        diamonds: 0,
                        consent: consentRecord()
                    };
                }
            } catch (e) {
                profileData = { 
                    uid: user.uid,
                    displayName: user.displayName || "Utente", 
                    usernameTag: "@utente", 
                    imgprofile: user.photoURL || "https://visage.surgeplay.com/face/64/Steve",
                    bannerUrl: getRandomHexColor(),
                    bio: "",
                    email: user.email || "",
                    showEmail: false,
                    role: "user",
                    diamonds: 0
                };
            }
            updateUIWithProfile(profileData);
        } else {
            checkExternalSessions();
        }
    });
}

function checkExternalSessions() {
    // Le sessioni OAuth costruite dal frontend non sono autenticazioni affidabili.
    localStorage.removeItem('discord_user');
    localStorage.removeItem('custom_oauth_user');
    updateUIWithProfile(null);
    return false;
}

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    const regFields = document.getElementById('reg-fields');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleBtn = document.getElementById('toggle-auth-mode-btn');
    const modeTitle = document.getElementById('auth-mode-title');

    if (isRegisterMode) {
        if (regFields) regFields.style.display = 'flex';
        if (submitBtn) submitBtn.innerText = 'REGISTRATI';
        if (toggleBtn) toggleBtn.innerText = 'Hai già un account? Accedi';
        if (modeTitle) modeTitle.innerText = 'CREA NUOVO ACCOUNT';
    } else {
        if (regFields) regFields.style.display = 'none';
        if (submitBtn) submitBtn.innerText = 'ACCEDI';
        if (toggleBtn) toggleBtn.innerText = 'Non hai un account? Registrati';
        if (modeTitle) modeTitle.innerText = 'ACCEDI';
    }

    if (typeof turnstile !== 'undefined') {
        try { turnstile.reset(); } catch(e) {}
    }
}

async function handleAuthSubmit() {
    if (!consentGiven()) {
        alert("⚠️ Devi dichiarare di avere almeno 14 anni e accettare i Termini e la Privacy Policy!");
        return;
    }

    const emailInput = document.getElementById('auth-email-input');
    const passwordInput = document.getElementById('auth-password-input');

    if (!emailInput || !passwordInput) return;

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        alert("Inserisci Email e Password!");
        return;
    }

    const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');
    if (!turnstileResponse || !turnstileResponse.value.trim()) {
        alert("⚠️ DEVI COMPLETARE LA VERIFICA DI CLOUDFLARE TURNSTILE PER CONTINUARE!");
        return;
    }

    if (!auth) {
        alert("Firebase Auth non è attivo!");
        return;
    }

    try {
        if (isRegisterMode) {
            const displayName = document.getElementById('auth-displayName-input').value.trim();
            let usernameTag = document.getElementById('auth-username-input').value.trim();
            let imgprofile = document.getElementById('auth-imgprofile-input').value.trim();
            let bannerUrl = document.getElementById('auth-banner-input').value.trim();

            if (!displayName || !usernameTag) {
                alert("Compila i campi obbligatori (Nome Visualizzato e Nome Utente con @)!");
                return;
            }

            if (!usernameTag.startsWith('@')) usernameTag = '@' + usernameTag;
            usernameTag = usernameTag.toLowerCase();

            if (!imgprofile) imgprofile = `https://visage.surgeplay.com/face/64/${displayName.replace(/\s+/g, '')}`;
            if (!bannerUrl) bannerUrl = getRandomHexColor();

            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            await db.collection("users").doc(user.uid).set({
                displayName,
                usernameTag,
                imgprofile,
                bannerUrl,
                bio: "",
                email,
                showEmail: false,
                role: "user",
                diamonds: 0,
                consent: consentRecord(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            alert("Registrazione completata con successo!");
        } else {
            await auth.signInWithEmailAndPassword(email, password);
        }

        if (typeof turnstile !== 'undefined') {
            try { turnstile.reset(); } catch(e) {}
        }
    } catch (err) {
        alert("Errore: " + err.message);
        if (typeof turnstile !== 'undefined') {
            try { turnstile.reset(); } catch(e) {}
        }
    }
}

async function handleSocialLogin(provider, providerName) {
    if (!consentGiven()) {
        alert("⚠️ Devi dichiarare di avere almeno 14 anni e accettare i Termini e la Privacy Policy!");
        return;
    }
    if (!auth || !db) return alert("Firebase non è inizializzato!");

    try {
        const result = await auth.signInWithPopup(provider);
        const user = result.user;
        const userDocRef = db.collection("users").doc(user.uid);
        const doc = await userDocRef.get();

        if (!doc.exists) {
            const cleanName = user.displayName || `Utente ${providerName}`;
            const autoUsername = "@" + cleanName.toLowerCase().replace(/\s+/g, "_");
            const photoUrl = user.photoURL || `https://visage.surgeplay.com/face/64/${cleanName.replace(/\s+/g, '')}`;

            await userDocRef.set({
                displayName: cleanName,
                usernameTag: autoUsername,
                imgprofile: photoUrl,
                bannerUrl: getRandomHexColor(),
                bio: "",
                email: user.email || "",
                showEmail: false,
                role: "user",
                diamonds: 0,
                consent: consentRecord(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (error) {
        alert(`Errore Accesso con ${providerName}: ${error.message}`);
    }
}

async function handleLogout() {
    if (auth) await auth.signOut();
    else updateUIWithProfile(null);
}

function openProfileSettingsModal() {
    if (!currentUserProfile) return;
    document.getElementById('edit-display-name').value = currentUserProfile.displayName || '';
    document.getElementById('edit-username-tag').value = currentUserProfile.usernameTag || '';
    document.getElementById('edit-img-profile').value = currentUserProfile.imgprofile || '';
    document.getElementById('edit-banner-url').value = currentUserProfile.bannerUrl || '';
    document.getElementById('edit-bio').value = currentUserProfile.bio || '';
    document.getElementById('edit-email').value = currentUserProfile.email || '';
    document.getElementById('edit-show-email').checked = currentUserProfile.showEmail || false;
    document.getElementById('edit-password').value = '';

    const modal = document.getElementById('profile-settings-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeProfileSettingsModal() {
    const modal = document.getElementById('profile-settings-modal');
    if (modal) modal.classList.add('hidden');
}

async function saveProfileSettings() {
    if (!currentUserProfile || !auth || !db) return;

    const displayName = document.getElementById('edit-display-name').value.trim();
    let usernameTag = document.getElementById('edit-username-tag').value.trim();
    const imgprofile = document.getElementById('edit-img-profile').value.trim();
    let bannerUrl = document.getElementById('edit-banner-url').value.trim();
    const bio = document.getElementById('edit-bio').value.trim();
    const email = document.getElementById('edit-email').value.trim();
    const showEmail = document.getElementById('edit-show-email').checked;
    const newPassword = document.getElementById('edit-password').value.trim();

    if (!displayName || !usernameTag) {
        alert("Il nome visualizzato e il nome utente sono obbligatori!");
        return;
    }
    if (displayName.length > 40 || usernameTag.length > 32 || bio.length > 300) {
        alert("Nome massimo 40 caratteri, username 32 e bio 300.");
        return;
    }
    if (imgprofile && !safeHttpsUrl(imgprofile)) {
        alert("L'immagine profilo deve essere un URL HTTPS valido.");
        return;
    }
    if (bannerUrl && !/^#[0-9a-f]{6}$/i.test(bannerUrl) && !safeHttpsUrl(bannerUrl)) {
        alert("La copertina deve essere un colore HEX (#RRGGBB) oppure un URL HTTPS valido.");
        return;
    }

    if (!usernameTag.startsWith('@')) usernameTag = '@' + usernameTag;
    usernameTag = usernameTag.toLowerCase();

    if (!bannerUrl) bannerUrl = getRandomHexColor();

    try {
        const checkQuery = await db.collection("users")
            .where("usernameTag", "==", usernameTag)
            .get();

        let isTaken = false;
        checkQuery.forEach(doc => {
            if (doc.id !== currentUserProfile.uid) {
                isTaken = true;
            }
        });

        if (isTaken) {
            alert("⚠️ Questo nome utente o indirizzo ZetaMail è già stato preso da un altro utente!");
            return;
        }
        const user = auth.currentUser;
        if (user && newPassword) {
            await user.updatePassword(newPassword);
        }

        const updatedData = {
            displayName,
            usernameTag,
            imgprofile: imgprofile || currentUserProfile.imgprofile,
            bannerUrl,
            bio,
            email: email || currentUserProfile.email,
            showEmail,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection("users").doc(currentUserProfile.uid).update(updatedData);

        currentUserProfile = { ...currentUserProfile, ...updatedData };

        updateUIWithProfile(currentUserProfile);
        closeProfileSettingsModal();
        alert("✅ Profilo aggiornato con successo!");
    } catch (e) {
        alert("Errore durante il salvataggio del profilo: " + e.message);
    }
}

async function openPublicProfile(userId) {
    if (!db) return;

    try {
        const doc = await db.collection("users").doc(userId).get();
        if (!doc.exists) {
            alert("Profilo utente non trovato.");
            return;
        }

        const data = doc.data();

        document.getElementById('pub-profile-name').innerText = data.displayName || "Utente";
        document.getElementById('pub-profile-tag').innerText = data.usernameTag || "@utente";
        document.getElementById('pub-profile-bio').innerText = data.bio || "Nessuna bio inserita.";
        document.getElementById('pub-profile-role').innerText = (data.role || "user").toUpperCase();
        const imgElem = document.getElementById('pub-profile-img');
        if (imgElem) imgElem.src = safeHttpsUrl(data.imgprofile) || "https://visage.surgeplay.com/face/64/Steve";

        const bannerElem = document.getElementById('pub-profile-banner');
        const banner = safeProfileBanner(data.bannerUrl);
        if (bannerElem) {
            bannerElem.style.backgroundImage = banner.image ? `url("${banner.image}")` : 'linear-gradient(135deg, #0077ff, #00d4ff)';
            bannerElem.style.backgroundColor = banner.color;
        }

        const diamondsValue = Number(data.diamonds || 0);
        const diamonds = Number.isSafeInteger(diamondsValue) && diamondsValue >= 0 ? diamondsValue : 0;
        const diamondsElem = document.getElementById('pub-profile-diamonds');
        if (diamondsElem) diamondsElem.innerText = diamonds;

        const emailContainer = document.getElementById('pub-profile-email-container');
        const emailElem = document.getElementById('pub-profile-email');
        if (data.showEmail && data.email) {
            if (emailElem) emailElem.innerText = data.email;
            if (emailContainer) emailContainer.style.display = 'block';
        } else {
            if (emailContainer) emailContainer.style.display = 'none';
        }

        const blockBtn = document.getElementById('pub-profile-block-btn');
        if (blockBtn && currentUserProfile) {
            const isBlocked = userBlocklist && userBlocklist.isBlocked(userId);
            blockBtn.innerText = isBlocked ? "✅ SBLOCCA" : "🚫 BLOCCO";
            blockBtn.onclick = async () => {
                if (isBlocked) {
                    await userBlocklist.unblock(userId);
                    alert("Utente sbloccato.");
                } else {
                    await userBlocklist.block(userId);
                    alert("Utente bloccato.");
                }
                closePublicProfileModal();
                listenCommunityPosts();
            };
        }

        const sendMailBtn = document.getElementById('pub-profile-send-mail-btn');
        if (sendMailBtn) {
            sendMailBtn.onclick = () => {
                closePublicProfileModal();
                switchTab('zetamail', 'ZETAMAIL', null);
                const recipientField = document.getElementById('zetamail-recipient-input');
                if (recipientField) {
                    recipientField.value = getZetaMailAddress(data.usernameTag);
                }
            };
        }

        const modal = document.getElementById('public-profile-modal');
        if (modal) modal.classList.remove('hidden');
    } catch (e) {}
}

function closePublicProfileModal() {
    const modal = document.getElementById('public-profile-modal');
    if (modal) modal.classList.add('hidden');
}

function openBottomSheet() {
    const sheet = document.getElementById('bottom-sheet-overlay');
    if (sheet) sheet.classList.add('active');
}

function closeBottomSheet() {
    const sheet = document.getElementById('bottom-sheet-overlay');
    if (sheet) sheet.classList.remove('active');
}

function switchTab(tabId, titleText, element) {
    const currentActivePanel = document.querySelector('.tab-panel.active');
    const targetPanel = document.getElementById('tab-' + tabId);

    if (currentActivePanel === targetPanel) return;

    if (currentActivePanel) {
        currentActivePanel.style.opacity = '0';
        currentActivePanel.style.transform = 'scale(0.96) translateY(-10px)';

        setTimeout(() => {
            currentActivePanel.classList.remove('active');

            if (targetPanel) {
                targetPanel.classList.add('active');
                targetPanel.style.opacity = '0';
                targetPanel.style.transform = 'scale(0.96) translateY(10px)';

                setTimeout(() => {
                    targetPanel.style.opacity = '1';
                    targetPanel.style.transform = 'scale(1) translateY(0)';
                }, 50);
            }
        }, 200);
    } else if (targetPanel) {
        targetPanel.classList.add('active');
        targetPanel.style.opacity = '1';
        targetPanel.style.transform = 'scale(1) translateY(0)';
    }

    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (element && element.classList.contains('nav-item')) {
        element.classList.add('active');
    }

    const titleElem = document.getElementById('app-title');
    if (titleElem && titleText) {
        titleElem.innerText = titleText;
    }
}

function loadSettingsFromStorage() {
    try {
        const consentChoice = localStorage.getItem('zetacraft_data_saved');

        if (consentChoice === 'accepted') {
            isAudioEnabled = localStorage.getItem('zetacraft_audio_enabled') !== 'false';
            isDarkTheme = localStorage.getItem('zetacraft_dark_theme') !== 'false';
            isSaveLoginEnabled = localStorage.getItem('zetacraft_save_login') !== 'false';
        } else if (consentChoice === 'rejected') {
            isAudioEnabled = false;
            isDarkTheme = true;
            isSaveLoginEnabled = false;
        } else {
            const modal = document.getElementById('welcome-modal');
            if (modal) modal.classList.remove('hidden');
        }
    } catch (e) {}

    applySettingsUI();
}

function handleAcceptData() {
    isAudioEnabled = true;
    isDarkTheme = true;
    isSaveLoginEnabled = true;
    try {
        localStorage.setItem('zetacraft_audio_enabled', 'true');
        localStorage.setItem('zetacraft_dark_theme', 'true');
        localStorage.setItem('zetacraft_save_login', 'true');
        localStorage.setItem('zetacraft_data_saved', 'accepted');
    } catch (e) {}

    applySettingsUI();

    const modal = document.getElementById('welcome-modal');
    if (modal) modal.classList.add('hidden');
}

function handleRejectData() {
    isAudioEnabled = false;
    isDarkTheme = true;
    isSaveLoginEnabled = false;

    try {
        localStorage.setItem('zetacraft_data_saved', 'rejected');
        localStorage.removeItem('zetacraft_audio_enabled');
        localStorage.removeItem('zetacraft_dark_theme');
        localStorage.removeItem('zetacraft_save_login');
    } catch (e) {}

    applySettingsUI();

    const modal = document.getElementById('welcome-modal');
    if (modal) modal.classList.add('hidden');
}

function applySettingsUI() {
    const audioBtn = document.getElementById('audio-toggle-btn');
    if (audioBtn) audioBtn.innerText = isAudioEnabled ? "ATTIVATO" : "DISATTIVATO";

    const themeBtn = document.getElementById('theme-toggle-btn');
    if (isDarkTheme) {
        document.body.classList.remove('light-theme');
        if (themeBtn) themeBtn.innerText = "SCURO";
    } else {
        document.body.classList.add('light-theme');
        if (themeBtn) themeBtn.innerText = "CHIARO";
    }

    if (auth && typeof firebase !== 'undefined') {
        try {
            const persistence = isSaveLoginEnabled 
                ? firebase.auth.Auth.Persistence.LOCAL
                : firebase.auth.Auth.Persistence.SESSION;
            auth.setPersistence(persistence);
        } catch(e) {}
    }
}

function openDataModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal) modal.classList.remove('hidden');
}

function toggleAudioSetting() {
    isAudioEnabled = !isAudioEnabled;
    try { localStorage.setItem('zetacraft_audio_enabled', isAudioEnabled); } catch (e) {}
    applySettingsUI();
}

function toggleThemeSetting() {
    isDarkTheme = !isDarkTheme;
    try { localStorage.setItem('zetacraft_dark_theme', isDarkTheme); } catch (e) {}
    applySettingsUI();
}

function copyServerIP() {
    const btnText = document.getElementById('copy-btn-text');
    if (navigator.clipboard) {
        navigator.clipboard.writeText(MINECRAFT_SERVER_IP).then(() => {
            if (btnText) btnText.innerText = "COPIATO! ✓";
            setTimeout(() => { if (btnText) btnText.innerText = "📋 COPIA IP"; }, 2000);
        });
    }
}

function copyAppLink() {
    const btnText = document.getElementById('copy-app-link-btn-text');
    if (navigator.clipboard) {
        navigator.clipboard.writeText(APP_SHARE_URL).then(() => {
            if (btnText) btnText.innerText = "LINK COPIATO! ✓";
            setTimeout(() => { if (btnText) btnText.innerText = "Copia Link dell'Applicazione"; }, 2000);
        });
    }
}

function startRealtimeClock() {
    const clockElement = document.getElementById('realtime-clock');
    if (!clockElement) return;

    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        clockElement.textContent = `${hours}:${minutes}:${seconds}`;
    }

    updateClock();
    setInterval(updateClock, 1000);
}

function parseEmbedLink(url) {
    if (!url) return { type: 'none', url: '' };
    const cleanUrl = url.trim();

    if (cleanUrl.includes('youtube.com/watch') || cleanUrl.includes('youtu.be/')) {
        let videoId = cleanUrl.includes('youtu.be/') ? cleanUrl.split('youtu.be/')[1].split('?')[0] : new URLSearchParams(cleanUrl.split('?')[1]).get('v');
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return { type: 'link', url: cleanUrl };
        return { type: 'youtube', url: `https://www.youtube.com/embed/${videoId}` };
    }
    if (/\.(jpeg|jpg|gif|png|webp)($|\?)/i.test(cleanUrl)) {
        return { type: 'image', url: cleanUrl };
    }
    if (/\.(mp3|wav|ogg)($|\?)/i.test(cleanUrl)) {
        return { type: 'audio', url: cleanUrl };
    }
    try {
        const parsed = new URL(cleanUrl);
        if (parsed.protocol === 'https:' && (parsed.hostname === 'open.spotify.com' || parsed.hostname === 'spotify.com')) {
            return { type: 'spotify', url: `https://open.spotify.com/embed${parsed.pathname}` };
        }
    } catch {}

    return { type: 'link', url: cleanUrl };
}

const fallbackBlockedWords = [
    'cazzo', 'merda', 'stronzo', 'stronza', 'vaffanculo', 'puttana', 
    'troia', 'bastardo', 'minchia', 'culo', 'porco', 'porca', 'ciola'
];

async function getBlockedWords() {
    const now = Date.now();
    if (dynamicBlockedWordsCache.length > 0 && (now - lastBannedWordsFetchTime < BANNED_WORDS_CACHE_TTL)) {
        return dynamicBlockedWordsCache;
    }

    if (!db) return fallbackBlockedWords;

    try {
        const snapshot = await db.collection("bannedworlds").get();
        const words = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            const possibleValues = Object.values(data);
            possibleValues.forEach(val => {
                if (val && typeof val === 'string') {
                    words.push(val.trim().toLowerCase());
                }
            });
        });

        if (words.length > 0) {
            const uniqueWords = [...new Set(words)];
            dynamicBlockedWordsCache = uniqueWords;
            lastBannedWordsFetchTime = now;
            return uniqueWords;
        }
    } catch (e) {}

    return fallbackBlockedWords;
}

async function filterProfanity(text) {
    if (!text) return "";
    let filteredText = text;
    const wordsToBlock = await getBlockedWords();

    wordsToBlock.forEach(word => {
        if (!word) return;
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedWord}\\b`, 'gi');

        filteredText = filteredText.replace(regex, (match) => {
            return '*'.repeat(match.length);
        });
    });
    return filteredText;
}

function setPostFilter(filterType) {
    currentPostFilter = filterType;

    const allBtn = document.getElementById('filter-all-btn');
    const staffBtn = document.getElementById('filter-staff-btn');
    const usersBtn = document.getElementById('filter-users-btn');

    if (allBtn && staffBtn && usersBtn) {
        allBtn.style.background = filterType === 'all' ? 'rgba(0,212,255,0.3)' : 'rgba(0,212,255,0.1)';
        staffBtn.style.background = filterType === 'staff' ? 'linear-gradient(135deg, #00d4ff, #0077ff)' : 'rgba(255,255,255,0.1)';
        usersBtn.style.background = filterType === 'user' ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.1)';
    }

    listenCommunityPosts();
}

async function publishCommunityPost() {
    if (!currentUserProfile) return alert("Devi accedere per pubblicare!");
    if (!consentGiven() && !currentUserProfile.consent) return alert("Devi accettare i Termini prima di pubblicare.");

    const textInput = document.getElementById('post-text-input');
    const linkInput = document.getElementById('post-link-input');

    const rawText = textInput ? textInput.value.trim() : "";
    const rawLink = linkInput ? linkInput.value.trim() : "";

    if (!rawText && !rawLink) return;

    let finalLink = rawLink;
    if (rawLink) {
        const linkCheck = checkLink(rawLink);
        if (linkCheck.status === 'blocked') {
            return alert("❌ " + linkCheck.message);
        }
        if (linkCheck.status === 'unknown') {
            if (!confirm("⚠️ " + linkCheck.message + "\nVuoi continuare?")) return;
        }
        finalLink = linkCheck.url;
    }

    const text = await filterProfanity(rawText);

    const authorName = currentUserProfile.displayName || "Utente";
    const usernameTag = currentUserProfile.usernameTag || "@utente";
    const imgprofile = currentUserProfile.imgprofile || `https://visage.surgeplay.com/face/64/${authorName.replace(/\s+/g, '')}`;
    const userRole = currentUserProfile.role || "user";
    const mediaData = parseEmbedLink(finalLink);

    const postData = {
        authorId: currentUserProfile.uid,
        authorName,
        usernameTag,
        imgprofile,
        role: userRole,
        text,
        mediaUrl: mediaData.url,
        mediaType: mediaData.type,
        likeCount: 0,
        likes: {},
        reports: 0,
        createdAt: db ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
    };

    if (db) {
        try {
            await db.collection("posts").add(postData);
        } catch (err) {
            alert("Errore invio post: " + err.message);
        }
    }

    if (textInput) textInput.value = "";
    if (linkInput) linkInput.value = "";
}

async function reportPost(postId) {
    if (!currentUserProfile) return alert("Accedi per segnalare.");
    if (!confirm("🚩 Vuoi segnalare questo post allo staff?")) return;
    try {
        await db.collection("reports").add({
            reporterId: currentUserProfile.uid, targetType: "post", targetId: postId,
            reason: "Segnalazione community", createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: "open"
        });
        alert("✅ Segnalazione inviata allo staff.");
    } catch (e) { alert("Errore durante la segnalazione: " + e.message); }
}

async function toggleLikePost(postId) {
    if (!currentUserProfile) return alert("Accedi per mettere Mi Piace!");
    const uid = currentUserProfile.uid;
    const postRef = db.collection("posts").doc(postId);

    try {
        await db.runTransaction(async (transaction) => {
            const postDoc = await transaction.get(postRef);
            if (!postDoc.exists) return;

            const data = postDoc.data();
            const likes = data.likes || {};
            let count = data.likeCount || 0;

            if (likes[uid]) {
                delete likes[uid];
                count = Math.max(0, count - 1);
            } else {
                likes[uid] = true;
                count += 1;
            }
            transaction.update(postRef, { likes, likeCount: count });
        });
    } catch (e) {}
}

async function deletePost(postId) {
    if (!confirm("Sei sicuro di voler eliminare questo post?")) return;
    try {
        await db.collection("posts").doc(postId).delete();
    } catch (e) {
        alert("Errore durante l'eliminazione: " + e.message);
    }
}

async function submitComment(postId) {
    if (!currentUserProfile) return alert("Accedi per commentare!");
    if (!consentGiven() && !currentUserProfile.consent) return alert("Devi accettare i Termini prima di commentare.");

    const commentInput = document.getElementById(`comment-input-${postId}`);
    if (!commentInput) return;

    const rawText = commentInput.value.trim();
    if (!rawText) return;

    const text = await filterProfanity(rawText);

    try {
        await db.collection("posts").doc(postId).collection("comments").add({
            postId,
            authorId: currentUserProfile.uid,
            parentCommentId: null,
            authorName: currentUserProfile.displayName,
            usernameTag: currentUserProfile.usernameTag,
            imgprofile: currentUserProfile.imgprofile,
            text,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        commentInput.value = "";
    } catch (e) {
        alert("Errore invio commento: " + e.message);
    }
}

function renderCommunityPosts(postsList) {
    const container = document.getElementById('community-posts-list');
    if (!container) return;

    let filteredList = postsList;
    if (userBlocklist) {
        filteredList = userBlocklist.filter(postsList, 'authorId');
    }

    const staffRoles = ['founder', 'admin', 'tester', 'modder', 'helper', 'staff', 'owner'];

    filteredList = filteredList.filter(post => {
        const isStaff = staffRoles.includes(post.role) || post.id === 'fallback-1';
        if (currentPostFilter === 'staff') return isStaff;
        if (currentPostFilter === 'user') return !isStaff;
        return true;
    });

    if (!filteredList || filteredList.length === 0) {
        container.innerHTML = `<p class="options-subtitle">Nessun post trovato con questo filtro.</p>`;
        return;
    }

    const currentUid = currentUserProfile ? currentUserProfile.uid : null;
    const isUserAdmin = currentUserProfile && (currentUserProfile.role === "admin" || currentUserProfile.role === "founder");

    container.innerHTML = filteredList.map(post => {
        let mediaHtml = "";

        if (post.mediaType === 'youtube') {
            mediaHtml = `<div style="margin-top:8px; border-radius:12px; overflow:hidden; aspect-ratio:16/9;"><iframe src="${safeHttpsUrl(post.mediaUrl)}" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" style="width:100%; height:100%; border:none;" title="Video YouTube" loading="lazy"></iframe></div>`;
        } else if (post.mediaType === 'image') {
            mediaHtml = `<img src="${safeHttpsUrl(post.mediaUrl)}" style="width:100%; max-height:240px; object-fit:cover; border-radius:12px; margin-top:8px;" />`;
        } else if (post.mediaType === 'audio') {
            mediaHtml = `<audio controls style="width:100%; margin-top:8px;"><source src="${safeHttpsUrl(post.mediaUrl)}"></audio>`;
        } else if (post.mediaType === 'spotify') {
            mediaHtml = `<iframe src="${safeHttpsUrl(post.mediaUrl)}" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" width="100%" height="80" frameborder="0" style="border-radius:12px; margin-top:8px;" title="Player Spotify" loading="lazy"></iframe>`;
        } else if (post.mediaType === 'link' && post.mediaUrl) {
            const linkRes = checkLink(post.mediaUrl);
            mediaHtml = `
                <div style="margin-top:8px; padding:8px 12px; background:rgba(0, 212, 255, 0.08); border:1px solid rgba(0, 212, 255, 0.25); border-radius:10px;">
                    ${safeLinkHtml(linkRes, post.mediaUrl)}
                </div>`;
        }

        const avatarSrc = safeHttpsUrl(post.imgprofile) || 'https://visage.surgeplay.com/face/64/Steve';
        const likes = post.likes || {};
        const isLiked = currentUid && likes[currentUid];
        const likeCount = post.likeCount || 0;
        const canDelete = currentUid && (post.authorId === currentUid || isUserAdmin);

        const isStaffPost = staffRoles.includes(post.role) || post.id === 'fallback-1';

        const cardStyle = isStaffPost 
            ? 'background: rgba(0, 212, 255, 0.1); border: 1px solid rgba(0, 212, 255, 0.4);' 
            : 'background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.08);';

        const staffBadge = isStaffPost 
            ? `<span style="background: linear-gradient(135deg, #00d4ff, #0077ff); color: #fff; font-size: 8px; font-weight: bold; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">🛡️ ${(post.role || 'STAFF').toUpperCase()}</span>` 
            : '';

        return `
            <div class="setting-row" style="flex-direction:column; align-items:stretch; text-align:left; ${cardStyle} position:relative; border-radius: 12px; padding: 12px; margin-bottom: 8px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px; cursor:pointer;" onclick="openPublicProfile('${post.authorId}')">
                        <img src="${avatarSrc}" style="width:28px; height:28px; border-radius:50%; object-fit:cover; border: 1px solid ${isStaffPost ? '#00d4ff' : 'rgba(255, 255, 255, 0.2)'};" />
                        <div style="display:flex; align-items:center;">
                            <strong style="font-size:11px; color:${isStaffPost ? '#00d4ff' : '#fff'};">${escapeHtml(post.authorName)}</strong>
                            ${staffBadge}
                        </div>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button onclick="reportPost('${post.id}')" style="background:none; border:none; font-size:11px; cursor:pointer;" title="Segnala Post">🚩</button>
                        ${canDelete ? `<button onclick="deletePost('${post.id}')" style="background:none; border:none; color:#ff4757; font-size:12px; cursor:pointer;" title="Elimina Post">🗑️</button>` : ''}
                    </div>
                </div>

                <span style="font-size:9px; color:#aaa; margin-left: 36px; margin-top: -4px; display: block;">${escapeHtml(post.usernameTag || '')}</span>

                ${post.text ? `<p style="font-size:11px; margin-top:8px; color:#fff;">${formatUserText(post.text)}</p>` : ''}
                ${mediaHtml}

                <div style="display:flex; align-items:center; gap:12px; margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">
                    <button onclick="toggleLikePost('${post.id}')" style="background:none; border:none; color:${isLiked ? '#00d4ff' : '#aaa'}; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:4px;">
                        ${isLiked ? '❤️' : '🤍'} <span>${likeCount}</span>
                    </button>
                    <button onclick="toggleCommentsView('${post.id}')" style="background:none; border:none; color:#aaa; font-size:11px; cursor:pointer;">
                        💬 Commenti
                    </button>
                </div>

                <div id="comments-box-${post.id}" style="display:none; margin-top:10px; flex-direction:column; gap:8px;">
                    <div id="comments-list-${post.id}" style="display:flex; flex-direction:column; gap:6px; max-height:150px; overflow-y:auto;">
                        <span style="font-size:10px; color:#888;">Caricamento commenti...</span>
                    </div>

                    ${currentUid ? `
                        <div style="display:flex; gap:6px; margin-top:4px;">
                            <input type="text" id="comment-input-${post.id}" class="app-input" placeholder="Scrivi un commento..." style="font-size:10px; padding:6px 10px;" />
                            <button onclick="submitComment('${post.id}')" class="liquid-btn" style="padding:6px 10px; font-size:10px;">INVIA</button>
                        </div>
                    ` : '<span style="font-size:9px; color:#aaa;">Accedi per commentare.</span>'}
                </div>
            </div>
        `;
    }).join('');
}

function toggleCommentsView(postId) {
    const box = document.getElementById(`comments-box-${postId}`);
    if (!box) return;
    if (box.style.display === 'none' || box.style.display === '') {
        box.style.display = 'flex';
        listenToComments(postId);
    } else {
        box.style.display = 'none';
    }
}

async function replyToComment(postId, commentId) {
    if (!currentUserProfile) return alert("Accedi per rispondere.");
    const raw = prompt("Scrivi la tua risposta:");
    if (!raw || !raw.trim()) return;
    const text = await filterProfanity(raw.trim());
    try {
        await db.collection("posts").doc(postId).collection("comments").add({
            postId, authorId: currentUserProfile.uid, parentCommentId: commentId,
            authorName: currentUserProfile.displayName, usernameTag: currentUserProfile.usernameTag,
            imgprofile: currentUserProfile.imgprofile, text,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) { alert("Errore invio risposta: " + e.message); }
}

async function reportComment(postId, commentId) {
    if (!currentUserProfile) return alert("Accedi per segnalare.");
    if (!confirm("Segnalare questo commento allo staff?")) return;
    try {
        await db.collection("reports").add({
            reporterId: currentUserProfile.uid, targetType: "comment", targetId: commentId,
            postId, reason: "Segnalazione commento", status: "open",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("Segnalazione inviata.");
    } catch (e) { alert("Errore segnalazione: " + e.message); }
}

async function deleteComment(postId, commentId, authorId) {
    if (!currentUserProfile || (currentUserProfile.uid !== authorId && !isCurrentUserStaff())) return alert("Non puoi eliminare questo commento.");
    if (!confirm("Eliminare questo commento?")) return;
    try { await db.collection("posts").doc(postId).collection("comments").doc(commentId).delete(); }
    catch (e) { alert("Errore eliminazione: " + e.message); }
}

function isCurrentUserStaff() {
    return !!(currentUserProfile && ["admin", "founder", "owner", "staff", "modder", "tester", "helper"].includes(currentUserProfile.role));
}

function listenToComments(postId) {
    const listElem = document.getElementById(`comments-list-${postId}`);
    if (!listElem || !db) return;
    db.collection("posts").doc(postId).collection("comments").orderBy("createdAt", "asc")
        .onSnapshot(snapshot => {
            if (snapshot.empty) {
                listElem.innerHTML = `<span style="font-size:9px;color:#888;">Nessun commento ancora.</span>`;
                return;
            }
            listElem.innerHTML = snapshot.docs.map(doc => {
                const c = doc.data();
                const mine = currentUserProfile && currentUserProfile.uid === c.authorId;
                const indent = c.parentCommentId ? "margin-left:18px;border-left:2px solid #00d4ff;" : "";
                return `
                    <div style="background:rgba(255,255,255,0.05);padding:6px 8px;border-radius:8px;font-size:10px;${indent}">
                        <strong style="color:#00d4ff;">${escapeHtml(c.authorName)}</strong>:
                        <span style="color:#eee;">${formatUserText(c.text)}</span>
                        <div style="display:flex;gap:10px;margin-top:5px;">
                            <button onclick="replyToComment('${postId}','${doc.id}')" style="background:none;border:0;color:#00d4ff;font-size:9px;">↩ Rispondi</button>
                            <button onclick="reportComment('${postId}','${doc.id}')" style="background:none;border:0;color:#aaa;font-size:9px;">🚩 Segnala</button>
                            ${(mine || isCurrentUserStaff()) ? `<button onclick="deleteComment('${postId}','${doc.id}','${c.authorId || ''}')" style="background:none;border:0;color:#ff4757;font-size:9px;">🗑 Elimina</button>` : ''}
                        </div>
                    </div>`;
            }).join('');
        }, err => { listElem.innerHTML = '<span style="color:#ff4757">Errore caricamento commenti.</span>'; });
}

function listenCommunityPosts() {
    if (!db) { renderCommunityPosts(fallbackPosts); return; }
    db.collection("posts").orderBy("createdAt", "desc").onSnapshot(snapshot => {
        const posts = [];
        snapshot.forEach(doc => posts.push({ id: doc.id, ...doc.data() }));
        renderCommunityPosts(posts);
    }, () => renderCommunityPosts(fallbackPosts));
}

// ----------------------------------------------------------------------------
// 9. EVENTI DOMContentLoaded (TUTTI I LISTENER INCLUSI)
// ----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    loadSettingsFromStorage();
    startRealtimeClock();

    // SETUP CONSENSO 14 ANNI NELL'HTML DI ACCESSO
    const consentContainer = document.getElementById('consent-box');
    if (consentContainer) {
        consentContainer.innerHTML = `
            <style>
              .consent { display:flex; gap:10px; align-items:flex-start; margin:8px 0; font-size:11px; color:#fff; text-align:left; }
              .consent input { margin-top:2px; width:16px; height:16px; cursor:pointer; flex:none; }
              .consent a { color:#00d4ff; text-decoration:underline; }
              .consent-locked { opacity:.45; pointer-events:none; cursor:not-allowed; filter:grayscale(.6); }
            </style>
            <label class="consent">
              <input type="checkbox" id="consent-check">
              <span>Dichiaro di avere <b>almeno 14 anni</b> e accetto i <a href="${LEGAL_PAGE}#termini" target="_blank">Termini</a> e la <a href="${LEGAL_PAGE}#privacy" target="_blank">Privacy</a>.</span>
            </label>`;
    }

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');
    const REDIRECT_URI = new URL(APP_SHARE_URL).origin + "/";

    if (accessToken) {
        // I vecchi flussi OAuth implicit restituiscono token al browser e non creano
        // una sessione Firebase Auth. Scartiamo il token: mai usarlo come identità locale.
        window.history.replaceState({}, document.title, window.location.pathname);
        localStorage.removeItem('auth_provider');
        alert("Questo accesso social è in fase di migrazione alla verifica server-side e Firebase Auth. Per ora usa l'accesso Firebase.");
    }
    initAuthListener();

    const toggleAuthBtn = document.getElementById('toggle-auth-mode-btn');
    if (toggleAuthBtn) toggleAuthBtn.addEventListener('click', toggleAuthMode);

    const authSubmitBtn = document.getElementById('auth-submit-btn');
    if (authSubmitBtn) authSubmitBtn.addEventListener('click', handleAuthSubmit);

    const toggleSocialMenuBtn = document.getElementById('toggle-social-menu-btn');
    const socialButtonsContainer = document.getElementById('social-buttons-container');
    const socialArrowIcon = document.getElementById('social-arrow-icon');

    if (toggleSocialMenuBtn && socialButtonsContainer) {
        toggleSocialMenuBtn.addEventListener('click', () => {
            if (socialButtonsContainer.style.display === 'none' || socialButtonsContainer.style.display === '') {
                socialButtonsContainer.style.display = 'flex';
                if (socialArrowIcon) socialArrowIcon.innerText = '▲';
            } else {
                socialButtonsContainer.style.display = 'none';
                if (socialArrowIcon) socialArrowIcon.innerText = '▼';
            }
        });
    }

    const openProfileBtn = document.getElementById('open-profile-settings-btn');
    if (openProfileBtn) openProfileBtn.addEventListener('click', openProfileSettingsModal);

    const closeProfileBtn = document.getElementById('close-profile-modal-btn');
    if (closeProfileBtn) closeProfileBtn.addEventListener('click', closeProfileSettingsModal);

    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfileSettings);

    const deleteAccountBtn = document.getElementById('delete-account-btn');
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', () => requestAccountDeletion(auth.currentUser));
    }

    const googleBtn = document.getElementById('login-google-btn');
    if (googleBtn) googleBtn.addEventListener('click', () => {
        handleSocialLogin(new firebase.auth.GoogleAuthProvider(), "Google");
    });

    const githubBtn = document.getElementById('login-github-btn');
    if (githubBtn) githubBtn.addEventListener('click', () => {
        handleSocialLogin(new firebase.auth.GithubAuthProvider(), "GitHub");
    });

    const yahooBtn = document.getElementById('login-yahoo-btn');
    if (yahooBtn) yahooBtn.addEventListener('click', () => {
        const yahooProvider = new firebase.auth.OAuthProvider('yahoo.com');
        handleSocialLogin(yahooProvider, "Yahoo");
    });

    // OAuth browser-only implicit flow disabilitati: i token non devono essere
    // consegnati al frontend. Riattivare i provider solo dopo il broker Worker
    // (Authorization Code + PKCE), verifica server-side e Firebase Custom Token.
    ['discord', 'twitch', 'gitlab', 'figma'].forEach(providerName => {
        const button = document.getElementById(`login-${providerName}-btn`);
        if (button) {
            button.addEventListener('click', () => {
                if (!consentGiven()) {
                    alert("⚠️ Devi accettare i Termini e la Privacy Policy per continuare!");
                    return;
                }
                alert("Accesso " + providerName + " temporaneamente sospeso: stiamo migrando a un'autenticazione sicura tramite Firebase.");
            });
        }
    });

    const userLogoutBtn = document.getElementById('logout-btn');
    if (userLogoutBtn) userLogoutBtn.addEventListener('click', handleLogout);

    const openSheetBtn = document.getElementById('open-sheet-btn');
    if (openSheetBtn) openSheetBtn.addEventListener('click', openBottomSheet);

    const sheetOverlay = document.getElementById('bottom-sheet-overlay');
    if (sheetOverlay) {
        sheetOverlay.addEventListener('click', (e) => {
            if (e.target === sheetOverlay) closeBottomSheet();
        });
    }

    document.querySelectorAll('.sheet-card:not(.quick-shortcut-btn)').forEach(card => {
        card.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            const titleText = this.getAttribute('data-title');
            switchTab(tabId, titleText, null);
            closeBottomSheet();
        });
    });

    document.querySelectorAll('.quick-shortcut-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const infoText = this.getAttribute('data-info');
            if (infoText) alert(infoText);
        });
    });

    document.querySelectorAll('.nav-item:not(#open-sheet-btn)').forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            const titleText = this.getAttribute('data-title');
            switchTab(tabId, titleText, this);
        });
    });

    const openDataModalBtn = document.getElementById('open-data-modal-btn');
    if (openDataModalBtn) openDataModalBtn.addEventListener('click', openDataModal);

    const acceptBtn = document.getElementById('modal-accept-btn');
    if (acceptBtn) acceptBtn.addEventListener('click', handleAcceptData);

    const rejectBtn = document.getElementById('modal-reject-btn');
    if (rejectBtn) rejectBtn.addEventListener('click', handleRejectData);

    const publishBtn = document.getElementById('publish-post-btn');
    if (publishBtn) publishBtn.addEventListener('click', publishCommunityPost);

    const copyIpCard = document.getElementById('copy-ip-card');
    if (copyIpCard) copyIpCard.addEventListener('click', copyServerIP);

    const searchSkinBtn = document.getElementById('search-skin-btn');
    if (searchSkinBtn) searchSkinBtn.addEventListener('click', () => {
        const user = document.getElementById('skin-username').value.trim();
        document.getElementById('skin-3d-iframe').src = `https://visage.surgeplay.com/full/512/${user || 'Steve'}`;
    });

    const copyAppLinkBtn = document.getElementById('copy-app-link-btn');
    if (copyAppLinkBtn) copyAppLinkBtn.addEventListener('click', copyAppLink);

    const audioToggleBtn = document.getElementById('audio-toggle-btn');
    if (audioToggleBtn) audioToggleBtn.addEventListener('click', toggleAudioSetting);

    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleThemeSetting);

    const openMinigameBtn = document.getElementById('open-minigame-btn');
    const closeMinigameBtn = document.getElementById('close-minigame-btn');
    const minigameContainer = document.getElementById('minigame-container');
    const minigameIframe = document.getElementById('minigame-iframe');

    if (openMinigameBtn && minigameContainer && minigameIframe) {
        openMinigameBtn.addEventListener('click', () => {
            if (!minigameIframe.src || minigameIframe.src === window.location.href) {
                minigameIframe.src = 'minigioco.html';
            }
            minigameContainer.style.display = 'flex';
            openMinigameBtn.style.display = 'none';
        });
    }

    if (closeMinigameBtn && minigameContainer && openMinigameBtn) {
        closeMinigameBtn.addEventListener('click', () => {
            minigameContainer.style.display = 'none';
            openMinigameBtn.style.display = 'block';
        });
    }

    document.addEventListener('click', (e) => {
        if (e.target.closest('.nav-item, .liquid-btn, .sheet-card, .modal-btn-accept, .modal-btn-reject')) playClickSound();
    });
});
