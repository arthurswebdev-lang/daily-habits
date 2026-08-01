const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const keyPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./service-account.json");

if (!fs.existsSync(keyPath)) {
  throw new Error(
    `Firebase service-account key not found at ${keyPath}. ` +
    `See firebase-setup-and-testing.md for how to generate one, ` +
    `then set FIREBASE_SERVICE_ACCOUNT_PATH in .env.`
  );
}

admin.initializeApp({
  credential: admin.credential.cert(require(keyPath)),
});

module.exports = admin;
