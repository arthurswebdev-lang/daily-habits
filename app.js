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

// Builds {id,label,done} subtask records from plain label strings, keeping
// a subtask "done" if a subtask with the same label was already done
// before (so editing a task's other fields doesn't reset its checklist).
function subtasksFromLabels(labels, idPrefix, previousSubtasks) {
  const prevByLabel = new Map((previousSubtasks || []).map((s) => [s.label, s.done]));
  return labels.map((label, i) => ({ id: `${idPrefix}-${i}`, label, done: prevByLabel.get(label) || false }));
}

// A "daily" recurrence (repeat every N hours between a start and end time)
// is tracked as one checkable slot per time-of-day, reusing the subtasks
// mechanism — otherwise a single checkbox would mark the whole day's worth
// of check-ins done after the very first one. `isSlot` distinguishes
// auto-generated time slots from any extra subtasks the user adds on top.
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

function makeDailySubtasks(taskId, recurrence, previousSubtasks) {
  const slots = subtasksFromLabels(generateDailySlots(recurrence), `${taskId}-slot`, previousSubtasks);
  return slots.map((s) => ({ ...s, isSlot: true }));
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Now that tasks persist (IndexedDB), a checked-off daily slot would
// otherwise stay checked forever — this regenerates a fresh, unchecked set
// of slots whenever the calendar day has moved on since they were last
// generated, so "daily" recurrence actually resets daily. Any extra
// (non-slot) subtasks the user added are left untouched.
function refreshDailyRecurrences() {
  const today = todayDateString();
  let changed = false;
  for (const task of tasks) {
    if (task.type !== "repetitive" || task.recurrence?.kind !== "daily") continue;
    if (task.recurrence.lastGeneratedDate === today) continue;
    const extras = (task.subtasks || []).filter((s) => !s.isSlot);
    task.subtasks = [...makeDailySubtasks(task.id, task.recurrence, task.subtasks), ...extras];
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

  const editBtn = document.createElement("button");
  editBtn.className = "task-edit-btn";
  editBtn.type = "button";
  editBtn.setAttribute("aria-label", "Edit task");
  editBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 19l1-4L15 6l4 4L10 19l-4 1z"></path>' +
    '<line x1="14" y1="6" x2="18" y2="10"></line>' +
    "</svg>";
  editBtn.addEventListener("click", () => editTask(task.id));

  const del = document.createElement("button");
  del.className = "task-delete";
  del.type = "button";
  del.setAttribute("aria-label", "Delete task");
  del.textContent = "×";
  del.addEventListener("click", () => {
    if (confirm(`Delete "${task.label}"?`)) removeTask(task.id);
  });

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

  li.append(checkbox, body, editBtn, del);
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
  syncTasksToBackend();
}

function clearCompleted() {
  const removedIds = tasks.filter((t) => isDone(t)).map((t) => t.id);
  tasks = tasks.filter((t) => !isDone(t));
  render();
  for (const id of removedIds) deleteTaskRecord(id);
  syncTasksToBackend();
}

clearDoneBtn.addEventListener("click", () => {
  if (confirm("Clear all completed tasks?")) clearCompleted();
});

// ── add-task / edit-task wizard ──────────────────────────────────────────

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

let wizard = { step: "type", editingTask: null };

function openWizard() {
  wizard = { step: "type", editingTask: null };
  modalOverlay.hidden = false;
  renderWizard();
}

function editTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const step = task.type === "one-time" ? "oneTime" : task.type === "event" ? "event" : task.recurrence.kind;
  wizard = { step, editingTask: task };
  modalOverlay.hidden = false;
  renderWizard();
}

function closeWizard() {
  modalOverlay.hidden = true;
  wizardContent.innerHTML = "";
  wizard = { step: "type", editingTask: null };
}

function goToStep(step) {
  wizard.step = step;
  renderWizard();
}

// Saves fields onto the task being edited, or creates a new task — the one
// place that decides between updating in place vs. pushing a new record.
function commitTask(id, fields) {
  const editing = wizard.editingTask;
  if (editing) {
    Object.assign(editing, fields);
    putTask(editing);
  } else {
    const task = { id, ...fields };
    tasks.push(task);
    putTask(task);
  }
  closeWizard();
  render();
  syncTasksToBackend();
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

function renderLabelInput(placeholder, onInput, value) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "wizard-input";
  input.placeholder = placeholder;
  input.maxLength = 200;
  if (value) input.value = value;
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

// A small checklist builder: type a step, tap + (or Enter) to add it, tap ×
// to remove. `items` is a plain array of label strings, mutated in place.
function renderSubtaskBuilder(items) {
  const wrap = document.createElement("div");
  wrap.className = "subtask-builder";

  const list = document.createElement("ul");
  list.className = "subtask-builder-list";

  function renderList() {
    list.innerHTML = "";
    items.forEach((label, i) => {
      const li = document.createElement("li");
      li.className = "subtask-builder-item";

      const span = document.createElement("span");
      span.textContent = label;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "subtask-builder-remove";
      removeBtn.setAttribute("aria-label", "Remove step");
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        items.splice(i, 1);
        renderList();
      });

      li.append(span, removeBtn);
      list.appendChild(li);
    });
  }
  renderList();

  const addRow = document.createElement("div");
  addRow.className = "subtask-builder-add-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "wizard-input";
  input.placeholder = "Add a step…";
  input.maxLength = 120;

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "subtask-builder-add-btn";
  addBtn.setAttribute("aria-label", "Add step");
  addBtn.textContent = "+";

  function addItem() {
    const v = input.value.trim();
    if (!v) return;
    items.push(v);
    input.value = "";
    renderList();
    input.focus();
  }
  addBtn.addEventListener("click", addItem);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addItem(); }
  });

  addRow.append(input, addBtn);
  wrap.append(list, addRow);
  return wrap;
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
  const editing = wizard.editingTask;
  const data = {
    label: editing?.label || "",
    category: editing?.category ?? activeCategory,
    subtasks: (editing?.subtasks || []).map((s) => s.label),
  };
  const submitBtn = renderSubmitButton(editing ? "Save changes" : "Add task", () => {
    const id = editing ? editing.id : crypto.randomUUID();
    const subtasks = data.subtasks.length ? subtasksFromLabels(data.subtasks, id, editing?.subtasks) : undefined;
    const fields = { type: "one-time", label: data.label.trim(), category: data.category || NONE_KEY, subtasks };
    if (!subtasks) fields.done = editing ? (editing.done ?? false) : false;
    commitTask(id, fields);
  });
  const updateReady = () => { submitBtn.disabled = !data.label.trim(); };

  wizardContent.append(
    renderFieldLabel("Task name"),
    renderLabelInput("e.g. Call the plumber", (v) => { data.label = v; updateReady(); }, data.label),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    renderFieldLabel("Subtasks (optional)"),
    renderSubtaskBuilder(data.subtasks),
    submitBtn
  );
  updateReady();
}

