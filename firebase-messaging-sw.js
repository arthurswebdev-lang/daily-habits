// Firebase requires this exact filename/location to handle push messages
// that arrive while no tab is open. Loads the same config as the main page.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
importScripts("./firebase-config.js");

firebase.initializeApp(globalThis.FIREBASE_CONFIG);
const messaging = firebase.messaging();

// Prevent duplicate notifications within 2 seconds
let lastNotificationTime = 0;
let lastNotificationBody = null;

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const now = Date.now();

  // Deduplicate: skip if same body shown in last 2 seconds
  if (lastNotificationBody === body && (now - lastNotificationTime) < 2000) {
    console.log("[SW] Duplicate notification blocked:", body);
    return;
  }

  lastNotificationTime = now;
  lastNotificationBody = body;

  self.registration.showNotification(title || "Daily Tasks", {
    body,
    badge: "/icon.png",
    icon: "/icon.png",
    tag: "task-notification",
    requireInteraction: true,
  });
});
