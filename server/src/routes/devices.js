const express = require("express");
const { readDevice, writeDevice, emptyDevice, isValidDeviceId } = require("../store");
const { checkDevice, computeDue, resetIfNewDay, todayDateString } = require("../scheduler");

const router = express.Router();

router.param("deviceId", (req, res, next, deviceId) => {
  if (!isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: "Invalid deviceId" });
  }
  next();
});

// POST /api/devices/:deviceId/register  { token }
router.post("/:deviceId/register", async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token is required" });
    }
    const device = (await readDevice(req.params.deviceId)) || emptyDevice(req.params.deviceId);
    device.token = token;
    device.updatedAt = new Date().toISOString();
    await writeDevice(req.params.deviceId, device);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/devices/:deviceId/tasks  { tasks: [...] }
// Replaces the device's synced task list. Anything already overdue at the
// moment it's first synced is pre-marked as notified so it doesn't fire
// immediately — matches the "don't alarm retroactively" rule from the plan.
router.put("/:deviceId/tasks", async (req, res, next) => {
  try {
    const { tasks } = req.body || {};
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: "tasks must be an array" });
    }
    const device = (await readDevice(req.params.deviceId)) || emptyDevice(req.params.deviceId);
    const now = new Date();
    resetIfNewDay(device, now);

    device.tasks = tasks;
    // Silence anything already due right after this sync, for tasks that
    // are new to this device (weren't already tracked).
    const alreadyDue = computeDue(device, now);
    device.notifiedKeys = Array.from(new Set([...(device.notifiedKeys || []), ...alreadyDue.map((d) => d.key)]));
    device.notifiedDate = todayDateString(now);
    device.updatedAt = now.toISOString();

    await writeDevice(req.params.deviceId, device);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/devices/:deviceId/test — force an immediate due-check instead
// of waiting for the next cron minute. For testing only.
router.post("/:deviceId/test", async (req, res, next) => {
  try {
    await checkDevice(req.params.deviceId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/devices/:deviceId — retrieve device data
router.get("/:deviceId", async (req, res, next) => {
  try {
    const device = await readDevice(req.params.deviceId);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json(device);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/devices/:deviceId — delete a device
router.delete("/:deviceId", async (req, res, next) => {
  try {
    const fs = require("fs/promises");
    const path = require("path");
    const deviceId = req.params.deviceId;

    // Manually validate to use proper error handling
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(deviceId)) {
      console.error(`[admin] invalid deviceId: ${deviceId}`);
      return res.status(400).json({ error: "Invalid deviceId" });
    }

    const devicePath = path.join(__dirname, "..", "data", "devices", `${deviceId}.json`);
    console.log(`[admin] attempting to delete: ${devicePath}`);

    try {
      const stats = await fs.stat(devicePath);
      console.log(`[admin] file exists, size: ${stats.size} bytes`);
      await fs.unlink(devicePath);
      console.log(`[admin] ✅ deleted device ${deviceId}`);
    } catch (err) {
      if (err.code === "ENOENT") {
        console.log(`[admin] file not found: ${devicePath}`);
      } else {
        console.error(`[admin] error deleting ${devicePath}:`, err.message);
        throw err;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(`[admin] delete error:`, err);
    next(err);
  }
});

module.exports = router;