function renderStepEvent() {
  const editing = wizard.editingTask;
  const today = new Date().toISOString().slice(0, 10);
  const data = {
    label: editing?.label || "",
    category: editing?.category ?? activeCategory,
    date: editing?.date || today,
    time: editing?.time || "09:00",
    subtasks: (editing?.subtasks || []).map((s) => s.label),
  };
  const submitBtn = renderSubmitButton(editing ? "Save changes" : "Add event", () => {
    const id = editing ? editing.id : crypto.randomUUID();
    const subtasks = data.subtasks.length ? subtasksFromLabels(data.subtasks, id, editing?.subtasks) : undefined;
    const fields = { type: "event", label: data.label.trim(), category: data.category || NONE_KEY, date: data.date, time: data.time, subtasks };
    if (!subtasks) fields.done = editing ? (editing.done ?? false) : false;
    commitTask(id, fields);
  });
  const updateReady = () => { submitBtn.disabled = !(data.label.trim() && data.date && data.time); };

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "wizard-input";
  dateInput.value = data.date;
  dateInput.addEventListener("input", () => { data.date = dateInput.value; updateReady(); });

  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.className = "wizard-input";
  timeInput.value = data.time;
  timeInput.addEventListener("input", () => { data.time = timeInput.value; updateReady(); });

  wizardContent.append(
    renderFieldLabel("Event name"),
    renderLabelInput("e.g. Doctor's appointment", (v) => { data.label = v; updateReady(); }, data.label),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    renderFieldLabel("Date"),
    dateInput,
    renderFieldLabel("Time"),
    timeInput,
    renderFieldLabel("Subtasks (optional)"),
    renderSubtaskBuilder(data.subtasks),
    submitBtn
  );
  updateReady();
}

