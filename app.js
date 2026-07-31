const CATEGORIES = {
  important:   { label: "Important",   color: "#fb1919", icon: "⭐" },
  work:        { label: "Work",        color: "#13c2f9", icon: "💼" },
  supplements: { label: "Supplements", color: "#27b621", icon: "💊" },
  food:        { label: "Food",        color: "#ffed02", icon: "🍎" },
  education:   { label: "Education",   color: "#bce211", icon: "🎓" },
  selfcare:    { label: "Selfcare",    color: "#13d4c7", icon: "🧘" },
  gym:         { label: "Gym",         color: "#ff8000", icon: "🏋️" },
  reading:     { label: "Reading",     color: "#f5228e", icon: "📖" },
};
const CATEGORY_ORDER = Object.keys(CATEGORIES);

// Fallback bucket for tickets created without picking a category — category
// is optional on the add-task form, not a required field.
const NONE_KEY = "none";
const NONE_CATEGORY = { label: "Other", color: "#9ca3af", icon: "🗂️" };
function categoryOf(key) {
  return CATEGORIES[key] || NONE_CATEGORY;
}
function taskCategory(task) {
  return task.category || NONE_KEY;
}

const WEEKDAYS = [
  { key: "mon", label: "Mo" },
  { key: "tue", label: "Tu" },
  { key: "wed", label: "We" },
  { key: "thu", label: "Th" },
  { key: "fri", label: "Fr" },
  { key: "sat", label: "Sa" },
  { key: "sun", label: "Su" },
];
const WEEKDAY_LABEL = Object.fromEntries(WEEKDAYS.map((d) => [d.key, d.label]));

// A task with subtasks has no standalone `done` flag — its completion is
// derived from how many subtasks are checked (see isDone/progressOf below).
let tasks = [];

// ── persistence (IndexedDB) ──────────────────────────────────────────────

