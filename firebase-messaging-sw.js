// Firebase requires this exact filename/location to handle push messages
// that arrive while no tab is open. Loads the same config as the main page.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
importScripts("./firebase-config.js");

firebase.initializeApp(globalThis.FIREBASE_CONFIG);
const messaging = firebase.messaging();

// Firebase handles notification display automatically for onBackgroundMessage.
// Do NOT manually call showNotification() as it will create duplicates.
// This handler is here as a placeholder for any future custom logic (e.g., analytics).
messaging.onBackgroundMessage((payload) => {
  console.log("[SW] Message received in background, Firebase will show notification:", payload.notification?.title);
  // Firebase SDK automatically shows the notification from payload.notification
});