function renderStepWeekly() {
  const editing = wizard.editingTask;
  const data = {
    label: editing?.label || "",
    category: editing?.category ?? activeCategory,
    days: editing ? [...editing.recurrence.days] : [],
    subtasks: (editing?.subtasks || []).map((s) => s.label),
  };
  const submitBtn = renderSubmitButton(editing ? "Save changes" : "Add task", () => {
    const id = editing ? editing.id : crypto.randomUUID();
    const subtasks = data.subtasks.length ? subtasksFromLabels(data.subtasks, id, editing?.subtasks) : undefined;
    const fields = { type: "repetitive", label: data.label.trim(), category: data.category || NONE_KEY, recurrence: { kind: "weekly", days: [...data.days] }, subtasks };
    if (!subtasks) fields.done = editing ? (editing.done ?? false) : false;
    commitTask(id, fields);
  });
  const updateReady = () => { submitBtn.disabled = !(data.label.trim() && data.days.length > 0); };

  const dayRow = document.createElement("div");
  dayRow.className = "day-toggle-row";
  for (const day of WEEKDAYS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "day-chip" + (data.days.includes(day.key) ? " selected" : "");
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
    renderLabelInput("e.g. Gym session", (v) => { data.label = v; updateReady(); }, data.label),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    renderFieldLabel("Repeat on"),
    dayRow,
    renderFieldLabel("Subtasks (optional)"),
    renderSubtaskBuilder(data.subtasks),
    submitBtn
  );
  updateReady();
}

function renderStepMonthly() {
  const editing = wizard.editingTask;
  const data = {
    label: editing?.label || "",
    category: editing?.category ?? activeCategory,
    dayOfMonth: editing?.recurrence.dayOfMonth || 1,
    subtasks: (editing?.subtasks || []).map((s) => s.label),
  };
  const submitBtn = renderSubmitButton(editing ? "Save changes" : "Add task", () => {
    const id = editing ? editing.id : crypto.randomUUID();
    const subtasks = data.subtasks.length ? subtasksFromLabels(data.subtasks, id, editing?.subtasks) : undefined;
    const fields = { type: "repetitive", label: data.label.trim(), category: data.category || NONE_KEY, recurrence: { kind: "monthly", dayOfMonth: data.dayOfMonth }, subtasks };
    if (!subtasks) fields.done = editing ? (editing.done ?? false) : false;
    commitTask(id, fields);
  });
  const updateReady = () => { submitBtn.disabled = !(data.label.trim() && data.dayOfMonth >= 1 && data.dayOfMonth <= 31); };

  const dayInput = document.createElement("input");
  dayInput.type = "number";
  dayInput.className = "wizard-input";
  dayInput.min = "1";
  dayInput.max = "31";
  dayInput.value = String(data.dayOfMonth);
  dayInput.addEventListener("input", () => { data.dayOfMonth = Number(dayInput.value); updateReady(); });

  wizardContent.append(
    renderFieldLabel("Task name"),
    renderLabelInput("e.g. Pay rent", (v) => { data.label = v; updateReady(); }, data.label),
    renderFieldLabel("Category (optional)"),
    renderCategoryPicker(data.category, (key) => { data.category = key; updateReady(); }),
    renderFieldLabel("Day of month"),
    dayInput,
    renderFieldLabel("Subtasks (optional)"),
    renderSubtaskBuilder(data.subtasks),
    submitBtn
  );
  updateReady();
}