const DB_NAME = "daily-tasks-db";
const DB_VERSION = 1;
const STORE_NAME = "tasks";
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllTasks() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putTask(task) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(task);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteTaskRecord(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const categoryTabs = document.getElementById("category-tabs");
const categoryPages = document.getElementById("category-pages");
const emptyState = document.getElementById("empty-state");
const taskCount = document.getElementById("task-count");
const clearDoneBtn = document.getElementById("clear-done-btn");
const fabAdd = document.getElementById("fab-add");
const modalOverlay = document.getElementById("add-modal");
const wizardBack = document.getElementById("wizard-back");
const wizardTitle = document.getElementById("wizard-title");
const wizardClose = document.getElementById("wizard-close");
const wizardContent = document.getElementById("wizard-content");

// ── task helpers ─────────────────────────────────────────────────────────

function hasSubtasks(task) {
  return Array.isArray(task.subtasks) && task.subtasks.length > 0;
}

function isDone(task) {
  return hasSubtasks(task) ? task.subtasks.every((s) => s.done) : task.done;
}

function progressOf(task) {
  if (!hasSubtasks(task)) return task.done ? 100 : 0;
  const doneCount = task.subtasks.filter((s) => s.done).length;
  return Math.round((doneCount / task.subtasks.length) * 100);
}

// A "daily" recurrence (repeat every N hours between a start and end time)
// is tracked as one checkable slot per time-of-day, reusing the subtasks
// mechanism — otherwise a single checkbox would mark the whole day's worth
// of check-ins done after the very first one.
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

function makeDailySubtasks(taskId, recurrence) {
  return generateDailySlots(recurrence).map((time, i) => ({ id: `${taskId}-${i}`, label: time, done: false }));
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Now that tasks persist (IndexedDB), a checked-off daily slot would
// otherwise stay checked forever — this regenerates a fresh, unchecked set
// of slots whenever the calendar day has moved on since they were last
// generated, so "daily" recurrence actually resets daily.
function refreshDailyRecurrences() {
  const today = todayDateString();
  let changed = false;
  for (const task of tasks) {
    if (task.type !== "repetitive" || task.recurrence?.kind !== "daily") continue;
    if (task.recurrence.lastGeneratedDate === today) continue;
    task.subtasks = makeDailySubtasks(task.id, task.recurrence);
    task.recurrence.lastGeneratedDate = today;
    putTask(task);
    changed = true;
  }
  return changed;
}

function formatEventMeta(task) {
  const dt = new Date(`${task.date}T${task.time}`);
  const date = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

function formatRecurrenceMeta(recurrence) {
  if (recurrence.kind === "weekly") {
    if (recurrence.days.length === 7) return "Every day";
    return recurrence.days.map((d) => WEEKDAY_LABEL[d]).join(" · ");
  }
  if (recurrence.kind === "monthly") {
    return `Day ${recurrence.dayOfMonth} of month`;
  }
  return `${recurrence.start}–${recurrence.end} · every ${recurrence.intervalHours}h`; // daily
}

// ── calendar export (.ics) ───────────────────────────────────────────────
// Lets iOS/Android's own Calendar app own the actual alarm — the browser
// can't write events silently, but opening this file prompts one native
// "Add to Calendar" confirmation, no manual data entry required.

function icsEscape(text) {
  return String(text).replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
}

function icsDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function icsVevent({ uid, start, summary, rrule }) {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}@daily-tasks`,
    `DTSTAMP:${icsDateTime(new Date())}`,
    `DTSTART:${icsDateTime(start)}`,
    rrule ? `RRULE:${rrule}` : null,
    `SUMMARY:${icsEscape(summary)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}

function buildTaskICS(task) {
  if (task.type === "event") {
    return [icsVevent({ uid: task.id, start: new Date(`${task.date}T${task.time}`), summary: task.label })];
  }
  // repetitive/daily: one recurring (FREQ=DAILY) event per time-of-day slot
  const today = new Date();
  return task.subtasks.map((sub) => {
    const [h, m] = sub.label.split(":").map(Number);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m);
    return icsVevent({ uid: `${task.id}-${sub.id}`, start, summary: `${task.label} (${sub.label})`, rrule: "FREQ=DAILY" });
  });
}

function downloadICS(filename, vevents) {
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Daily Tasks//EN", "CALSCALE:GREGORIAN", ...vevents, "END:VCALENDAR"].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canExportToCalendar(task) {
  return task.type === "event" || (task.type === "repetitive" && task.recurrence?.kind === "daily" && hasSubtasks(task));
}

// ── rendering ────────────────────────────────────────────────────────────

function renderTaskItem(task) {
  const cat = categoryOf(task.category);
  const done = isDone(task);
  const li = document.createElement("li");
  li.className = "task-item" + (done ? " done" : "");

  const checkbox = document.createElement("button");
  checkbox.className = "task-checkbox";
  checkbox.type = "button";
  checkbox.style.setProperty("--cat-color", cat.color);

  const body = document.createElement("div");
  body.className = "task-body";

  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = task.label;
  body.append(text);

  const del = document.createElement("button");
  del.className = "task-delete";
  del.type = "button";
  del.setAttribute("aria-label", "Delete task");
  del.textContent = "×";
  del.addEventListener("click", () => {
    if (confirm(`Delete "${task.label}"?`)) removeTask(task.id);
  });

  let calendarBtn = null;
  if (canExportToCalendar(task)) {
    calendarBtn = document.createElement("button");
    calendarBtn.className = "task-calendar-btn";
    calendarBtn.type = "button";
    calendarBtn.setAttribute("aria-label", "Add to Calendar");
    calendarBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="4" y="5" width="16" height="15" rx="2"></rect>' +
      '<line x1="4" y1="9" x2="20" y2="9"></line>' +
      '<line x1="8" y1="3" x2="8" y2="7"></line>' +
      '<line x1="16" y1="3" x2="16" y2="7"></line>' +
      "</svg>";
    calendarBtn.addEventListener("click", () => downloadICS(`${task.label}.ics`, buildTaskICS(task)));
  }

  if (hasSubtasks(task)) {
    const progress = progressOf(task);
    checkbox.classList.add("task-checkbox-progress");
    checkbox.style.setProperty("--progress", `${progress}%`);
    checkbox.textContent = `${progress}%`;
    checkbox.setAttribute("aria-label", `${progress}% complete`);
    checkbox.disabled = true;

    const doneCount = task.subtasks.filter((s) => s.done).length;
    const meta = document.createElement("span");
    meta.className = "task-meta";
    meta.style.setProperty("--cat-color", cat.color);
    meta.textContent = `${doneCount}/${task.subtasks.length} · ${progress}%`;
    body.append(meta);

    const subList = document.createElement("ul");
    subList.className = "subtask-list";
    for (const sub of task.subtasks) {
      const subLi = document.createElement("li");
      subLi.className = "subtask-item" + (sub.done ? " done" : "");

      const subCheckbox = document.createElement("button");
      subCheckbox.className = "subtask-checkbox";
      subCheckbox.type = "button";
      subCheckbox.style.setProperty("--cat-color", cat.color);
      subCheckbox.setAttribute("aria-label", sub.done ? "Mark as not done" : "Mark as done");
      subCheckbox.textContent = sub.done ? "✓" : "";
      subCheckbox.addEventListener("click", () => toggleSubtask(task.id, sub.id));

      const subLabel = document.createElement("span");
      subLabel.className = "subtask-label";
      subLabel.textContent = sub.label;

      subLi.append(subCheckbox, subLabel);
      subList.appendChild(subLi);
    }
    body.append(subList);
  } else {
    checkbox.setAttribute("aria-label", task.done ? "Mark as not done" : "Mark as done");
    checkbox.textContent = task.done ? "✓" : "";
    checkbox.addEventListener("click", () => toggleTask(task.id));

    if (task.type === "event") {
      const meta = document.createElement("span");
      meta.className = "task-meta";
      meta.style.setProperty("--cat-color", cat.color);
      meta.textContent = formatEventMeta(task);
      body.append(meta);
    } else if (task.type === "repetitive") {
      const meta = document.createElement("span");
      meta.className = "task-meta";
      meta.style.setProperty("--cat-color", cat.color);
      meta.textContent = formatRecurrenceMeta(task.recurrence);
      body.append(meta);
    }
  }

  li.append(checkbox, body);
  if (calendarBtn) li.append(calendarBtn);
  li.append(del);
  return li;
}

let activeCategory = null;
let pagesObserver = null;

function scrollToCategory(key, keysWithTasks, behavior) {
  const idx = keysWithTasks.indexOf(key);
  if (idx < 0) return;
  categoryPages.scrollTo({ left: idx * categoryPages.clientWidth, behavior });
}

function render() {
  const allKeys = [...CATEGORY_ORDER, NONE_KEY];
  const keysWithTasks = allKeys.filter((key) => tasks.some((t) => taskCategory(t) === key));
  if (!keysWithTasks.includes(activeCategory)) {
    activeCategory = keysWithTasks[0] || null;
  }

  if (pagesObserver) pagesObserver.disconnect();
  categoryTabs.innerHTML = "";
  categoryPages.innerHTML = "";

  for (const key of keysWithTasks) {
    const cat = categoryOf(key);
    const catTasks = tasks.filter((t) => taskCategory(t) === key);
    const doneCount = catTasks.filter((t) => isDone(t)).length;

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "category-tab" + (key === activeCategory ? " active" : "");
    tab.style.setProperty("--cat-color", cat.color);
    tab.setAttribute("aria-label", cat.label);
    tab.textContent = cat.icon;
    tab.addEventListener("click", () => scrollToCategory(key, keysWithTasks, "smooth"));
    categoryTabs.appendChild(tab);

    const page = document.createElement("section");
    page.className = "category-page";
    page.dataset.category = key;

    const card = document.createElement("div");
    card.className = "category-section";

    const header = document.createElement("div");
    header.className = "category-header";
    header.style.setProperty("--cat-color", cat.color);

    const icon = document.createElement("span");
    icon.className = "category-header-icon";
    icon.textContent = cat.icon;

    const label = document.createElement("span");
    label.className = "category-header-label";
    label.textContent = cat.label;

    const count = document.createElement("span");
    count.className = "category-header-count";
    count.textContent = `${doneCount}/${catTasks.length}`;

    header.append(icon, label, count);

    const list = document.createElement("ul");
    list.className = "task-list";
    const sorted = [...catTasks].sort((a, b) => (isDone(a) !== isDone(b) ? (isDone(a) ? 1 : -1) : 0));
    for (const task of sorted) list.appendChild(renderTaskItem(task));

    card.append(header, list);
    page.append(card);
    categoryPages.appendChild(page);
  }

  if (activeCategory) scrollToCategory(activeCategory, keysWithTasks, "instant");

  if (keysWithTasks.length > 0) {
    pagesObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = entry.target.dataset.category;
          if (key === activeCategory) continue;
          activeCategory = key;
          categoryTabs.querySelectorAll(".category-tab").forEach((t, i) => {
            t.classList.toggle("active", keysWithTasks[i] === key);
          });
        }
      },
      { root: categoryPages, threshold: 0.6 }
    );
    categoryPages.querySelectorAll(".category-page").forEach((p) => pagesObserver.observe(p));
  }

  const doneCount = tasks.filter((t) => isDone(t)).length;
  const hasTasks = tasks.length > 0;
  emptyState.hidden = hasTasks;
  categoryTabs.hidden = !hasTasks;
  categoryPages.hidden = !hasTasks;
  clearDoneBtn.hidden = doneCount === 0;
  taskCount.textContent = hasTasks ? `${doneCount}/${tasks.length} done` : "";
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  render();
  putTask(task);
}

