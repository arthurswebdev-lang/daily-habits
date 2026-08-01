// Firebase requires this exact filename/location to handle push messages
// that arrive while no tab is open. Loads the same config as the main page.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
importScripts("./firebase-config.js");

firebase.initializeApp(self.FIREBASE_CONFIG);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || "Daily Tasks", { body });
});