function renderStepDaily() {
  const editing = wizard.editingTask;
  const data = {
    label: editing?.label || "",
    category: editing?.category ?? activeCategory,
    start: editing?.recurrence.start || "09:00",
    intervalHours: editing?.recurrence.intervalHours || 2,
    end: editing?.recurrence.end || "20:00",
  };
  const submitBtn = renderSubmitButton(editing ? "Save changes" : "Add task", () => {
    const id = editing ? editing.id : crypto.randomUUID();
    const recurrence = { kind: "daily", start: data.start, intervalHours: data.intervalHours, end: data.end, lastGeneratedDate: todayDateString() };
    const subtasks = makeDailySubtasks(id, recurrence, editing?.subtasks);
    commitTask(id, { type: "repetitive", label: data.label.trim(), category: data.category || NONE_KEY, recurrence, subtasks });
  });
  const updateReady = () => { submitBtn.disabled = !(data.label.trim() && data.start && data.end && data.intervalHours > 0); };

  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.className = "wizard-input";
  startInput.value = data.start;
  startInput.addEventListener("input", () => { data.start = startInput.value; updateReady(); });

  const intervalInput = document.createElement("input");
  intervalInput.type = "number";
  intervalInput.className = "wizard-input";
  intervalInput.min = "1";
  intervalInput.max = "12";
  intervalInput.value = String(data.intervalHours);
  intervalInput.addEventListener("input", () => { data.intervalHours = Number(intervalInput.value); updateReady(); });

  const endInput = document.createElement("input");
  endInput.type = "time";
  endInput.className = "wizard-input";
  endInput.value = data.end;
  endInput.addEventListener("input", () => { data.end = endInput.value; updateReady(); });

  wizardContent.append(
    renderFieldLabel("Task name"),
    renderLabelInput("e.g. Drink water", (v) => { data.label = v; updateReady(); }, data.label),
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
  updateReady();
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
  const editing = wizard.editingTask;
  wizardTitle.textContent = (editing ? "Edit: " : "") + STEP_TITLES[wizard.step];
  wizardBack.hidden = editing ? true : !(wizard.step in BACK_STEP);
  STEP_RENDERERS[wizard.step]();
}

fabAdd.addEventListener("click", openWizard);
wizardClose.addEventListener("click", closeWizard);
wizardBack.addEventListener("click", () => goToStep(BACK_STEP[wizard.step]));
modalOverlay.addEventListener("click", (event) => {
  if (event.target === modalOverlay) closeWizard();
});

// ── push notifications ──────────────────────────────────────────────────────

const BACKEND_URL = "https://daily-tasks-server.fly.dev";
let deviceId;
let firebaseMessaging;

function getDeviceId() {
  if (!deviceId) {
    let id = localStorage.getItem("daily-tasks-deviceId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("daily-tasks-deviceId", id);
    }
    deviceId = id;
  }
  return deviceId;
}

async function initFirebase() {
  if (!window.FIREBASE_CONFIG) return;
  firebase.initializeApp(window.FIREBASE_CONFIG);
  firebaseMessaging = firebase.messaging();

  firebaseMessaging.onMessage((payload) => {
    const { title, body } = payload.notification || {};
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title || "Daily Tasks", { body, icon: "./icon.png" });
    }
  });
}

async function registerDeviceAndSync() {
  if (!firebaseMessaging) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const token = await firebaseMessaging.getToken({ vapidKey: window.FCM_VAPID_KEY });
    if (!token) return;

    const deviceId = getDeviceId();
    await fetch(`${BACKEND_URL}/api/devices/${deviceId}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    syncTasksToBackend();
  } catch (err) {
    console.error("Firebase setup error:", err);
  }
}

async function syncTasksToBackend() {
  if (!firebaseMessaging) return;
  try {
    const deviceId = getDeviceId();
    const syncTasks = tasks.filter(t => t.type === "event" || (t.type === "repetitive" && t.recurrence?.kind === "daily"));
    await fetch(`${BACKEND_URL}/api/devices/${deviceId}/tasks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: syncTasks }),
    });
  } catch (err) {
    console.error("Sync error:", err);
  }
}

(async function init() {
  db = await openDB();
  tasks = await getAllTasks();
  refreshDailyRecurrences();
  render();
  setInterval(() => {
    if (refreshDailyRecurrences()) render();
  }, 20000);

  await initFirebase();
  await registerDeviceAndSync();
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