function toggleSubtask(taskId, subtaskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const sub = task.subtasks.find((s) => s.id === subtaskId);
  if (!sub) return;
  sub.done = !sub.done;
  render();
  putTask(task);
}

function removeTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  render();
  deleteTaskRecord(id);
}

function clearCompleted() {
  const removedIds = tasks.filter((t) => isDone(t)).map((t) => t.id);
  tasks = tasks.filter((t) => !isDone(t));
  render();
  for (const id of removedIds) deleteTaskRecord(id);
}

clearDoneBtn.addEventListener("click", () => {
  if (confirm("Clear all completed tasks?")) clearCompleted();
});

// ── add-task wizard ──────────────────────────────────────────────────────

const STEP_TITLES = {
  type: "Add task",
  oneTime: "One-time task",
  event: "Event",
  repeatType: "Repeating task",
  weekly: "Repeat weekly",
  monthly: "Repeat monthly",
  daily: "Repeat daily",
};

const BACK_STEP = {
  oneTime: "type",
  event: "type",
  repeatType: "type",
  weekly: "repeatType",
  monthly: "repeatType",
  daily: "repeatType",
};

let wizard = { step: "type" };

function openWizard() {
  wizard = { step: "type" };
  modalOverlay.hidden = false;
  renderWizard();
}

