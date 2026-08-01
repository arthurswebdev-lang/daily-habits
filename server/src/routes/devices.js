const express = require("express");
const { readDevice, writeDevice, emptyDevice, isValidDeviceId } = require("../store");
const { checkDevice, computeDue, resetIfNewDay, todayDateString } = require("../scheduler");

const router = express.Router();

router.use((req, res, next) => {
  if (!isValidDeviceId(req.params.deviceId)) {
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

module.exports = router;
