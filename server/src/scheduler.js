const cron = require("node-cron");
const admin = require("./firebase");
const { readDevice, writeDevice, listDeviceIds } = require("./store");

function todayDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Mirrors the client's generateDailySlots — same start/intervalHours/end
// shape produces the same "HH:MM" slots server-side.
function generateDailySlots({ start, intervalHours, end }) {
  const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  const stepMin = intervalHours * 60;
  const slots = [];
  for (let t = startMin; t <= endMin; t += stepMin) {
    const h = String(Math.floor(t / 60)).padStart(2, "0");
    const m = String(t % 60).padStart(2, "0");
    slots.push(`${h}:${m}`);
  }
  return slots;
}

// Returns [{ key, title, body }] for everything in this device's task list
// that is due right now and not already in notifiedKeys. Only "event" and
// "repetitive/daily" tasks carry an exact time — see push-notifications-plan.md.
function computeDue(device, now) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const notified = new Set(device.notifiedKeys || []);
  const due = [];

  for (const task of device.tasks || []) {
    if (task.type === "event") {
      const key = `event:${task.id}`;
      if (notified.has(key)) continue;
      const dt = new Date(`${task.date}T${task.time}`);
      if (dt <= now) due.push({ key, title: task.label, body: "Event is due now" });
    } else if (task.type === "repetitive" && task.recurrence?.kind === "daily") {
      for (const slot of generateDailySlots(task.recurrence)) {
        const key = `slot:${task.id}:${slot}`;
        if (notified.has(key)) continue;
        const [h, m] = slot.split(":").map(Number);
        if (h * 60 + m <= nowMinutes) due.push({ key, title: task.label, body: `Check-in at ${slot}` });
      }
    }
  }
  return due;
}

async function sendPush(token, { title, body }) {
  await admin.messaging().send({
    token,
    notification: { title, body },
  });
}

// Resets notifiedKeys when the calendar day has moved on, so daily slots
// (and any events created "for today" in a loose sense) can fire again.
function resetIfNewDay(device, now) {
  const today = todayDateString(now);
  if (device.notifiedDate !== today) {
    device.notifiedDate = today;
    device.notifiedKeys = [];
  }
}

async function checkDevice(deviceId, now = new Date()) {
  const device = await readDevice(deviceId);
  if (!device || !device.token) {
    if (!device) console.log(`[scheduler] device ${deviceId} not found`);
    if (device && !device.token) console.log(`[scheduler] device ${deviceId} has no token`);
    return;
  }

  resetIfNewDay(device, now);
  const due = computeDue(device, now);

  if (due.length === 0) {
    await writeDevice(deviceId, device);
    return;
  }

  console.log(`[scheduler] device ${deviceId} has ${due.length} due tasks`);
  for (const item of due) {
    try {
      await sendPush(device.token, item);
      device.notifiedKeys.push(item.key);
      console.log(`[scheduler] ✅ push sent for device ${deviceId}: ${item.title}`);
    } catch (err) {
      // Don't mark as notified if the push actually failed — try again
      // next tick. A stale/invalid token will just keep failing quietly;
      // fine for a personal single-user server.
      console.error(`[scheduler] ❌ push failed for device ${deviceId}:`, err.message);
    }
  }
  await writeDevice(deviceId, device);
}

async function checkAllDevices() {
  const now = new Date();
  const deviceIds = await listDeviceIds();
  console.log(`[scheduler] checking ${deviceIds.length} devices at ${now.toISOString()}`);
  for (const deviceId of deviceIds) {
    await checkDevice(deviceId, now);
  }
}

function startScheduler() {
  cron.schedule("* * * * *", () => {
    checkAllDevices().catch((err) => console.error("[scheduler] tick failed:", err));
  });
  console.log("[scheduler] running, checking every minute");
}

module.exports = { startScheduler, checkAllDevices, checkDevice, computeDue, resetIfNewDay, todayDateString };