function closeWizard() {
  modalOverlay.hidden = true;
  wizardContent.innerHTML = "";
}

function goToStep(step) {
  wizard.step = step;
  renderWizard();
}

function renderCategoryPicker(selectedKey, onChange) {
  const grid = document.createElement("div");
  grid.className = "category-picker";
  for (const key of [...CATEGORY_ORDER, NONE_KEY]) {
    const cat = categoryOf(key);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-picker-btn" + (key === selectedKey ? " selected" : "");
    btn.style.setProperty("--cat-color", cat.color);

    const iconSpan = document.createElement("span");
    iconSpan.className = "cp-icon";
    iconSpan.textContent = cat.icon;
    const labelSpan = document.createElement("span");
    labelSpan.className = "cp-label";
    labelSpan.textContent = cat.label;
    btn.append(iconSpan, labelSpan);

    btn.addEventListener("click", () => {
      grid.querySelectorAll(".category-picker-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      onChange(key);
    });
    grid.appendChild(btn);
  }
  return grid;
}

function renderLabelInput(placeholder, onInput) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "wizard-input";
  input.placeholder = placeholder;
  input.maxLength = 200;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function renderFieldLabel(text) {
  const el = document.createElement("label");
  el.className = "wizard-field-label";
  el.textContent = text;
  return el;
}

function renderSubmitButton(text, onSubmit) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wizard-submit-btn";
  btn.textContent = text;
  btn.disabled = true;
  btn.addEventListener("click", onSubmit);
  return btn;
}

