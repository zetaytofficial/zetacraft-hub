importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDoKoRYGIT9ZQ5tMBwDueb5G4zXpDX2bmc",
  projectId: "zetacraft-hub-app",
  messagingSenderId: "936104735638",
  appId: "1:936104735638:web:3ee3080c96b14f03d523b7"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Ricevuto messaggio in background: ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: 'favicon.ico'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});