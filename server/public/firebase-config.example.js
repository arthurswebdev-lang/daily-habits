// Copy this file to firebase-config.js and fill in your project's values —
// see firebase-setup-and-testing.md. These are the public Firebase "web
// app" config values (safe to expose client-side, not secrets).

window.FIREBASE_CONFIG = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

// Cloud Messaging → Web configuration → "Web Push certificates" key pair.
window.FCM_VAPID_KEY = "REPLACE_ME";