function renderOptionCard(icon, title, desc, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wizard-option-card";
  const iconEl = document.createElement("span");
  iconEl.className = "wizard-option-icon";
  iconEl.textContent = icon;
  const textWrap = document.createElement("span");
  textWrap.className = "wizard-option-text";
  const titleEl = document.createElement("span");
  titleEl.className = "wizard-option-title";
  titleEl.textContent = title;
  const descEl = document.createElement("span");
  descEl.className = "wizard-option-desc";
  descEl.textContent = desc;
  textWrap.append(titleEl, descEl);
  btn.append(iconEl, textWrap);
  btn.addEventListener("click", onClick);
  return btn;
}

function renderStepType() {
  wizardContent.append(
    renderOptionCard("📌", "One-time", "Just a label — do it whenever, then it's done.", () => goToStep("oneTime")),
    renderOptionCard("📅", "Event", "Happens once, on a specific date and time.", () => goToStep("event")),
    renderOptionCard("🔁", "Repetitive", "Repeats weekly, monthly, or every few hours.", () => goToStep("repeatType"))
  );
}

function renderStepRepeatType() {
  wizardContent.append(
    renderOptionCard("📆", "Weekly", "Pick which days of the week it repeats on.", () => goToStep("weekly")),
    renderOptionCard("🗓️", "Monthly", "Repeats on a specific day of the month.", () => goToStep("monthly")),
    renderOptionCard("⏱️", "Daily", "Repeats every few hours between a start and end time.", () => goToStep("daily"))
  );
}

function renderStepOneTime() {
  const data = { label: "", category: activeCategory };
  const submitBtn = renderSubmitButton("Add task", () => {
    const task = { id: crypto.randomUUID(), type: "one-time", label: data.label.trim(), category: data.category || NONE_KEY, done: false };
    tasks.push(task);
    closeWizard();
    render();
    putTask(task);
  });
  const updateReady = () => { submitBtn.disabled = !data.label.trim(); };

  wizardContent.append(
    renderFieldLabel("Task name"),
    renderLabelInput("e.g. Call the plumber", (v) => { data.label = v; updateReady(); }),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    submitBtn
  );
}

function renderStepEvent() {
  const today = new Date().toISOString().slice(0, 10);
  const data = { label: "", category: activeCategory, date: today, time: "09:00" };
  const submitBtn = renderSubmitButton("Add event", () => {
    const task = { id: crypto.randomUUID(), type: "event", label: data.label.trim(), category: data.category || NONE_KEY, date: data.date, time: data.time, done: false };
    tasks.push(task);
    closeWizard();
    render();
    putTask(task);
  });
  const updateReady = () => { submitBtn.disabled = !(data.label.trim() && data.date && data.time); };

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "wizard-input";
  dateInput.value = today;
  dateInput.addEventListener("input", () => { data.date = dateInput.value; updateReady(); });

  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.className = "wizard-input";
  timeInput.value = "09:00";
  timeInput.addEventListener("input", () => { data.time = timeInput.value; updateReady(); });

  wizardContent.append(
    renderFieldLabel("Event name"),
    renderLabelInput("e.g. Doctor's appointment", (v) => { data.label = v; updateReady(); }),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    renderFieldLabel("Date"),
    dateInput,
    renderFieldLabel("Time"),
    timeInput,
    submitBtn
  );
}

