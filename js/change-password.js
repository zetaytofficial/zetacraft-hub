// change-password.js - cambio password che chiede SEMPRE la password attuale.
// `fb` contiene le funzioni di Firebase Auth che gia' usi nell'app:
//   { EmailAuthProvider, reauthenticateWithCredential, updatePassword }
// (con la versione "compat" di Firebase i nomi sono diversi: dimmelo e lo adatto)

function passwordErrorMessage(err) {
  switch (err && err.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'La password attuale non e\' corretta.';
    case 'auth/too-many-requests':
      return 'Troppi tentativi: riprova tra qualche minuto.';
    case 'auth/weak-password':
      return 'La nuova password e\' troppo debole.';
    default:
      return 'Non e\' stato possibile cambiare la password.';
  }
}

async function changePassword(fb, user, oldPassword, newPassword) {
  const usesPassword = (user.providerData || []).some((p) => p.providerId === 'password');
  if (!usesPassword) {
    throw new Error('Il tuo account usa l\'accesso con un altro servizio (Google, GitHub, ...): non ha una password da cambiare qui.');
  }
  if (!oldPassword) throw new Error('Scrivi la password attuale.');
  if (String(newPassword).length < 8) throw new Error('La nuova password deve avere almeno 8 caratteri.');
  if (newPassword === oldPassword) throw new Error('La nuova password deve essere diversa da quella attuale.');
  try {
    // 1) prova di conoscere la password attuale, 2) solo dopo si cambia
    await fb.reauthenticateWithCredential(user, fb.EmailAuthProvider.credential(user.email, oldPassword));
    await fb.updatePassword(user, newPassword);
  } catch (err) {
    throw new Error(passwordErrorMessage(err));
  }
}
