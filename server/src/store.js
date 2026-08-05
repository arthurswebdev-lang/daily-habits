const fs = require("fs/promises");
const path = require("path");

const DEVICES_DIR = path.join(__dirname, "..", "data", "devices");
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;

// Validated up front so a malformed/malicious deviceId can never be used
// to build a path outside DEVICES_DIR (no path traversal), and so every
// device's data stays in its own file — never merged with another's.
function isValidDeviceId(deviceId) {
  return typeof deviceId === "string" && DEVICE_ID_PATTERN.test(deviceId);
}

function deviceFilePath(deviceId) {
  if (!isValidDeviceId(deviceId)) {
    const err = new Error("Invalid deviceId");
    err.statusCode = 400;
    throw err;
  }
  return path.join(DEVICES_DIR, `${deviceId}.json`);
}

async function readDevice(deviceId) {
  try {
    const raw = await fs.readFile(deviceFilePath(deviceId), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeDevice(deviceId, device) {
  await fs.mkdir(DEVICES_DIR, { recursive: true });
  await fs.writeFile(deviceFilePath(deviceId), JSON.stringify(device, null, 2), "utf8");
}

async function listDeviceIds() {
  await fs.mkdir(DEVICES_DIR, { recursive: true });
  const entries = await fs.readdir(DEVICES_DIR);
  return entries.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
}

function emptyDevice(deviceId) {
  return {
    deviceId,
    token: null,
    tasks: [],
    notifiedDate: null,
    notifiedKeys: [],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { isValidDeviceId, readDevice, writeDevice, listDeviceIds, emptyDevice };