function renderStepWeekly() {
  const data = { label: "", category: activeCategory, days: [] };
  const submitBtn = renderSubmitButton("Add task", () => {
    const task = { id: crypto.randomUUID(), type: "repetitive", label: data.label.trim(), category: data.category || NONE_KEY, recurrence: { kind: "weekly", days: [...data.days] }, done: false };
    tasks.push(task);
    closeWizard();
    render();
    putTask(task);
  });
  const updateReady = () => { submitBtn.disabled = !(data.label.trim() && data.days.length > 0); };

  const dayRow = document.createElement("div");
  dayRow.className = "day-toggle-row";
  for (const day of WEEKDAYS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "day-chip";
    chip.textContent = day.label;
    chip.addEventListener("click", () => {
      if (data.days.includes(day.key)) {
        data.days = data.days.filter((d) => d !== day.key);
        chip.classList.remove("selected");
      } else {
        data.days.push(day.key);
        chip.classList.add("selected");
      }
      updateReady();
    });
    dayRow.appendChild(chip);
  }

  wizardContent.append(
    renderFieldLabel("Task name"),
    renderLabelInput("e.g. Gym session", (v) => { data.label = v; updateReady(); }),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    renderFieldLabel("Repeat on"),
    dayRow,
    submitBtn
  );
}

function renderStepMonthly() {
  const data = { label: "", category: activeCategory, dayOfMonth: 1 };
  const submitBtn = renderSubmitButton("Add task", () => {
    const task = { id: crypto.randomUUID(), type: "repetitive", label: data.label.trim(), category: data.category || NONE_KEY, recurrence: { kind: "monthly", dayOfMonth: data.dayOfMonth }, done: false };
    tasks.push(task);
    closeWizard();
    render();
    putTask(task);
  });
  const updateReady = () => { submitBtn.disabled = !(data.label.trim() && data.dayOfMonth >= 1 && data.dayOfMonth <= 31); };

  const dayInput = document.createElement("input");
  dayInput.type = "number";
  dayInput.className = "wizard-input";
  dayInput.min = "1";
  dayInput.max = "31";
  dayInput.value = "1";
  dayInput.addEventListener("input", () => { data.dayOfMonth = Number(dayInput.value); updateReady(); });

  wizardContent.append(
    renderFieldLabel("Task name"),
    renderLabelInput("e.g. Pay rent", (v) => { data.label = v; updateReady(); }),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    renderFieldLabel("Day of month"),
    dayInput,
    submitBtn
  );
}

function renderStepDaily() {
  const data = { label: "", category: activeCategory, start: "09:00", intervalHours: 2, end: "20:00" };
  const submitBtn = renderSubmitButton("Add task", () => {
    const id = crypto.randomUUID();
    const recurrence = { kind: "daily", start: data.start, intervalHours: data.intervalHours, end: data.end, lastGeneratedDate: todayDateString() };
    const task = { id, type: "repetitive", label: data.label.trim(), category: data.category || NONE_KEY, recurrence, subtasks: makeDailySubtasks(id, recurrence) };
    tasks.push(task);
    closeWizard();
    render();
    putTask(task);
  });
  const updateReady = () => { submitBtn.disabled = !(data.label.trim() && data.start && data.end && data.intervalHours > 0); };

  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.className = "wizard-input";
  startInput.value = "09:00";
  startInput.addEventListener("input", () => { data.start = startInput.value; updateReady(); });

  const intervalInput = document.createElement("input");
  intervalInput.type = "number";
  intervalInput.className = "wizard-input";
  intervalInput.min = "1";
  intervalInput.max = "12";
  intervalInput.value = "2";
  intervalInput.addEventListener("input", () => { data.intervalHours = Number(intervalInput.value); updateReady(); });

  const endInput = document.createElement("input");
  endInput.type = "time";
  endInput.className = "wizard-input";
  endInput.value = "20:00";
  endInput.addEventListener("input", () => { data.end = endInput.value; updateReady(); });

  wizardContent.append(
    renderFieldLabel("Task name"),
    renderLabelInput("e.g. Drink water", (v) => { data.label = v; updateReady(); }),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    renderFieldLabel("Start time"),
    startInput,
    renderFieldLabel("Repeat every (hours)"),
    intervalInput,
    renderFieldLabel("Until"),
    endInput,
    submitBtn
  );
}

