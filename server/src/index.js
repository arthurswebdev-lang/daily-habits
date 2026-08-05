require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");

const devicesRouter = require("./routes/devices");
const { startScheduler } = require("./scheduler");

const app = express();
app.use(express.json());

const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin.split(",").map((s) => s.trim()) } : {}));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/devices", devicesRouter);

// Admin API: list all devices
app.get("/api/admin/devices", async (req, res, next) => {
  try {
    const deviceIds = await listDeviceIds();
    const devices = [];
    for (const id of deviceIds) {
      const device = await readDevice(id);
      if (device) {
        devices.push({
          deviceId: device.deviceId,
          taskCount: (device.tasks || []).length,
          hasToken: !!device.token,
          updatedAt: device.updatedAt,
        });
      }
    }
    res.json(devices);
  } catch (err) {
    next(err);
  }
});

// Minimal static test page (server/public/test-client.html) — lets you
// exercise the whole loop (get an FCM token, register, sync a task, force
// a push) without touching the main app's frontend.
app.use(express.static(path.join(__dirname, "..", "public")));

app.use((err, req, res, next) => {
  console.error(err);
  const statusCode = (err.statusCode && err.statusCode >= 400 && err.statusCode < 600) ? err.statusCode : 500;
  res.status(statusCode).json({ error: err.message || "Internal error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[server] listening on :${port}`);
  startScheduler();
});