const STEP_RENDERERS = {
  type: renderStepType,
  repeatType: renderStepRepeatType,
  oneTime: renderStepOneTime,
  event: renderStepEvent,
  weekly: renderStepWeekly,
  monthly: renderStepMonthly,
  daily: renderStepDaily,
};

function renderWizard() {
  wizardContent.innerHTML = "";
  wizardTitle.textContent = STEP_TITLES[wizard.step];
  wizardBack.hidden = !(wizard.step in BACK_STEP);
  STEP_RENDERERS[wizard.step]();
}

fabAdd.addEventListener("click", openWizard);
wizardClose.addEventListener("click", closeWizard);
wizardBack.addEventListener("click", () => goToStep(BACK_STEP[wizard.step]));
modalOverlay.addEventListener("click", (event) => {
  if (event.target === modalOverlay) closeWizard();
});

// ── foreground sound alerts ─────────────────────────────────────────────
// Only fires while this tab/app is open — there is no background alarm
// without native local notifications or a push server (see entities.md).
// Plays for: events at their date+time, and daily-recurrence slots at their
// time-of-day, each at most once per item.

let audioCtx = null;
function unlockAudio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}
document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });
document.addEventListener("click", requestNotificationPermission, { once: true });
document.addEventListener("touchstart", requestNotificationPermission, { once: true });

function showAlertNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "icons/icon-192.png" });
  } catch (e) {
    // Some browsers (notably iOS Safari outside an installed PWA) throw
    // rather than support the Notification constructor — sound still fires.
  }
}

function playAlertSound() {
  unlockAudio();
  const now = audioCtx.currentTime;
  for (let i = 0; i < 2; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    const t = now + i * 0.35;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }
}

const alertedKeys = new Set();

function dueEvents(nowDate) {
  const due = [];
  for (const task of tasks) {
    if (task.type !== "event" || task.done) continue;
    const key = `event:${task.id}`;
    if (alertedKeys.has(key)) continue;
    if (new Date(`${task.date}T${task.time}`) <= nowDate) {
      due.push({ key, title: task.label, body: "Event is due now" });
    }
  }
  return due;
}

function dueSlots(nowMinutes) {
  const due = [];
  for (const task of tasks) {
    if (task.type !== "repetitive" || task.recurrence?.kind !== "daily" || !hasSubtasks(task)) continue;
    for (const sub of task.subtasks) {
      if (sub.done) continue;
      const key = `slot:${task.id}:${sub.id}`;
      if (alertedKeys.has(key)) continue;
      const [h, m] = sub.label.split(":").map(Number);
      if (h * 60 + m <= nowMinutes) {
        due.push({ key, title: task.label, body: `Check-in at ${sub.label}` });
      }
    }
  }
  return due;
}

// Don't alarm retroactively for things already due when the app loads —
// only for ones whose time arrives while the app stays open.
function silenceAlreadyDueAlerts() {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (const item of [...dueEvents(now), ...dueSlots(nowMinutes)]) alertedKeys.add(item.key);
}

function checkDueAlerts() {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const due = [...dueEvents(now), ...dueSlots(nowMinutes)];
  if (due.length === 0) return;
  for (const item of due) {
    alertedKeys.add(item.key);
    showAlertNotification(item.title, item.body);
  }
  playAlertSound();
}

(async function init() {
  db = await openDB();
  tasks = await getAllTasks();
  refreshDailyRecurrences();
  render();
  silenceAlreadyDueAlerts();
  setInterval(() => {
    if (refreshDailyRecurrences()) render();
    checkDueAlerts();
  }, 20000);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
