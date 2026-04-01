/**
 * מערכת לוז - בית ספר לטיסה
 * Frontend Logic
 */

// ─── STATE ───
const state = {
  currentWeek: getMonday(new Date()),
  reportWeek: getMonday(new Date()),
  employees: [],
  roles: [],
  shiftTypes: [],
  shifts: [],
  constraints: [],
  editingShiftId: null,
  editingEmpId: null,
  waLinks: [],
  managers: {},
  tunnel: { status: "stopped", public_url: null, local_url: null, base_url: null },
  // managers: { "YYYY-MM-DD": { day: "שם", night: "שם", open: "שם", close: "שם" } }
  flightboardWeek: null, // set in init
  fbBoards: [],
  fbData: {}, // { boardId: { "dateStr|hour": "empName" } }
  currentDay: new Date(), // for daily matrix view
  fbDay: new Date(),      // flight board daily view
  fbCadetData:   {},  // { boardId: { 'YYYY-MM-DD|HH:MM': 'cadetName' } }
  fbSyllabusData: {},  // { boardId: { key: 'syllabus' } }
  fbAmlachData:   {},  // { boardId: { key: 'amlach' } }
  fbRoomData:     {},  // חדר ת"ת
  fbTrendData:    {},  // מגמה
  fbNotesData:    {},  // הערות
  highlightedShiftId: null,
  shiftBoardMap: {}, // { shiftId: boardId } - assigned board per shift
  colorRules: [],    // [ { words: ["מילה1","מילה2"], color: "#hex" } ]
};

const DAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// ─── UTILS ───
function getMonday(d) {
  // In Israel week starts on Sunday - get the Sunday of the week
  const dt = new Date(d);
  const day = dt.getDay(); // 0=Sun
  dt.setDate(dt.getDate() - day);
  dt.setHours(0,0,0,0);
  return dt;
}

function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

function formatDate(d) {
  // Use local date (not UTC) to avoid timezone shift
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(d) {
  return `${d.getDate().toString().padStart(2,"0")}/${(d.getMonth()+1).toString().padStart(2,"0")}`;
}

function dayName(d) {
  return DAYS_HE[d.getDay()];
}

async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `שגיאת שרת ${res.status}`);
  }
  return res.json();
}

function showError(msg) {
  alert("❌ " + msg);
}

// ─── NAV ───
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    const view = document.getElementById(`view-${btn.dataset.view}`);
    if (view) view.classList.add("active");
    if (btn.dataset.view === "reports") loadReports();
    if (btn.dataset.view === "settings") loadSettings();
    if (btn.dataset.view === "employees") loadEmployeesView();
    if (btn.dataset.view === "flightboard") renderFlightBoard();
    if (btn.dataset.view === "schedule") { renderDailyMatrix(); renderTimeline(); }
  });
});

// ─── MODAL ───
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.getElementById(btn.dataset.close).classList.add("hidden");
  });
});
document.querySelectorAll(".modal-overlay").forEach(m => {
  m.addEventListener("click", e => {
    if (e.target === m) m.classList.add("hidden");
  });
});

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

// ─── MANAGERS TABLE ───
function loadManagersFromStorage() {
  try {
    const saved = localStorage.getItem("managers_data");
    if (saved) state.managers = JSON.parse(saved);
  } catch(e) {}
}

function saveManagersToStorage() {
  localStorage.setItem("managers_data", JSON.stringify(state.managers));
}

// בדוק אם מפעיל מאויש במשמרת שמתנגשת עם תפקיד מנהל
// מנהל יום: אזהרה אם מאויש במשמרת שמסתיימת עד 18:00
// מנהל לילה: אזהרה אם מאויש במשמרת שמתחילה מ-16:00
function checkManagerConflict(empName, dateStr, type) {
  const emp = state.employees.find(e => e.name === empName);
  if (!emp) return null;

  const dayShifts = state.shifts.filter(
    s => s.employee_id === emp.id && s.shift_date === dateStr
  );

  for (const s of dayShifts) {
    const startMin = timeToMin(s.start_time);
    const endMin   = timeToMin(s.end_time);

    if (type === "day" && startMin < 18 * 60) {
      // מאויש במשמרת שמסתיימת לפני/ב-18:00 — מנהל יום עסוק
      return `${empName} מאויש במשמרת ${s.start_time}-${s.end_time}`;
    }
    if (type === "night" && endMin > 16 * 60) {
      // מאויש במשמרת שמתחילה מ-16:00 — מנהל לילה עסוק
      return `${empName} מאויש במשמרת ${s.start_time}-${s.end_time}`;
    }
  }
  return null;
}

function timeToMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// Replace browser time inputs with custom 24h selects
function buildTimeOptions(selectedVal) {
  let opts = "";
  for (let h = 0; h < 24; h++) {
    for (let m of [0, 30]) {
      const hh = h.toString().padStart(2, "0");
      const mm = m.toString().padStart(2, "0");
      const val = `${hh}:${mm}`;
      opts += `<option value="${val}" ${selectedVal === val ? "selected" : ""}>${val}</option>`;
    }
  }
  return opts;
}

function replaceTimeInputs() {
  document.querySelectorAll('input[type="time"]').forEach(input => {
    const sel = document.createElement("select");
    sel.id = input.id;
    sel.className = input.className;
    sel.innerHTML = buildTimeOptions(input.value || input.defaultValue || "08:00");
    // copy any inline styles
    sel.style.cssText = input.style.cssText;
    input.parentNode.replaceChild(sel, input);
  });
}

function renderManagersTableDaily() {
  // Use fbDay when on flightboard view, else currentDay
  const baseDay = document.getElementById("view-flightboard")?.classList.contains("active")
    ? state.fbDay : state.currentDay;
  const days = Array.from({ length: 7 }, (_, i) => addDays(getMonday(baseDay), i));
  const today = formatDate(new Date());
  const thead = document.getElementById("managers-head");
  const tbody = document.getElementById("managers-body");

  // Header row — same style as schedule table
  let thHTML = `<th class="col-manager-label"></th>`;
  days.forEach(d => {
    const isToday = formatDate(d) === today;
    thHTML += `<th class="${isToday ? 'today-col' : ''}">
      <div class="day-name">${dayName(d)}</div>
      <div class="day-date">${formatDateDisplay(d)}</div>
    </th>`;
  });
  thead.innerHTML = thHTML;

  const rows = [
    { type: "manlach", label: 'מנל"ח'    },
    { type: "day",    label: "מנהל יום"  },
    { type: "open",   label: "פתיחת יום" },
    { type: "night",  label: "מנהל לילה" },
    { type: "close",  label: "סגירת יום" },
  ];

  tbody.innerHTML = rows.map(row => {
    let cells = `<td class="col-manager-label">${row.label}</td>`;
    days.forEach(d => {
      const dateStr = formatDate(d);
      const mgr = state.managers[dateStr] || { day: "", night: "", open: "", close: "", manlach: "" };
      const isToday = dateStr === today;
      const selectedName = mgr[row.type] || "";

      // בדיקת התנגשות רק למנהל יום/לילה
      // מנל"ח: warn if assigned to a shift > 60min
      let manlachWarn = null;
      if (row.type === "manlach" && selectedName) {
        const empShiftsDay = (state.shifts||[]).filter(s =>
          s.emp_name === selectedName && s.shift_date === dateStr
        );
        const longShift = empShiftsDay.find(s => timeToMin(s.end_time) - timeToMin(s.start_time) > 60);
        if (longShift) {
          manlachWarn = `מנל"ח לא יכול להיות במשמרת מעל שעה (${longShift.start_time}–${longShift.end_time})`;
        }
      }
      const conflict = manlachWarn || (selectedName && (row.type === "day" || row.type === "night")
        ? checkManagerConflict(selectedName, dateStr, row.type)
        : null);

      const conflictHTML = conflict
        ? `<div class="manager-conflict" title="${conflict}">⚠ ${conflict}</div>`
        : "";

      cells += `<td class="${isToday ? 'today-col' : ''}${conflict ? ' manager-conflict-cell' : ''}">
        <select class="manager-select" data-date="${dateStr}" data-type="${row.type}" onchange="onManagerChange(this)">
          <option value="">--</option>
          ${state.employees.map(e => `<option value="${e.name}" ${mgr[row.type] === e.name ? "selected" : ""}>${e.name}</option>`).join("")}
        </select>
        ${conflictHTML}
      </td>`;
    });
    return `<tr>${cells}</tr>`;
  }).join("");
}

function onManagerChange(el) {
  const date = el.dataset.date;
  const type = el.dataset.type;
  if (!state.managers[date]) state.managers[date] = { day: "", night: "", open: "", close: "", manlach: "" };
  state.managers[date][type] = el.value;
  saveManagersToStorage();
  renderManagersTableDaily(); // רענן כדי לעדכן אזהרות
}

// ─── CLEAR WEEK ───
async function clearWeekShifts() {
  const weekStart = formatDate(getMonday(state.currentDay));
  const weekEnd   = formatDate(addDays(getMonday(state.currentDay), 6));
  const shiftsCount = (state.shifts||[]).filter(s =>
    s.shift_date >= weekStart && s.shift_date <= weekEnd
  ).length;
  const consCount = (state.constraints||[]).filter(c => {
    const cs = c.start_datetime.substring(0,10);
    const ce = c.end_datetime.substring(0,10);
    return cs <= weekEnd && ce >= weekStart;
  }).length;

  const total = shiftsCount + consCount;
  if (total === 0) { alert("אין נתונים לניקוי השבוע"); return; }

  const confirmed = confirm(
    `⚠ אזהרה!\n\nפעולה זו תמחק:\n• ${shiftsCount} משמרות\n• ${consCount} אילוצים\n\nלשבוע ${weekStart} עד ${weekEnd}.\n\nהפעולה אינה הפיכה. האם אתה בטוח?`
  );
  if (!confirmed) return;
  const confirmed2 = confirm("אישור נוסף — למחוק הכל?");
  if (!confirmed2) return;

  let deletedShifts = 0, deletedCons = 0;

  for (const s of (state.shifts||[]).filter(s => s.shift_date >= weekStart && s.shift_date <= weekEnd)) {
    try { await api(`/api/shifts/${s.id}`, "DELETE"); deletedShifts++; } catch(e) {}
  }
  for (const c of (state.constraints||[]).filter(c => {
    const cs = c.start_datetime.substring(0,10), ce = c.end_datetime.substring(0,10);
    return cs <= weekEnd && ce >= weekStart;
  })) {
    try { await api(`/api/constraints/${c.id}`, "DELETE"); deletedCons++; } catch(e) {}
  }

  showSuccess(`נמחקו ${deletedShifts} משמרות ו-${deletedCons} אילוצים`);
  await loadDailySchedule();
}

function showSuccess(msg) {
  const banner = document.getElementById("violations-banner");
  if (!banner) return;
  banner.textContent = "✅ " + msg;
  banner.classList.remove("hidden");
  banner.style.background = "rgba(22,163,74,0.15)";
  banner.style.borderColor = "rgba(22,163,74,0.4)";
  banner.style.color = "#4ade80";
  setTimeout(() => {
    banner.classList.add("hidden");
    banner.style = "";
  }, 3000);
}

// ─── INIT ───
async function init() {
  loadManagersFromStorage();
  fbLoadFromStorage();
  state.flightboardWeek = getMonday(state.fbDay || new Date());
  state.fbDay = state.fbDay || new Date();
  state.currentDay = new Date();
  await Promise.all([loadMeta()]);
  await loadDailySchedule();
  replaceTimeInputs();
  renderFlightBoard();
}

async function loadMeta() {
  [state.employees, state.roles, state.shiftTypes] = await Promise.all([
    api("/api/employees"),
    api("/api/roles"),
    api("/api/shift-types"),
  ]);
  populateSelects();
}

function populateSelects() {
  // Populate time selects (shift-start, shift-end)
  const timeOpts = buildTimeOptions("");
  ["shift-start", "shift-end"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName === "SELECT") {
      const cur = el.value;
      el.innerHTML = buildTimeOptions(cur || (id === "shift-start" ? "08:00" : "09:00"));
    }
  });

  // Shift type select
  const stSel = document.getElementById("shift-type-select");
  if (stSel) {
    stSel.innerHTML = state.shiftTypes.map(st =>
      `<option value="${st.id}">${st.name} (${st.duration_minutes} דק')</option>`
    ).join("");
  }

  // Employee selects
  const empOptions = `<option value="">-- לא מאויש --</option>` +
    state.employees.map(e => `<option value="${e.id}">${e.name} (${e.role_name})</option>`).join("");

  document.getElementById("shift-emp-select").innerHTML = empOptions;

  const conEmpSel = document.getElementById("con-emp-select");
  conEmpSel.innerHTML = state.employees.map(e =>
    `<option value="${e.id}">${e.name}</option>`
  ).join("");

  // Role select for employee modal
  const roleSel = document.getElementById("emp-role-select");
  roleSel.innerHTML = state.roles.map(r =>
    `<option value="${r.id}">${r.name}</option>`
  ).join("");

  // History select
  const histSel = document.getElementById("hist-emp-select");
  histSel.innerHTML = `<option value="">-- בחר מפעיל --</option>` +
    state.employees.map(e => `<option value="${e.id}">${e.name}</option>`).join("");
}

// ─── SCHEDULE ───
// Load shifts for the current week (for workload + violations)
async function loadWeekShiftsForWorkload() {
  const weekStr = formatDate(getMonday(state.currentDay));
  state.shifts = await api(`/api/shifts?week_start=${weekStr}`);
  state.constraints = await api(`/api/constraints`);
}

async function loadDailySchedule() {
  // Load the whole week so workload works
  const weekStr = formatDate(getMonday(state.currentDay));
  [state.shifts, state.constraints] = await Promise.all([
    api(`/api/shifts?week_start=${weekStr}`),
    api(`/api/constraints`),
  ]);
  updateDayLabel();
  renderDailyMatrix();
  renderManagersTableDaily();
  renderTimeline();
  await loadWorkload();
  await checkAllViolations();
  // Sync to flightboard
  const _fbView = document.getElementById("view-flightboard");
  if (_fbView && _fbView.classList.contains("active")) renderFlightBoard();
}

function updateDayLabel() {
  const d = state.currentDay;
  const dayIdx = d.getDay(); // 0=Sun
  const label = `${DAYS_HE[dayIdx === 0 ? 0 : dayIdx]} ${formatDateDisplay(d)}`;
  const el = document.getElementById("day-label");
  if (el) el.textContent = label;
}

function updateWeekLabel() {
  const end = addDays(getMonday(state.currentDay), 6);
  const wlEl = document.getElementById("week-label");
  if (wlEl) wlEl.textContent = `${formatDateDisplay(getMonday(state.currentDay))} - ${formatDateDisplay(end)}`;
}

function renderDailyMatrix() {
  const thead = document.getElementById("days-header");
  const tbody = document.getElementById("schedule-body");
  if (!thead || !tbody) return;

  const dateStr = formatDate(state.currentDay);
  // Hours 06:00–21:00 — fit to screen width (no horizontal scroll)
  const HOURS = Array.from({length:16}, (_,h) => `${String(h+6).padStart(2,"0")}:00`);

  // ── Header
  let thHTML = `<th class="col-emp-sticky">מפעיל</th>`;
  HOURS.forEach(h => { thHTML += `<th class="col-hour-slot">${h.slice(0,2)}</th>`; });
  thead.innerHTML = thHTML;

  // ── Build lookups
  const empShiftsToday = {}, empCons = {};
  (state.shifts||[]).forEach(s => {
    if (s.shift_date === dateStr && s.employee_id)
      (empShiftsToday[s.employee_id] = empShiftsToday[s.employee_id]||[]).push(s);
  });
  (state.constraints||[]).forEach(c => {
    const cS = c.start_datetime.substring(0,10), cE = c.end_datetime.substring(0,10);
    if (cS <= dateStr && cE >= dateStr)
      (empCons[c.employee_id] = empCons[c.employee_id]||[]).push(c);
  });

  // ── Warn if overloaded (units≥3 + short gap) or constraint hits prep/rec window
  const consecutiveWarnings = {};
  state.employees.forEach(emp => {
    const todayShifts = (empShiftsToday[emp.id]||[]).sort((a,b) => timeToMin(a.start_time) - timeToMin(b.start_time));
    // Count "units": ≥120min shift = 2 units, else 1. Only warn if units≥3 AND any gap<3h.
    const units = todayShifts.reduce((sum, s) => {
      const dur = timeToMin(s.end_time) - timeToMin(s.start_time);
      return sum + (dur >= 120 ? 2 : 1);
    }, 0);
    if (units >= 3) {
      for (let i = 0; i < todayShifts.length - 1; i++) {
        const gap = timeToMin(todayShifts[i+1].start_time) - timeToMin(todayShifts[i].end_time);
        if (gap < 180) { consecutiveWarnings[emp.id] = true; break; }
      }
    }
    // Warn if any constraint overlaps prep/recovery window of a shift
    const empConsTodayList = empCons[emp.id] || [];
    if (empConsTodayList.length && todayShifts.length) {
      for (const s of todayShifts) {
        const dur_s       = timeToMin(s.end_time) - timeToMin(s.start_time);
        const prepW       = dur_s >= 120 ? 60 : (s.prep_minutes||0);
        const recW        = dur_s >= 120 ? 60 : (s.recovery_minutes||0);
        const windowStart = timeToMin(s.start_time) - prepW;
        const windowEnd   = timeToMin(s.end_time)   + recW;
        for (const c of empConsTodayList) {
          const hasT = c.start_datetime.length > 10 && c.start_datetime.substring(11,16).trim();
          const cS   = hasT ? timeToMin(c.start_datetime.substring(11,16)) : 0;
          const cE   = (c.end_datetime.length > 10 && c.end_datetime.substring(11,16).trim())
            ? timeToMin(c.end_datetime.substring(11,16)) : 24*60;
          if (cS < windowEnd && (cE||24*60) > windowStart) {
            consecutiveWarnings[emp.id] = true;
          }
        }
      }
    }
  });

  let rowsHTML = "";
  state.employees.forEach(emp => {
    const shifts = empShiftsToday[emp.id]||[];
    const cons   = empCons[emp.id]||[];
    const warn   = consecutiveWarnings[emp.id];

    let row = `<td class="col-emp-sticky${warn ? " wl-emp-warn" : ""}"
      onclick="showTimeline('${emp.id}','${dateStr}')"
      style="cursor:pointer" title="הצג ציר זמן יומי">
      <span style="color:${emp.role_color};font-weight:700;font-size:0.82rem">${emp.name}${warn ? " ⚠" : ""}</span>
      <div style="font-size:0.65rem;color:var(--text-muted)">${emp.role_name}</div>
    </td>`;

    HOURS.forEach(hour => {
      const hMin  = timeToMin(hour);
      // Is this hour inside a shift?
      const shift = shifts.find(s => hMin >= timeToMin(s.start_time) && hMin < timeToMin(s.end_time));
      // Is this hour inside a constraint?
      const con = !shift && cons.find(c => {
        const cDateStr = c.start_datetime.substring(0,10);
        const cEndStr  = c.end_datetime.substring(0,10);
        // Full-day constraint (no time part)
        const hasStartTime = c.start_datetime.length > 10 && c.start_datetime.substring(11,16).trim() !== "";
        const hasEndTime   = c.end_datetime.length > 10   && c.end_datetime.substring(11,16).trim() !== "";
        let cS = hasStartTime ? timeToMin(c.start_datetime.substring(11,16)) : 0;
        let cE = hasEndTime   ? timeToMin(c.end_datetime.substring(11,16))   : 24*60;
        // Multi-day: if not the start/end day, use full day
        if (cDateStr < dateStr) cS = 0;
        if (cEndStr  > dateStr) cE = 24*60;
        if (cE === 0) cE = 24*60;
        return hMin >= cS && hMin < cE;
      });
      // Is this hour in prep window (before a shift)?
      // If actual duration >= 120min, override prep/rec to 60min
      const inPrep = !shift && !con && shifts.find(s => {
        const dur  = timeToMin(s.end_time) - timeToMin(s.start_time);
        const prep = dur >= 120 ? 60 : (s.prep_minutes||0);
        return prep > 0 && hMin >= timeToMin(s.start_time) - prep && hMin < timeToMin(s.start_time);
      });
      // Is this hour in recovery window (after a shift)?
      const inRec = !shift && !con && !inPrep && shifts.find(s => {
        const dur = timeToMin(s.end_time) - timeToMin(s.start_time);
        const rec = dur >= 120 ? 60 : (s.recovery_minutes||0);
        return rec > 0 && hMin >= timeToMin(s.end_time) && hMin < timeToMin(s.end_time) + rec;
      });

      const isHighlighted = shift && state.highlightedShiftId === shift.id;

      if (shift) {
        const hasV    = state._shiftViolations && state._shiftViolations[shift.id];
        const isStart = timeToMin(shift.start_time) === hMin;
        const cellLabel = isStart
          ? (shift.notes && shift.notes.trim()
              ? `<span class="hour-label-shift notes-label">${shift.notes.trim()}${hasV ? " ⚠" : ""}</span>`
              : (hasV ? `<span class="hour-label-shift">⚠</span>` : ""))
          : "";

        // Sync notes → flightboard syllabus column for each hour slot of this shift
        if (shift.notes && shift.notes.trim()) {
          const assignedBoardId = (state.shiftBoardMap || {})[String(shift.id)];
          if (assignedBoardId) {
            if (!state.fbSyllabusData[assignedBoardId]) state.fbSyllabusData[assignedBoardId] = {};
            const startMin = timeToMin(shift.start_time);
            const endMin   = timeToMin(shift.end_time);
            FB_ALL_HOURS.forEach(h => {
              const hm = timeToMin(h);
              if (hm >= startMin && hm < endMin) {
                const key = `${dateStr}|${h}`;
                state.fbSyllabusData[assignedBoardId][key] = shift.notes.trim();
              }
            });
            fbSaveToStorage();
          }
        }

        row += `<td class="hour-cell shift-cell-hour${isHighlighted ? " shift-highlighted" : ""}"
          onclick="selectShift(${shift.id})"
          title="${shift.type_name} ${shift.start_time}–${shift.end_time}${shift.notes ? ": " + shift.notes : ""}${hasV ? " ⚠ חריגה" : ""}">
          ${cellLabel}
        </td>`;
      } else if (con) {
        const typeHe = CONSTRAINT_TYPE_HE[con.constraint_type]||con.constraint_type;
        const isStart = timeToMin(con.start_datetime.substring(11,16)||"00:00") === hMin ||
          (!con.start_datetime.substring(11,16).trim() && hMin === 0);
        row += `<td class="hour-cell con-cell-hour"
          onclick="openEditConstraint(${con.id})"
          title="${typeHe}${con.reason ? ': ' + con.reason : ''} — לחץ לעריכה">
          ${isStart ? `<span class="con-type-label">${typeHe}</span>` : ''}
        </td>`;
      } else if (inPrep) {
        // prep shown only in timeline popup - but still allow adding a shift (override warning)
        row += `<td class="hour-cell prep-cell-muted"
          oncontextmenu="event.preventDefault();showCellMenu(event,'${dateStr}','${emp.id}','${hour}')"
          title="תדריך | לחץ ימני: הוסף"></td>`;
      } else if (inRec) {
        // recovery - also allow adding a shift
        row += `<td class="hour-cell rec-cell-muted"
          oncontextmenu="event.preventDefault();showCellMenu(event,'${dateStr}','${emp.id}','${hour}')"
          title="תחקיר | לחץ ימני: הוסף"></td>`;
      } else {
        row += `<td class="hour-cell empty-cell-hour"
          oncontextmenu="event.preventDefault();showCellMenu(event,'${dateStr}','${emp.id}','${hour}')"
          title="לחץ ימני: הוסף משמרת / אילוץ"></td>`;
      }
    });

    rowsHTML += `<tr>${row}</tr>`;
  });
  tbody.innerHTML = rowsHTML;

  if (state.highlightedShiftId) {
    const el = document.querySelector(".shift-highlighted");
    if (el) el.scrollIntoView({behavior:"smooth", block:"nearest", inline:"center"});
  }
}

function selectShift(shiftId) {
  if (state.highlightedShiftId === shiftId) {
    // Second click = open edit
    state.highlightedShiftId = null;
    openEditShift(shiftId);
  } else {
    state.highlightedShiftId = shiftId;
    renderDailyMatrix();
  }
}




function renderWeekAnalysis() {
  // Populate employee select
  const sel = document.getElementById("analysis-emp-select");
  sel.innerHTML = `<option value="">-- בחר מפעיל --</option>` +
    state.employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  sel.onchange = () => renderAnalysisContent(parseInt(sel.value));
  document.getElementById("analysis-content").innerHTML = "";
}

function renderAnalysisContent(empId) {
  const container = document.getElementById("analysis-content");
  if (!empId) { container.innerHTML = ""; return; }
  const emp = state.employees.find(e => e.id === empId);
  const weekStart = getMonday(state.currentDay);
  const weekEnd   = addDays(weekStart, 6);
  const weekStartStr = formatDate(weekStart);
  const weekEndStr   = formatDate(weekEnd);

  const empShifts = (state.shifts || []).filter(s =>
    s.employee_id === empId &&
    s.shift_date >= weekStartStr && s.shift_date <= weekEndStr
  );

  // Use actual hours from start/end times, not duration_minutes (which is shift TYPE duration)
  const totalMin = empShifts.reduce((sum, s) => {
    const mins = timeToMin(s.end_time) - timeToMin(s.start_time);
    return sum + (mins > 0 ? mins : 0);
  }, 0);
  const lateShifts = empShifts.filter(s => timeToMin(s.end_time) > 17*60);

  let html = `<div class="analysis-header">${emp.name} — שבוע ${formatDateDisplay(weekStart)}–${formatDateDisplay(weekEnd)}</div>`;
  html += `<div class="analysis-stats">
    <div class="stat-box"><div class="stat-val">${empShifts.length}</div><div class="stat-lbl">משמרות</div></div>
    <div class="stat-box"><div class="stat-val">${(totalMin/60).toFixed(1)}</div><div class="stat-lbl">שעות</div></div>
    <div class="stat-box"><div class="stat-val">${lateShifts.length}</div><div class="stat-lbl">ערב</div></div>
  </div>`;

  // Day by day breakdown
  html += `<div class="analysis-days">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const dStr = formatDate(d);
    const dayShifts = empShifts.filter(s => s.shift_date === dStr);
    if (!dayShifts.length) continue;
    html += `<div class="analysis-day-row">
      <span class="analysis-day-name">${DAYS_HE[d.getDay()===0?0:d.getDay()]} ${formatDateDisplay(d)}</span>
      ${dayShifts.map(s => `<span class="analysis-shift-badge" style="background:${s.type_color}33;border:1px solid ${s.type_color};color:${s.type_color}">
        ${s.type_name} ${s.start_time}–${s.end_time}
      </span>`).join('')}
    </div>`;
  }
  html += `</div>`;

  // Constraints this week
  const empCons = (state.constraints||[]).filter(c =>
    c.employee_id === empId &&
    c.start_datetime.substring(0,10) <= weekEndStr &&
    c.end_datetime.substring(0,10) >= weekStartStr
  );
  if (empCons.length) {
    html += `<div class="analysis-cons-header">אילוצים:</div>`;
    empCons.forEach(c => {
      const typeHe = CONSTRAINT_TYPE_HE[c.constraint_type] || c.constraint_type;
      html += `<div class="analysis-con-row">📌 ${typeHe} ${c.start_datetime.substring(0,10)} ${c.reason?'— '+c.reason:''}</div>`;
    });
  }

  container.innerHTML = html;
}

// ── Timeline panel ──
function showTimeline(empIdStr, dateStr) {
  const empId = parseInt(empIdStr);
  const emp   = state.employees.find(e => e.id === empId);
  if (!emp) return;
  const panel = document.getElementById("timeline-panel");
  panel.classList.add("active");
  const d = new Date((dateStr || formatDate(state.currentDay)) + "T00:00:00");
  const dName = DAYS_HE[d.getDay() === 0 ? 0 : d.getDay()];
  document.getElementById("timeline-title").textContent = `${emp.name} — ${dName} ${dateStr || formatDate(state.currentDay)}`;
  renderTimeline(empId, dateStr);
}

function renderTimeline(empId, dateStr) {
  const container = document.getElementById("timeline-content");
  if (!container) return;
  if (!empId) { container.innerHTML = ""; return; }

  const dateToUse = dateStr || formatDate(state.currentDay);
  const shifts = (state.shifts||[]).filter(s => s.employee_id === empId && s.shift_date === dateToUse);
  const cons   = (state.constraints||[]).filter(c =>
    c.employee_id === empId &&
    c.start_datetime.substring(0,10) <= dateToUse &&
    c.end_datetime.substring(0,10) >= dateToUse
  );

  // Show only 05:00–22:00 for readability
  const START_H = 5, END_H = 22;
  const VISIBLE_MIN = (END_H - START_H) * 60;
  const toY = min => Math.max(0, Math.min(100, (min - START_H*60) / VISIBLE_MIN * 100));
  const toH = (s,e) => Math.max(2, (Math.min(e, END_H*60) - Math.max(s, START_H*60)) / VISIBLE_MIN * 100);

  let html = `<div class="tl-axis">`;
  for (let h = START_H; h <= END_H; h += 2) {
    const pct = (h - START_H) / (END_H - START_H) * 100;
    html += `<div class="tl-tick" style="top:${pct.toFixed(1)}%"><span>${String(h).padStart(2,"0")}:00</span></div>`;
  }

  // Constraint blocks
  cons.forEach(c => {
    const cs = timeToMin(c.start_datetime.substring(11,16) || "00:00");
    const ce = timeToMin(c.end_datetime.substring(11,16) || "23:59");
    const typeHe = CONSTRAINT_TYPE_HE[c.constraint_type] || c.constraint_type;
    html += `<div class="tl-block tl-con" style="top:${toY(cs).toFixed(1)}%;height:${toH(cs,ce).toFixed(1)}%" title="${typeHe}">
      <span>${typeHe}${c.reason ? " — "+c.reason : ""}</span>
    </div>`;
  });

  // Shift blocks WITH prep/debrief
  shifts.forEach(s => {
    const sMin    = timeToMin(s.start_time);
    const eMin    = timeToMin(s.end_time);
    const _dur    = timeToMin(s.end_time) - timeToMin(s.start_time);
    const prepMin = _dur >= 120 ? 60 : (s.prep_minutes || 0);
    const recMin  = _dur >= 120 ? 60 : (s.recovery_minutes || 0);

    // Prep block (תדריך)
    if (prepMin > 0) {
      const ps = sMin - prepMin, pe = sMin;
      html += `<div class="tl-block tl-prep" style="top:${toY(ps).toFixed(1)}%;height:${toH(ps,pe).toFixed(1)}%">
        <span>תדריך (${prepMin} דק')</span>
      </div>`;
    }

    // Shift block
    html += `<div class="tl-block tl-shift" style="top:${toY(sMin).toFixed(1)}%;height:${toH(sMin,eMin).toFixed(1)}%;border-right:4px solid ${s.type_color};background:${s.type_color}22">
      <span style="color:${s.type_color};font-weight:700">${s.type_name}</span>
      <span style="font-size:0.7rem">${s.start_time}–${s.end_time}</span>
    </div>`;

    // Recovery block (תחקיר)
    if (recMin > 0) {
      const rs = eMin, re = eMin + recMin;
      html += `<div class="tl-block tl-rec" style="top:${toY(rs).toFixed(1)}%;height:${toH(rs,re).toFixed(1)}%">
        <span>תחקיר (${recMin} דק')</span>
      </div>`;
    }
  });

  html += `</div>`;
  container.innerHTML = html;
}

document.getElementById("timeline-close-btn").addEventListener("click", () => {
  document.getElementById("timeline-panel").classList.remove("active");
});

// ── Shift cell click opens timeline ──
function renderShiftCell(s) {
  const hasViolation = state._shiftViolations && state._shiftViolations[s.id];
  const empDisplay = s.emp_name
    ? `<div class="shift-emp">${s.emp_name}</div>`
    : `<div class="shift-emp shift-unassigned">לא מאויש</div>`;
  return `<div class="shift-cell ${hasViolation?'has-violation':''}" data-id="${s.id}"
    style="border-right-color:${s.type_color}"
    title="${s.type_name} | ${s.start_time}-${s.end_time}">
    <div class="shift-type" style="color:${s.type_color}">${s.type_name}</div>
    <div class="shift-time">${s.start_time} - ${s.end_time}</div>
    ${empDisplay}
  </div>`;
}

async function checkAllViolations() {
  const days = Array.from({ length: 7 }, (_, i) =>
    formatDate(addDays(getMonday(state.currentDay), i))
  );

  let allViolations = [];
  const shiftViolations = {};
  state._shiftViolations = {};

  for (const d of days) {
    try {
      const vs = await api(`/api/violations?date=${d}`);
      vs.forEach(v => {
        allViolations.push(v);
        if (v.shift_id) {
          if (!shiftViolations[v.shift_id]) shiftViolations[v.shift_id] = [];
          shiftViolations[v.shift_id].push(v);
        }
      });
    } catch (e) {}
  }

  // Mark cells
  document.querySelectorAll(".shift-cell").forEach(el => {
    const id = parseInt(el.dataset.id);
    if (shiftViolations[id]) {
      el.classList.add("has-violation");
      el.title = shiftViolations[id].map(v => v.message).join("\n");
    }
  });

  // Banner
  const banner = document.getElementById("violations-banner");
  if (allViolations.length > 0) {
    banner.classList.remove("hidden");
    const errors = allViolations.filter(v => v.severity === "error");
    const warnings = allViolations.filter(v => v.severity === "warning");
    let html = `<strong>⚠ נמצאו ${allViolations.length} חריגות:</strong><ul>`;
    allViolations.slice(0, 5).forEach(v => {
      html += `<li>${v.message}</li>`;
    });
    if (allViolations.length > 5) html += `<li>...ועוד ${allViolations.length - 5}</li>`;
    html += "</ul>";
    banner.innerHTML = html;
  } else {
    banner.classList.add("hidden");
  }

  // Check weekly workload alerts (client-side)
  checkWeeklyAlerts(allViolations);
}

function checkWeeklyAlerts(existingViolations) {
  const weekStr = formatDate(getMonday(state.currentDay));
  const days = Array.from({ length: 7 }, (_, i) => formatDate(addDays(getMonday(state.currentDay), i)));
  const alerts = [...existingViolations];

  state.employees.forEach(emp => {
    const empShifts = state.shifts.filter(s => s.employee_id === emp.id);

    // Alert 1: more than 10 shifts in a week
    if (empShifts.length > 10) {
      alerts.push({
        rule: "weekly_overload",
        severity: "warning",
        message: `${emp.name} - יותר מ-10 פעילויות בשבוע (${empShifts.length})`,
        shift_id: null
      });
    }

    // Alert 2: shift-unit overload per day
    // A shift ≥120min counts as 2 "shift units". Alert if units ≥ 3 AND any gap < 3h.
    days.forEach(dateStr => {
      const dayShifts = empShifts.filter(s => s.shift_date === dateStr)
        .sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));
      if (!dayShifts.length) return;

      // Count units: ≥120min = 2 units, else 1 unit
      const units = dayShifts.reduce((sum, s) => {
        const dur = timeToMin(s.end_time) - timeToMin(s.start_time);
        return sum + (dur >= 120 ? 2 : 1);
      }, 0);
      if (units < 3) return; // under threshold

      // Check if any two consecutive shifts have less than 3h gap
      let hasShortGap = false;
      for (let i = 0; i < dayShifts.length - 1; i++) {
        const gap = timeToMin(dayShifts[i+1].start_time) - timeToMin(dayShifts[i].end_time);
        if (gap < 180) { hasShortGap = true; break; }
      }
      if (hasShortGap) {
        const dayLabel = DAYS_HE[(new Date(dateStr + "T00:00:00")).getDay()];
        alerts.push({
          rule: "daily_overload",
          severity: "warning",
          message: `${emp.name} - עומס יום ${dayLabel}: ${units} יח' פעילות (פחות מ-3 שעות הפסקה)`,
          shift_id: null
        });
      }
    });

    // Alert 3: more than 3 shifts ending after 17:00 in the same week
    const lateShifts = empShifts.filter(s => timeToMin(s.end_time) > 17 * 60);
    if (lateShifts.length > 3) {
      const dates = [...new Set(lateShifts.map(s => {
        const d = new Date(s.shift_date + "T00:00:00");
        return DAYS_HE[d.getDay()];
      }))].join(", ");
      alerts.push({
        rule: "late_shift",
        severity: "warning",
        message: `${emp.name} - ${lateShifts.length} משמרות לאחר 17:00 בשבוע (${dates})`,
        shift_id: null
      });
    }
  });

  // Alert 4: constraint overlaps prep/recovery window
  days.forEach(dateStr => {
    state.employees.forEach(emp => {
      const dayShifts = (state.shifts||[]).filter(s => s.shift_date === dateStr && s.employee_id === emp.id);
      const empCons   = (state.constraints||[]).filter(c => {
        const cS = c.start_datetime.substring(0,10), cE = c.end_datetime.substring(0,10);
        return c.employee_id === emp.id && cS <= dateStr && cE >= dateStr;
      });
      if (!dayShifts.length || !empCons.length) return;

      dayShifts.forEach(s => {
        const dur_m   = timeToMin(s.end_time) - timeToMin(s.start_time);
        const prepMin = dur_m >= 120 ? 60 : (s.prep_minutes || 0);
        const recMin  = dur_m >= 120 ? 60 : (s.recovery_minutes || 0);
        const shiftStart = timeToMin(s.start_time);
        const shiftEnd   = timeToMin(s.end_time);
        const windowStart = shiftStart - prepMin;
        const windowEnd   = shiftEnd + recMin;

        empCons.forEach(c => {
          const hasT = c.start_datetime.length > 10 && c.start_datetime.substring(11,16).trim();
          const cS = hasT ? timeToMin(c.start_datetime.substring(11,16)) : 0;
          const cE = (c.end_datetime.length > 10 && c.end_datetime.substring(11,16).trim())
            ? timeToMin(c.end_datetime.substring(11,16)) : 24*60;
          const actualCE = cE === 0 ? 24*60 : cE;

          // Overlap with prep or recovery (but NOT the shift itself - that's already handled by server)
          const overlapPrep = prepMin > 0 && cS < shiftStart && actualCE > windowStart;
          const overlapRec  = recMin  > 0 && cS < windowEnd  && actualCE > shiftEnd;

          if (overlapPrep || overlapRec) {
            const typeHe = CONSTRAINT_TYPE_HE[c.constraint_type] || c.constraint_type;
            const what   = overlapPrep ? "תדריך" : "תחקיר";
            const alreadyExists = alerts.some(a =>
              a.rule === "prep_rec_constraint" && a.message.includes(emp.name) && a.message.includes(what)
            );
            if (!alreadyExists) {
              alerts.push({
                rule: "prep_rec_constraint",
                severity: "warning",
                message: `${emp.name} — אילוץ "${typeHe}" חופף לזמן ${what} של משמרת ${s.start_time}–${s.end_time}`,
                shift_id: s.id
              });
            }
          }
        });
      });
    });
  });

  // Update banner with all alerts (server violations + client weekly alerts)
  const banner = document.getElementById("violations-banner");
  const allAlerts = alerts;
  if (allAlerts.length > 0) {
    banner.classList.remove("hidden");
    let html = `<strong>⚠ נמצאו ${allAlerts.length} חריגות והתראות:</strong><ul>`;
    allAlerts.slice(0, 8).forEach(v => {
      const icon = v.severity === "warning" ? "🔶" : "🔴";
      html += `<li>${icon} ${v.message}</li>`;
    });
    if (allAlerts.length > 8) html += `<li>...ועוד ${allAlerts.length - 8}</li>`;
    html += "</ul>";
    banner.innerHTML = html;
  } else {
    banner.classList.add("hidden");
  }

  // Update matrix employee name warnings
  renderDailyMatrix();
}

// ─── WEEK NAV ───


document.getElementById("today-btn").addEventListener("click", () => {
  state.currentDay = new Date();
  loadDailySchedule();
});

// ─── SHIFT MODAL ───
document.getElementById("add-shift-btn").addEventListener("click", () => openAddShift());

function openAddShift(date = null, empId = null, hour = null) {
  state.editingShiftId = null;
  document.getElementById("shift-modal-title").textContent = "הוסף משמרת";
  document.getElementById("shift-date").value = date || formatDate(state.currentDay);
  // time inputs replaced by selects; use _setShiftTime / _getShiftTime helpers
  const startTime = hour || "08:00";
  _setShiftTime("shift-start", startTime);
  // Auto-calculate end time
  const firstType = state.shiftTypes[0];
  const [hh_, mm_] = startTime.split(":").map(Number);
  const endMin_ = firstType ? hh_ * 60 + mm_ + firstType.duration_minutes : hh_ * 60 + mm_ + 60;
  _setShiftTime("shift-end", `${String(Math.floor(endMin_/60)%24).padStart(2,"0")}:${String(endMin_%60).padStart(2,"0")}`);

  populateShiftBoardSelect(null, date || formatDate(state.currentDay));

  document.getElementById("shift-emp-select").value = empId || "";
  document.getElementById("shift-notes").value = "";
  document.getElementById("delete-shift-btn").classList.add("hidden");
  document.getElementById("shift-violations-preview").classList.add("hidden");
  document.getElementById("shift-violations-preview").innerHTML = "";
  openModal("modal-shift");
}

function populateShiftBoardSelect(selectedBoardId, dateStr) {
  const sel = document.getElementById("shift-board-select");
  if (!sel) return;
  const date   = dateStr || formatDate(state.currentDay);
  const boards = getBoardsForDay(date);
  sel.innerHTML = `<option value="">-- ללא שיוך ללוח --</option>` +
    boards.map(b =>
      `<option value="${b.id}" ${String(b.id) === String(selectedBoardId) ? "selected" : ""}>${b.name}</option>`
    ).join("");
}

function openEditShift(shiftId) {
  const s = state.shifts.find(x => x.id === shiftId);
  if (!s) return;
  state.editingShiftId = shiftId;
  document.getElementById("shift-modal-title").textContent = "עריכת משמרת";
  document.getElementById("shift-date").value = s.shift_date;
  const stSelEdit = document.getElementById("shift-type-select"); if (stSelEdit) stSelEdit.value = s.shift_type_id;
  _setShiftTime("shift-start", s.start_time);
  _setShiftTime("shift-end",   s.end_time);
  document.getElementById("shift-emp-select").value = s.employee_id || "";
  document.getElementById("shift-notes").value = s.notes || "";
  document.getElementById("delete-shift-btn").classList.remove("hidden");
  document.getElementById("shift-violations-preview").classList.add("hidden");
  // Pre-select board
  const existingBoard = (state.shiftBoardMap || {})[String(shiftId)];
  populateShiftBoardSelect(existingBoard, s.shift_date);
  openModal("modal-shift");
}

function toggleWorkloadBar() {
  const items = document.getElementById("workload-items");
  const chev  = document.getElementById("wl-chevron");
  if (!items) return;
  items.classList.toggle("hidden");
  if (chev) chev.textContent = items.classList.contains("hidden") ? "▾" : "▴";
}

document.getElementById("save-shift-btn").addEventListener("click", async () => {
  const boardSel = document.getElementById("shift-board-select");
  const selectedBoardId = boardSel && boardSel.value ? boardSel.value : null; // board ID is a string
  // Use first available shift type (type selection removed)
  const defaultShiftType = state.shiftTypes[0];
  const body = {
    shift_date: document.getElementById("shift-date").value,
    shift_type_id: defaultShiftType ? defaultShiftType.id : 1,
    start_time: _getShiftTime("shift-start"),
    end_time: _getShiftTime("shift-end"),
    employee_id: document.getElementById("shift-emp-select").value
      ? parseInt(document.getElementById("shift-emp-select").value) : null,
    notes: document.getElementById("shift-notes").value || null,
  };

  if (!body.shift_date) {
    showError("אנא מלא תאריך");
    return;
  }

  try {
    let result;
    if (state.editingShiftId) {
      result = await api(`/api/shifts/${state.editingShiftId}`, "PUT", body);
    } else {
      result = await api("/api/shifts", "POST", body);
    }

    const violations = result.violations || [];
    const vDiv = document.getElementById("shift-violations-preview");
    if (violations.length > 0) {
      vDiv.classList.remove("hidden");
      vDiv.innerHTML = violations.map(v => `<div class="violation-item">${v.message}</div>`).join("");
    } else {
      vDiv.classList.add("hidden");
    }

    // Store board assignment for this shift
    const assignedShiftId = result.id || state.editingShiftId;
    if (selectedBoardId && assignedShiftId) {
      if (!state.shiftBoardMap) state.shiftBoardMap = {};
      state.shiftBoardMap[String(assignedShiftId)] = String(selectedBoardId);
      fbSaveToStorage();
    }
    closeModal("modal-shift");
    state.allShifts = null; // force flightboard reload
    await loadDailySchedule();
    // Sync notes to fbSyllabusData after shifts are loaded
    const savedId = result.id || state.editingShiftId;
    if (savedId) _syncShiftNotesToFbSyllabus(savedId, body.notes);
    renderFlightBoard();
  } catch (e) {
    showError(e.message);
  }
});


document.getElementById("delete-shift-btn").addEventListener("click", async () => {
  if (!state.editingShiftId) return;
  if (!confirm("למחוק משמרת זו?")) return;
  try {
    // Before deleting: clear syllabus slots for this shift
    const shiftToDelete = (state.shifts||[]).find(s => s.id === state.editingShiftId);
    if (shiftToDelete) {
      const boardId = (state.shiftBoardMap||{})[String(state.editingShiftId)];
      if (boardId && state.fbSyllabusData && state.fbSyllabusData[boardId]) {
        const startMin = timeToMin(shiftToDelete.start_time);
        const endMin   = timeToMin(shiftToDelete.end_time);
        FB_ALL_HOURS.forEach(h => {
          const hm  = timeToMin(h);
          if (hm >= startMin && hm < endMin) {
            const key = `${shiftToDelete.shift_date}|${h}`;
            delete state.fbSyllabusData[boardId][key];
          }
        });
        fbSaveToStorage();
      }
    }
    await api(`/api/shifts/${state.editingShiftId}`, "DELETE");
    closeModal("modal-shift");
    await loadDailySchedule();
  } catch (e) {
    showError(e.message);
  }
});

function _getShiftTime(prefix) {
  // Read shift time from selects (shift-start-h/m or shift-end-h/m)
  const h = document.getElementById(prefix + "-h");
  const m = document.getElementById(prefix + "-m");
  if (h && m) return `${h.value.padStart(2,"0")}:${m.value.padStart(2,"0")}`;
  // Fallback to old input
  const inp = document.getElementById(prefix);
  return inp ? inp.value : "08:00";
}

function _setShiftTime(prefix, timeStr) {
  // Set shift time selects from "HH:MM" string
  if (!timeStr) return;
  const [hh, mm] = timeStr.split(":");
  const h = document.getElementById(prefix + "-h");
  const m = document.getElementById(prefix + "-m");
  if (h) {
    // Find best matching hour option
    const hVal = String(parseInt(hh)).padStart(2,"0");
    const hOpts = [...h.options].map(o => o.value);
    h.value = hOpts.includes(hVal) ? hVal : hOpts[hOpts.length-1];
  }
  if (m) {
    // Round to nearest 00 or 30
    const mInt = parseInt(mm||"0");
    m.value = mInt >= 30 ? "30" : "00";
  }
}

function _syncShiftNotesToFbSyllabus(shiftId, notes) {
  // Sync shift notes to fbSyllabusData so reports & flightboard are consistent
  const shift = (state.shifts || []).find(s => s.id === shiftId);
  if (!shift) return;
  const boardId = (state.shiftBoardMap || {})[String(shiftId)];
  if (!boardId) return;
  if (!state.fbSyllabusData[boardId]) state.fbSyllabusData[boardId] = {};
  const startMin = timeToMin(shift.start_time);
  const endMin   = timeToMin(shift.end_time);
  FB_ALL_HOURS.forEach(h => {
    const hm = timeToMin(h);
    if (hm >= startMin && hm < endMin) {
      const key = `${shift.shift_date}|${h}`;
      if (notes && notes.trim()) {
        state.fbSyllabusData[boardId][key] = notes.trim();
      } else {
        delete state.fbSyllabusData[boardId][key];
      }
    }
  });
  fbSaveToStorage();
}

function recalcShiftEnd() {
  const st = state.shiftTypes[0];
  if (!st) return;
  const startVal = _getShiftTime("shift-start");
  if (!startVal || startVal === ":") return;
  const [h, m] = startVal.split(":").map(Number);
  const totalMin = h * 60 + m + st.duration_minutes;
  _setShiftTime("shift-end", `${String(Math.floor(totalMin/60)%24).padStart(2,"0")}:${String(totalMin%60).padStart(2,"0")}`);
}
document.addEventListener("change", e => {
  if (e.target.id === "shift-start-h" || e.target.id === "shift-start-m") recalcShiftEnd();
});

// ─── WORKLOAD ───
async function loadWorkload() {
  const weekStart = getMonday(state.currentDay);
  const weekStr   = formatDate(weekStart);
  try {
    // Load workload summary AND full week shifts together
    const [wlData, weekShifts] = await Promise.all([
      api(`/api/reports/workload?week_start=${weekStr}`),
      api(`/api/shifts?week_start=${weekStr}`),
    ]);
    renderWorkloadCards(wlData, weekStart, weekShifts);
  } catch (e) { console.error("loadWorkload:", e); }
}

function renderWorkloadCards(data, weekStart, weekShifts) {
  const container = document.getElementById("workload-items");
  if (!data || !data.length) {
    container.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem">אין נתונים</span>`;
    return;
  }
  const weekEnd    = formatDate(addDays(weekStart, 6));
  const weekStr    = formatDate(weekStart);
  // Use freshly loaded weekShifts, fall back to state.shifts
  const allShifts  = weekShifts || state.shifts || [];

  container.innerHTML = data.filter(w => w.total_shifts > 0).map(w => {
    const empShifts = allShifts.filter(s =>
      s.employee_id === w.employee_id &&
      s.shift_date >= weekStr && s.shift_date <= weekEnd
    ).sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time));

    const shiftsHTML = empShifts.map(s => {
      const d       = new Date(s.shift_date + "T00:00:00");
      const dName   = DAYS_HE[d.getDay() === 0 ? 0 : d.getDay()];
      const color   = s.type_color || "#6366f1";
      return `<div class="wl-shift-row" onclick="jumpToShift('${s.shift_date}',${s.id})" title="קפוץ למשמרת">
        <span class="wl-day">${dName}</span>
        <span class="wl-badge" style="background:${color}33;color:${color};border:1px solid ${color}66">${s.type_name}</span>
        <span class="wl-time">${s.start_time}–${s.end_time}</span>
      </div>`;
    }).join("");

    const dot = { green: "#4ade80", yellow: "#fbbf24", red: "#f87171" }[w.color] || "#9ca3af";
    return `<div class="wl-card ${w.color}">
      <div class="wl-card-header" onclick="toggleWlCard(this)">
        <span class="wl-dot" style="background:${dot}"></span>
        <span class="wl-name">${w.employee_name}</span>
        <span class="wl-summary">${w.total_shifts} משמרות · ${w.total_hours}ש'</span>
        <span class="wl-chevron">▾</span>
      </div>
      <div class="wl-card-body hidden">
        ${shiftsHTML || '<span style="color:var(--text-muted);font-size:0.8rem">אין משמרות</span>'}
      </div>
    </div>`;
  }).join("") || `<span style="color:var(--text-muted);font-size:0.85rem">אין נתונים</span>`;
}

function toggleWlCard(header) {
  const body = header.nextElementSibling;
  body.classList.toggle("hidden");
  header.querySelector(".wl-chevron").textContent = body.classList.contains("hidden") ? "▾" : "▴";
}

function jumpToShift(dateStr, shiftId) {
  state.currentDay = new Date(dateStr + "T00:00:00");
  state.highlightedShiftId = shiftId;
  // Switch to schedule view
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const schedBtn = document.querySelector('[data-view="schedule"]');
  const schedView = document.getElementById("view-schedule");
  if (schedBtn) schedBtn.classList.add("active");
  if (schedView) schedView.classList.add("active");
  // Close workload panel
  const items = document.getElementById("workload-items");
  if (items) items.classList.add("hidden");
  loadDailySchedule().then(() => {
    // After loading, ensure shift is visible
    setTimeout(() => {
      const el = document.querySelector(".shift-highlighted");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 100);
  });
}

// ─── EMPLOYEES VIEW ───
async function loadEmployeesView() {
  await loadMeta();
  const tbody = document.getElementById("emp-body");

  // Group employees by affiliation
  const AFFILIATION_ORDER = ["קפ''ט", "מיל' אורגני", "מיל' דואלי", "מגמה א'", "מגמה ב'", "מגמה ג'", "מגמה ד'", ""];
  const grouped = {};
  state.employees.forEach(e => {
    const aff = e.affiliation || "";
    if (!grouped[aff]) grouped[aff] = [];
    grouped[aff].push(e);
  });

  const empRow = e => `
    <tr>
      <td>${e.name}</td>
      <td>${e.phone || "-"}</td>
      <td><span class="badge" style="background:${e.role_color}20;color:${e.role_color};border:1px solid ${e.role_color}40">${e.role_name}</span></td>
      <td>${e.affiliation || "-"}</td>
      <td>${e.always_present ? "✅" : "-"}</td>
      <td>${e.is_active ? "✅" : "❌"}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn" onclick="openEditEmp(${e.id})">עריכה</button>
          <button class="action-btn danger" onclick="deactivateEmp(${e.id})">הסר</button>
        </div>
      </td>
    </tr>`;

  let html = "";
  const sortedKeys = AFFILIATION_ORDER.filter(k => grouped[k] && grouped[k].length);
  // Add any keys not in AFFILIATION_ORDER
  Object.keys(grouped).forEach(k => { if (!AFFILIATION_ORDER.includes(k)) sortedKeys.push(k); });

  sortedKeys.forEach(aff => {
    const label = aff || "ללא שיוך";
    html += `<tr class="affiliation-group-header">
      <td colspan="7" style="padding:8px 14px;background:linear-gradient(90deg,rgba(59,130,246,0.15),rgba(99,102,241,0.07));border-top:2px solid rgba(59,130,246,0.35);">
        <span style="font-size:0.83rem;font-weight:700;color:#93c5fd;white-space:nowrap;display:inline;">🏷 ${label}</span>
        <span style="font-size:0.74rem;color:var(--text-muted);background:rgba(255,255,255,0.07);padding:1px 8px;border-radius:10px;margin-right:8px;display:inline;">${grouped[aff].length} מפעילים</span>
      </td>
    </tr>`;
    html += grouped[aff].map(empRow).join("");
  });

  tbody.innerHTML = html;
}

const CONSTRAINT_TYPE_HE = {
  absence: 'הצ"ח',
  vacation: "חופשה",
  unavailable: 'הצ"ח',
  preferred: "משמרת מועדפת",
};



document.getElementById("add-emp-btn").addEventListener("click", () => openAddEmp());

function openAddEmp() {
  state.editingEmpId = null;
  document.getElementById("emp-modal-title").textContent = "הוסף מפעיל";
  document.getElementById("emp-name").value = "";
  document.getElementById("emp-phone").value = "";
  document.getElementById("emp-role-select").selectedIndex = 0;
  document.getElementById("emp-always-present").checked = false;
  const affEl = document.getElementById("emp-affiliation"); if (affEl) affEl.value = "";
  document.getElementById("emp-notes").value = "";
  openModal("modal-emp");
}

function openEditEmp(empId) {
  const e = state.employees.find(x => x.id === empId);
  if (!e) return;
  state.editingEmpId = empId;
  document.getElementById("emp-modal-title").textContent = "עריכת מפעיל";
  document.getElementById("emp-name").value = e.name;
  document.getElementById("emp-phone").value = e.phone || "";
  document.getElementById("emp-role-select").value = e.role_id;
  document.getElementById("emp-always-present").checked = !!e.always_present;
  const affEl = document.getElementById("emp-affiliation"); if (affEl) affEl.value = e.affiliation || "";
  document.getElementById("emp-notes").value = e.notes || "";
  openModal("modal-emp");
}

document.getElementById("save-emp-btn").addEventListener("click", async () => {
  const affEl = document.getElementById("emp-affiliation");
  const body = {
    name: document.getElementById("emp-name").value.trim(),
    phone: document.getElementById("emp-phone").value.trim() || null,
    role_id: parseInt(document.getElementById("emp-role-select").value),
    always_present: document.getElementById("emp-always-present").checked,
    affiliation: affEl ? (affEl.value || null) : null,
    notes: document.getElementById("emp-notes").value.trim() || null,
  };
  if (!body.name) { showError("אנא הזן שם מפעיל"); return; }
  try {
    if (state.editingEmpId) {
      await api(`/api/employees/${state.editingEmpId}`, "PUT", body);
    } else {
      await api("/api/employees", "POST", body);
    }
    closeModal("modal-emp");
    await loadMeta();
    await loadEmployeesView();
  } catch (e) { showError(e.message); }
});

async function deactivateEmp(empId) {
  const e = state.employees.find(x => x.id === empId);
  if (!confirm(`להסיר את ${e?.name} מהמערכת?`)) return;
  try {
    await api(`/api/employees/${empId}`, "DELETE");
    await loadMeta();
    await loadEmployeesView();
  } catch (e) { showError(e.message); }
}

// ─── CONSTRAINTS ───
// ─── CELL CONTEXT MENU (right-click on matrix cell) ───
let _cellMenuCleanup = null;

function showCellMenu(event, dateStr, empId, hour) {
  // Remove existing menu
  hideCellMenu();

  const menu = document.createElement("div");
  menu.id = "cell-ctx-menu";
  menu.innerHTML = `
    <div class="cell-menu-item" onclick="hideCellMenu();openAddShift('${dateStr}','${empId}','${hour}')">
      ✈ הוסף משמרת
    </div>
    <div class="cell-menu-item con-item" onclick="hideCellMenu();openConstraintFor('${empId}','${dateStr}','${hour}')">
      📌 הוסף אילוץ
    </div>`;
  menu.style.cssText = `
    position:fixed; z-index:9999;
    top:${event.clientY}px; left:${event.clientX}px;
    background:var(--surface2); border:1px solid var(--border);
    border-radius:10px; overflow:hidden; min-width:150px;
    box-shadow:0 8px 24px rgba(0,0,0,0.5);
    direction:rtl;
  `;
  document.body.appendChild(menu);

  // Close on click outside
  setTimeout(() => {
    _cellMenuCleanup = (e) => { if (!menu.contains(e.target)) hideCellMenu(); };
    document.addEventListener("click", _cellMenuCleanup);
    document.addEventListener("keydown", e => { if(e.key==="Escape") hideCellMenu(); }, {once:true});
  }, 10);
}

function hideCellMenu() {
  const m = document.getElementById("cell-ctx-menu");
  if (m) m.remove();
  if (_cellMenuCleanup) { document.removeEventListener("click", _cellMenuCleanup); _cellMenuCleanup = null; }
}

function _setConTime(dateStr, startH, startM, endH, endM) {
  const pad = n => String(n).padStart(2,"0");
  const now = new Date();
  const d = dateStr || `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  document.getElementById("con-date").value  = d;
  const sh = document.getElementById("con-start-h");
  const sm = document.getElementById("con-start-m");
  const eh = document.getElementById("con-end-h");
  const em = document.getElementById("con-end-m");
  if (sh) sh.value = startH !== undefined ? pad(startH) : "08";
  if (sm) sm.value = startM !== undefined ? pad(startM) : "00";
  if (eh) eh.value = endH   !== undefined ? pad(endH)   : "20";
  if (em) em.value = endM   !== undefined ? pad(endM)   : "00";
}

function _getConDatetime() {
  const d  = document.getElementById("con-date").value;
  const sh = document.getElementById("con-start-h").value;
  const sm = document.getElementById("con-start-m").value;
  const eh = document.getElementById("con-end-h").value;
  const em = document.getElementById("con-end-m").value;
  if (!d) return { start: null, end: null };
  const start = sh ? `${d} ${sh}:${sm||"00"}:00` : `${d} 00:00:00`;
  const end   = eh ? `${d} ${eh}:${em||"00"}:00` : `${d} 23:59:00`;
  return { start, end };
}

function openConstraintFor(empId, dateStr, hour) {
  state.editingConId = null;
  const titleEl = document.getElementById("con-modal-title");
  if (titleEl) titleEl.textContent = "הוסף אילוץ";
  const delBtn = document.getElementById("delete-con-btn");
  if (delBtn) delBtn.classList.add("hidden");

  const empSel = document.getElementById("con-emp-select");
  if (empId) empSel.value = empId;

  if (dateStr && hour) {
    const startH = parseInt(hour.split(":")[0]);
    _setConTime(dateStr, startH, 0, Math.min(startH+8,23), 0);
  } else {
    _setConTime(null, 8, 0, 20, 0);
  }
  document.getElementById("con-type").value = "absence";
  document.getElementById("con-reason").value = "";
  openModal("modal-constraint");
}

function openEditConstraint(conId) {
  const con = (state.constraints||[]).find(c => c.id === conId);
  if (!con) return;
  state.editingConId = conId;

  const titleEl = document.getElementById("con-modal-title");
  if (titleEl) titleEl.textContent = "עריכת אילוץ";
  const delBtn = document.getElementById("delete-con-btn");
  if (delBtn) delBtn.classList.remove("hidden");

  document.getElementById("con-emp-select").value = con.employee_id;

  const parseDate = s => s ? s.substring(0,10) : "";
  const parseH    = s => s && s.length > 10 ? parseInt(s.substring(11,13)) : null;
  const parseM    = s => s && s.length > 10 ? parseInt(s.substring(14,16)||"0") : 0;
  _setConTime(parseDate(con.start_datetime),
    parseH(con.start_datetime), parseM(con.start_datetime),
    parseH(con.end_datetime),   parseM(con.end_datetime));

  document.getElementById("con-type").value   = con.constraint_type;
  document.getElementById("con-reason").value = con.reason || "";
  openModal("modal-constraint");
}

document.getElementById("save-con-btn").addEventListener("click", async () => {
  const { start: conStart, end: conEnd } = _getConDatetime();
  if (!conStart) { showError("אנא בחר תאריך"); return; }
  const body = {
    employee_id: parseInt(document.getElementById("con-emp-select").value),
    start_datetime: conStart,
    end_datetime:   conEnd,
    constraint_type: document.getElementById("con-type").value,
    reason: document.getElementById("con-reason").value.trim() || null,
  };
  try {
    if (state.editingConId) {
      await api(`/api/constraints/${state.editingConId}`, "PUT", body);
    } else {
      await api("/api/constraints", "POST", body);
    }
    state.editingConId = null;
    closeModal("modal-constraint");
    await loadDailySchedule();
  } catch (e) { showError(e.message); }
});

document.getElementById("delete-con-btn").addEventListener("click", async () => {
  if (!state.editingConId) return;
  if (!confirm("למחוק אילוץ זה?")) return;
  try {
    await api(`/api/constraints/${state.editingConId}`, "DELETE");
    state.editingConId = null;
    closeModal("modal-constraint");
    await loadDailySchedule();
  } catch (e) { showError(e.message); }
});

// ─── REPORTS ───

function getShiftSyllabus(shift) {
  // 1. Prefer shift notes (entered in matrix "הערות" field)
  if (shift.notes && shift.notes.trim()) return shift.notes.trim();
  // 2. Look up syllabus column from flightboard storage
  const dateStr = shift.shift_date;
  const hour    = shift.start_time.substring(0, 5); // "HH:MM"
  const key     = `${dateStr}|${hour}`;
  for (const boardId of Object.keys(state.fbSyllabusData || {})) {
    const val = state.fbSyllabusData[boardId][key];
    if (val && val.trim()) return val.trim();
  }
  // 3. Fallback to shift type name
  return shift.type_name || "—";
}

function renderSyllabusChart(weekShifts) {
  const container = document.getElementById("rpt-syllabus-chart");
  if (!container) return;
  const shifts = weekShifts.filter(s => s.employee_id);
  if (!shifts.length) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem">אין נתונים</p>`;
    return;
  }

  // Aggregate: syllabusType → { hours, count }
  const byType = {};
  shifts.forEach(s => {
    const syl = getShiftSyllabus(s);
    const h   = (timeToMin(s.end_time) - timeToMin(s.start_time)) / 60;
    if (!byType[syl]) byType[syl] = { hours: 0, count: 0 };
    byType[syl].hours += h;
    byType[syl].count++;
  });

  const types    = Object.keys(byType).sort();
  const maxHours = Math.max(...types.map(t => byType[t].hours), 1);
  const BAR_COLORS = ["#3b82f6","#22c55e","#a855f7","#f97316","#ec4899","#06b6d4","#eab308","#ef4444"];

  // SVG bar chart
  const chartH = 160, chartW = Math.max(types.length * 72, 320), padL = 40, padB = 48, padT = 16;
  const plotW = chartW - padL - 8;
  const plotH = chartH - padB - padT;
  const barW  = Math.min(48, plotW / types.length - 8);

  let svgBars = "", svgLabels = "", svgYAxis = "";

  // Y axis ticks
  for (let i = 0; i <= 4; i++) {
    const val = (maxHours * i / 4).toFixed(1);
    const y   = padT + plotH - (plotH * i / 4);
    svgYAxis += `<line x1="${padL-4}" y1="${y}" x2="${padL+plotW}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
    svgYAxis += `<text x="${padL-8}" y="${y+4}" text-anchor="end" fill="#9ca3af" font-size="10">${val}ש'</text>`;
  }

  types.forEach((t, i) => {
    const d     = byType[t];
    const x     = padL + i * (plotW / types.length) + (plotW / types.length - barW) / 2;
    const bh    = (d.hours / maxHours) * plotH;
    const y     = padT + plotH - bh;
    const color = BAR_COLORS[i % BAR_COLORS.length];

    svgBars   += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(bh,2).toFixed(1)}"
      rx="4" fill="${color}" opacity="0.85">
      <title>${t}: ${d.hours.toFixed(1)} שעות, ${d.count} טיסות</title>
    </rect>`;
    svgBars   += `<text x="${(x+barW/2).toFixed(1)}" y="${(y-5).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="11" font-weight="700">${d.hours.toFixed(1)}</text>`;

    // X label - wrap long names
    const labelY = padT + plotH + 14;
    const _words = t.split(" ");
    let _l1 = "", _l2 = "";
    _words.forEach(w => {
      if (!_l1 || (_l1 + " " + w).length <= 10) _l1 = _l1 ? _l1 + " " + w : w;
      else if (!_l2 || (_l2 + " " + w).length <= 10) _l2 = _l2 ? _l2 + " " + w : w;
    });
    svgLabels += `<text x="${(x+barW/2).toFixed(1)}" y="${labelY}" text-anchor="middle" fill="#9ca3af" font-size="10">${_l1}</text>`;
    if (_l2) svgLabels += `<text x="${(x+barW/2).toFixed(1)}" y="${labelY+12}" text-anchor="middle" fill="#9ca3af" font-size="10">${_l2}</text>`;
    if (t.length > 8) {
      svgLabels += `<title>${t}</title>`;
    }
  });

  container.innerHTML = `
    <div style="direction:rtl;margin-bottom:8px;font-weight:700;font-size:0.84rem;color:var(--text)">שעות טיסה לפי סוג סילבוס</div>
    <div style="overflow-x:auto">
      <svg width="${chartW}" height="${chartH}" style="display:block">
        ${svgYAxis}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>
        <line x1="${padL}" y1="${padT+plotH}" x2="${padL+plotW}" y2="${padT+plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>
        ${svgBars}
        ${svgLabels}
      </svg>
    </div>`;
}

async function loadReports() {
  const reportWeekStr = formatDate(state.reportWeek);
  updateReportWeekLabel();

  const [countData, workloadData, weekShifts] = await Promise.all([
    api(`/api/reports/shift-count?week_start=${reportWeekStr}`),
    api(`/api/reports/workload?week_start=${reportWeekStr}`),
    api(`/api/shifts?week_start=${reportWeekStr}`),
  ]);

  state._reportWeekShifts = weekShifts || [];
  renderShiftCountReport(countData, weekShifts);
  renderWorkloadReport(workloadData);
  renderSyllabusChart(weekShifts || []);
}

function updateReportWeekLabel() {
  const end = addDays(state.reportWeek, 6);
  document.getElementById("rpt-week-label").textContent =
    `${formatDateDisplay(state.reportWeek)} - ${formatDateDisplay(end)}`;
}

function renderShiftCountReport(data, weekShifts) {
  const container = document.getElementById("rpt-shift-count");
  if (!data.length) { container.innerHTML = `<p style="color:var(--text-muted)">אין נתונים</p>`; return; }

  // Build syllabus-based counts from weekShifts
  const shifts = weekShifts || state._reportWeekShifts || [];
  if (shifts.length) {
    // Group by emp_name and syllabus
    const bySyllabus = {};
    shifts.filter(s => s.employee_id).forEach(s => {
      const empRow = data.find(d => d.emp_name && s.emp_name === d.emp_name) ||
        { emp_name: s.emp_name };
      const syl = getShiftSyllabus(s);
      const empName = s.emp_name || "לא מאויש";
      if (!bySyllabus[empName]) bySyllabus[empName] = {};
      bySyllabus[empName][syl] = (bySyllabus[empName][syl] || 0) + 1;
    });

    const empNames  = Object.keys(bySyllabus).sort();
    const syllabusTypes = [...new Set(Object.values(bySyllabus).flatMap(e => Object.keys(e)))].sort();

    let html = `<table class="rpt-table"><thead><tr><th>מפעיל</th>`;
    syllabusTypes.forEach(t => { html += `<th>${t}</th>`; });
    html += `<th>סה"כ</th></tr></thead><tbody>`;
    empNames.forEach(emp => {
      let total = 0;
      html += `<tr><td>${emp}</td>`;
      syllabusTypes.forEach(t => {
        const cnt = bySyllabus[emp][t] || 0;
        total += cnt;
        html += `<td style="text-align:center">${cnt || "-"}</td>`;
      });
      html += `<td style="text-align:center;font-weight:700">${total}</td></tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
    return;
  }

  // Fallback: use server data
  const empNames = [...new Set(data.map(r => r.emp_name))];
  const typeNames = [...new Set(data.map(r => r.type_name))];
  let html = `<table class="rpt-table"><thead><tr><th>מפעיל</th>`;
  typeNames.forEach(t => { html += `<th>${t}</th>`; });
  html += `<th>סה"כ</th></tr></thead><tbody>`;
  empNames.forEach(emp => {
    const empData = data.filter(r => r.emp_name === emp);
    let total = 0;
    html += `<tr><td>${emp}</td>`;
    typeNames.forEach(t => {
      const rec = empData.find(r => r.type_name === t);
      const cnt = rec ? rec.count : 0;
      total += cnt;
      html += `<td style="text-align:center">${cnt || "-"}</td>`;
    });
    html += `<td style="text-align:center;font-weight:700">${total}</td></tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}

function computeWorkloadColor(empShifts, weekDays, managers, empName) {
  // Count total hours (in units where 1h = 1 unit)
  const totalMin = empShifts.reduce((sum, s) => {
    return sum + Math.max(0, timeToMin(s.end_time) - timeToMin(s.start_time));
  }, 0);
  const totalHours = totalMin / 60;

  // Count late shifts (end > 17:00)
  const lateShifts = empShifts.filter(s => timeToMin(s.end_time) > 17 * 60).length;

  // Count management days (where emp is מנהל יום/לילה/מנל"ח in managers table)
  const name = empName || empShifts[0]?.emp_name || "";
  let mgmtCount = 0;
  if (name) {
    weekDays.forEach(d => {
      const m = managers[d] || {};
      if (m.day === name || m.night === name || m.manlach === name) mgmtCount++;
    });
  }

  // Count days with 3+ shifts
  const byDay = {};
  empShifts.forEach(s => {
    byDay[s.shift_date] = (byDay[s.shift_date] || 0) + 1;
  });
  const days3plus = Object.values(byDay).filter(c => c >= 3).length;

  // ─── RULES ───
  // 🔴 לא סביר (red):
  //   - ≥3 משמרות לאחר 17:00 בשבוע
  //   - ≥2 ימים עם 3+ משמרות
  if (lateShifts >= 3 || days3plus >= 2) return "red";

  // 🟡 מאתגר (yellow):
  //   - ≥2 משמרות לאחר 17:00
  //   - ≥2 ניהול (יום/לילה/מנל"ח)
  //   - יום אחד עם 3+ משמרות
  if (lateShifts >= 2 || mgmtCount >= 2 || days3plus >= 1) return "yellow";

  // 🟢 תקין (green):
  //   - עד 10 שעות שבועיות + ניהול פעם בשבוע = OK
  return "green";
}

function renderWorkloadReport(data) {
  const container = document.getElementById("rpt-workload");
  const weekStr   = formatDate(state.reportWeek || getMonday(state.currentDay));
  const weekDays  = Array.from({length:7}, (_,i) => formatDate(addDays(new Date(weekStr+"T00:00:00"), i)));
  const shifts    = state._reportWeekShifts || [];

  // Build per-employee data client-side for accurate rules
  const byEmp = {};
  shifts.filter(s => s.employee_id && s.emp_name).forEach(s => {
    if (!byEmp[s.emp_name]) byEmp[s.emp_name] = [];
    byEmp[s.emp_name].push(s);
  });
  // Add employees with no shifts (from server data)
  data.forEach(w => {
    if (!byEmp[w.employee_name]) byEmp[w.employee_name] = [];
  });

  const COLORS = { green: "#86efac", yellow: "#fde68a", red: "#fca5a5" };
  const BG = { green: "rgba(22,163,74,0.1)", yellow: "rgba(202,138,4,0.12)", red: "rgba(220,38,38,0.12)" };
  const ICONS  = { green: "✅ תקין", yellow: "⚠ מאתגר", red: "🔴 לא סביר" };

  const empNames = [...new Set([...Object.keys(byEmp), ...data.map(w => w.employee_name)])].sort();
  if (!empNames.length) { container.innerHTML = `<p style="color:var(--text-muted)">אין נתונים</p>`; return; }

  let html = `<table class="rpt-table"><thead><tr>
    <th>מפעיל</th><th>שעות</th><th>משמרות</th><th>ערב</th><th>ניהול</th><th>3+ ביום</th><th>עומס</th>
  </tr></thead><tbody>`;

  empNames.forEach(empName => {
    const empShifts = byEmp[empName] || [];
    const color = computeWorkloadColor(empShifts, weekDays, state.managers || {}, empName);
    const totalMin = empShifts.reduce((s,sh) => s + Math.max(0, timeToMin(sh.end_time)-timeToMin(sh.start_time)), 0);
    const totalH   = (totalMin/60).toFixed(1);
    const lateN    = empShifts.filter(s => timeToMin(s.end_time) > 17*60).length;
    const mgmtN    = weekDays.filter(d => {
      const m = (state.managers||{})[d] || {};
      return m.day === empName || m.night === empName || m.manlach === empName;
    }).length;
    const byDay = {};
    empShifts.forEach(s => { byDay[s.shift_date] = (byDay[s.shift_date]||0)+1; });
    const days3 = Object.values(byDay).filter(c => c >= 3).length;

    html += `<tr style="background:${BG[color]}">
      <td style="white-space:nowrap">${empName}</td>
      <td style="text-align:center">${totalH}</td>
      <td style="text-align:center">${empShifts.length}</td>
      <td style="text-align:center">${lateN}</td>
      <td style="text-align:center">${mgmtN}</td>
      <td style="text-align:center">${days3}</td>
      <td style="text-align:center;color:${COLORS[color]};font-weight:700">${ICONS[color]}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// Report week nav
document.getElementById("rpt-prev-week").addEventListener("click", () => {
  state.reportWeek = addDays(state.reportWeek, -7);
  loadReports();
});
document.getElementById("rpt-next-week").addEventListener("click", () => {
  state.reportWeek = addDays(state.reportWeek, 7);
  loadReports();
});

document.getElementById("hist-load-btn").addEventListener("click", async () => {
  const empId = document.getElementById("hist-emp-select").value;
  const container = document.getElementById("rpt-history");
  if (!empId) { container.innerHTML = ""; return; }
  container.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem">טוען...</span>`;
  try {
    const data = await api(`/api/reports/history/${empId}`);
    if (!data || !data.length) {
      container.innerHTML = `<p style="color:var(--text-muted)">אין היסטוריה למפעיל זה</p>`;
      return;
    }
    renderHistoryChart(data, container);
  } catch(e) {
    container.innerHTML = `<p style="color:#f87171">שגיאה בטעינה</p>`;
  }
});

function renderHistoryChart(data, container) {
  // Aggregate by shift type for X/Y chart (X=type, Y=hours)
  const byType = {};
  data.forEach(s => {
    // Use notes (syllabus) if available, fallback to type_name
    const t = (s.notes && s.notes.trim()) ? s.notes.trim() : (s.type_name || "—");
    const h = (timeToMin(s.end_time) - timeToMin(s.start_time)) / 60;
    if (!byType[t]) byType[t] = { hours: 0, count: 0, color: s.type_color || "#6366f1" };
    byType[t].hours += h;
    byType[t].count++;
  });

  const types    = Object.keys(byType);
  const maxHours = Math.max(...types.map(t => byType[t].hours), 1);
  const BAR_COLORS = ["#3b82f6","#22c55e","#a855f7","#f97316","#ec4899","#06b6d4","#eab308","#ef4444"];

  const chartH = 160, padL = 40, padB = 48, padT = 16;
  const chartW = Math.max(types.length * 80, 300);
  const plotW  = chartW - padL - 8;
  const plotH  = chartH - padB - padT;
  const barW   = Math.min(52, plotW / Math.max(types.length, 1) - 10);

  let svgBars = "", svgLabels = "", svgGrid = "";
  for (let i = 0; i <= 4; i++) {
    const val = (maxHours * i / 4).toFixed(1);
    const y   = padT + plotH - (plotH * i / 4);
    svgGrid += `<line x1="${padL-4}" y1="${y}" x2="${padL+plotW}" y2="${y}" stroke="rgba(255,255,255,0.07)"/>`;
    svgGrid += `<text x="${padL-8}" y="${y+4}" text-anchor="end" fill="#9ca3af" font-size="10">${val}ש'</text>`;
  }

  types.forEach((t, i) => {
    const d     = byType[t];
    const bh    = Math.max((d.hours / maxHours) * plotH, 2);
    const x     = padL + i * (plotW / types.length) + (plotW / types.length - barW) / 2;
    const y     = padT + plotH - bh;
    const color = BAR_COLORS[i % BAR_COLORS.length];
    svgBars   += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" rx="4" fill="${color}" opacity="0.85">
      <title>${t}: ${d.hours.toFixed(1)} שעות, ${d.count} משמרות</title></rect>`;
    svgBars   += `<text x="${(x+barW/2).toFixed(1)}" y="${(y-5).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="11" font-weight="700">${d.hours.toFixed(1)}</text>`;
    // Multi-line label: split by space, max 2 lines of 8 chars
    const words = t.split(" ");
    let line1 = "", line2 = "";
    words.forEach(w => {
      if (!line1 || (line1 + " " + w).length <= 10) line1 = line1 ? line1 + " " + w : w;
      else if (!line2 || (line2 + " " + w).length <= 10) line2 = line2 ? line2 + " " + w : w;
    });
    const ly1 = padT + plotH + 14;
    const ly2 = padT + plotH + 26;
    svgLabels += `<text x="${(x+barW/2).toFixed(1)}" y="${ly1}" text-anchor="middle" fill="#9ca3af" font-size="10">${line1}</text>`;
    if (line2) svgLabels += `<text x="${(x+barW/2).toFixed(1)}" y="${ly2}" text-anchor="middle" fill="#9ca3af" font-size="10">${line2}</text>`;
  });

  // Recent 10 shifts table
  let tableRows = "";
  data.slice(0, 10).forEach(s => {
    const dur = ((timeToMin(s.end_time) - timeToMin(s.start_time)) / 60).toFixed(1);
    const [yy,mm,dd] = s.shift_date.split("-");
    tableRows += `<tr>
      <td>${dd}/${mm}/${yy}</td>
      <td>${s.start_time}–${s.end_time} <span style="color:var(--text-muted);font-size:0.78rem">(${dur}ש')</span></td>
      <td><span style="color:${s.type_color}">${(s.notes && s.notes.trim()) ? s.notes.trim() : s.type_name}</span></td>
    </tr>`;
  });

  container.innerHTML = `
  <div style="direction:rtl">
    <div style="font-weight:700;font-size:0.84rem;margin-bottom:10px;color:var(--text)">📊 שעות לפי סוג משמרת</div>
    <div style="overflow-x:auto;margin-bottom:20px">
      <svg width="${chartW}" height="${chartH}" style="display:block">
        ${svgGrid}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>
        <line x1="${padL}" y1="${padT+plotH}" x2="${padL+plotW}" y2="${padT+plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>
        ${svgBars}${svgLabels}
      </svg>
    </div>
    <div style="font-weight:700;font-size:0.85rem;margin-bottom:8px;color:var(--text)">10 משמרות אחרונות</div>
    <table class="rpt-table"><thead><tr><th>תאריך</th><th>שעות</th><th>סוג</th></tr></thead>
    <tbody>${tableRows}</tbody></table>
  </div>`;
}

// ─── SETTINGS ───
async function loadSettings() {
  await loadMeta();
  renderColorRules();

  // Roles
  const rolesTbody = document.getElementById("roles-body");
  rolesTbody.innerHTML = state.roles.map(r => `
    <tr id="role-row-${r.id}">
      <td><input class="inline-edit" value="${r.name}" id="role-name-${r.id}" /></td>
      <td style="text-align:center">
        <button class="fb-toggle-btn ${r.can_fly ? 'on' : 'off'}" id="role-fly-${r.id}"
          onclick="cycleRoleToggle(${r.id},'can_fly',this)">
          ${r.can_fly ? "✈ כן" : "✗ לא"}
        </button>
      </td>
      <td style="text-align:center">
        <button class="fb-toggle-btn ${r.is_management ? 'on' : 'off'}" id="role-mgmt-${r.id}"
          onclick="cycleRoleToggle(${r.id},'is_management',this)">
          ${r.is_management ? "👔 כן" : "✗ לא"}
        </button>
      </td>
      <td><input type="color" class="color-pick-inline" value="${r.color}" id="role-color-${r.id}" /></td>
      <td>
        <button class="btn-primary btn-sm" onclick="saveRoleRow(${r.id})">💾 שמור</button>
      </td>
    </tr>
  `).join("");

  // Shift types table removed from settings UI
}


// Role state: track local edits before saving
const _roleEdits = {};

function cycleRoleToggle(id, field, btn) {
  if (!_roleEdits[id]) _roleEdits[id] = {};
  const current = _roleEdits[id][field] !== undefined
    ? _roleEdits[id][field]
    : !!(state.roles.find(r=>r.id===id)||{})[field];
  const next = !current;
  _roleEdits[id][field] = next;
  if (field === "can_fly") {
    btn.textContent = next ? "✈ כן" : "✗ לא";
    btn.className   = `fb-toggle-btn ${next ? "on" : "off"}`;
  } else {
    btn.textContent = next ? "👔 כן" : "✗ לא";
    btn.className   = `fb-toggle-btn ${next ? "on" : "off"}`;
  }
}

function saveRoleRow(id) {
  const nameEl  = document.getElementById(`role-name-${id}`);
  const colorEl = document.getElementById(`role-color-${id}`);
  const flyBtn  = document.getElementById(`role-fly-${id}`);
  const mgmtBtn = document.getElementById(`role-mgmt-${id}`);
  if (!nameEl) return;

  const edits = _roleEdits[id] || {};
  const role  = state.roles.find(r => r.id === id) || {};
  const body  = {
    name:          nameEl.value.trim(),
    color:         colorEl ? colorEl.value : role.color,
    can_fly:       edits.can_fly       !== undefined ? edits.can_fly       : !!role.can_fly,
    is_management: edits.is_management !== undefined ? edits.is_management : !!role.is_management,
  };

  api(`/api/roles/${id}`, "PUT", body)
    .then(() => {
      delete _roleEdits[id];
      showSuccess(`דרג "${body.name}" עודכן`);
      loadSettings();
    })
    .catch(e => showError(e.message));
}

document.getElementById("add-role-btn").addEventListener("click", () => {
  const name = prompt("שם הדרג:");
  if (!name) return;
  const canFly = confirm("האם דרג זה יכול לטוס?");
  const isMgmt = confirm("האם זהו דרג ניהולי?");
  const color = prompt("צבע (hex):", "#3B82F6") || "#3B82F6";
  api("/api/roles", "POST", { name, can_fly: canFly, is_management: isMgmt, color })
    .then(() => loadSettings()).catch(e => showError(e.message));
});

// add-shift-type-btn removed from UI - shift types managed in DB

// reset-shift-types removed

// ─── WHATSAPP ───
function generateWAMessages(weekShifts, weekStartStr) {
  const DAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const results = [];
  const empMap = {};
  (state.employees||[]).forEach(e => { if (e.phone) empMap[e.id] = e; });

  // Group shifts by employee
  const byEmp = {};
  (weekShifts||[]).forEach(s => {
    if (!s.employee_id || !empMap[s.employee_id]) return;
    if (!byEmp[s.employee_id]) byEmp[s.employee_id] = [];
    byEmp[s.employee_id].push(s);
  });

  Object.entries(byEmp).forEach(([empId, shifts]) => {
    const emp = empMap[parseInt(empId)];
    if (!shifts.length) return;
    shifts.sort((a,b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time));

    const lines = [`שלום ${emp.name},\nלוז משמרות לשבוע ${weekStartStr}:\n`];
    shifts.forEach(s => {
      const d = new Date(s.shift_date + "T00:00:00");
      const dayName = DAYS_HE[(d.getDay()+1)%7] || DAYS_HE[d.getDay()];
      // Use shift notes from matrix if available, fallback to type_name
      const shiftLabel = (s.notes && s.notes.trim()) ? s.notes.trim() : (s.type_name || "—");
      const [yy,mm,dd] = s.shift_date.split("-");
      lines.push(`• ${dayName} ${dd}/${mm}/${yy} | ${s.start_time}–${s.end_time} | ${shiftLabel}`);
    });

    const message = lines.join("\n");
    let phone = emp.phone.replace(/[-+ ]/g,"");
    if (phone.startsWith("0")) phone = "972" + phone.substring(1);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    results.push({ employee_name: emp.name, phone: emp.phone, message, wa_url: url });
  });
  return results;
}

document.getElementById("send-wa-btn").addEventListener("click", async () => {
  const weekStr = formatDate(getMonday(state.currentDay));
  try {
    // Generate WA messages client-side to include matrix notes/syllabus
    const weekShiftsForWA = await api(`/api/shifts?week_start=${weekStr}`);
    const data = generateWAMessages(weekShiftsForWA, weekStr);
    state.waLinks = data;

    const container = document.getElementById("wa-list");
    if (!data.length) {
      container.innerHTML = `<p style="padding:16px;color:var(--text-muted)">לא נמצאו מפעילים עם טלפון + משמרות</p>`;
    } else {
      container.innerHTML = data.map((w, i) => `
        <div class="wa-item">
          <div class="wa-name">${w.employee_name} - ${w.phone}</div>
          <div class="wa-msg">${w.message}</div>
          <button class="wa-open-btn" onclick="window.open('${w.wa_url}','_blank')">📱 פתח בוואטסאפ</button>
        </div>
      `).join("");
    }
    openModal("modal-wa");
  } catch (e) { showError(e.message); }
});

document.getElementById("open-all-wa-btn").addEventListener("click", () => {
  state.waLinks.forEach((w, i) => {
    setTimeout(() => window.open(w.wa_url, "_blank"), i * 800);
  });
});

// ─── START ───
init();
// ─── FLIGHT BOARD ───
// State: state.fbBoards = [ { id, name, startHour, endHour }, ... ]
// State: state.fbData = { boardId: { "YYYY-MM-DD|HH:MM": "empName" } }


const FB_BOARD_COLORS = [
  { bg: "#1e3a5f", border: "#3b82f6", label: "#60a5fa" }, // כחול
  { bg: "#1e3f2a", border: "#22c55e", label: "#4ade80" }, // ירוק
  { bg: "#4a1c2f", border: "#ec4899", label: "#f472b6" }, // ורוד
  { bg: "#2a1e4a", border: "#8b5cf6", label: "#a78bfa" }, // סגול
  { bg: "#4a2e1e", border: "#f97316", label: "#fb923c" }, // כתום
  { bg: "#1e3f3f", border: "#06b6d4", label: "#22d3ee" }, // ציאן
  { bg: "#3f3a1e", border: "#eab308", label: "#facc15" }, // צהוב
];
function getFbBoardColor(idx) {
  return FB_BOARD_COLORS[idx % FB_BOARD_COLORS.length];
}

const FB_ALL_HOURS = [
  "06:00","07:00","08:00","09:00","10:00","11:00","12:00",
  "13:00","14:00","15:00","16:00","17:00","18:00","19:00",
  "20:00","21:00","22:00"
];
const FB_DAYS_HE = ["ראשון","שני","שלישי","רביעי","חמישי","שישי"];

function fbLoadFromStorage() {
  try {
    const d  = localStorage.getItem("fb_data");
    const cd = localStorage.getItem("fb_cadet_data");
    const fd = localStorage.getItem("fb_day");
    if (d)  state.fbData      = JSON.parse(d);
    if (cd) state.fbCadetData   = JSON.parse(cd);
    const sd = localStorage.getItem("fb_syllabus_data");
    const ad = localStorage.getItem("fb_amlach_data");
    if (sd) state.fbSyllabusData = JSON.parse(sd);
    if (ad) state.fbAmlachData   = JSON.parse(ad);
    const rm  = localStorage.getItem("fb_room_data");
    const trm = localStorage.getItem("fb_trend_data");
    const nm  = localStorage.getItem("fb_notes_data");
    if (rm)  state.fbRoomData  = JSON.parse(rm);
    if (trm) state.fbTrendData = JSON.parse(trm);
    if (nm)  state.fbNotesData = JSON.parse(nm);
    const sbm = localStorage.getItem("shift_board_map");
    if (sbm) state.shiftBoardMap = JSON.parse(sbm);
    const crls = localStorage.getItem("color_rules");
    if (crls) state.colorRules = JSON.parse(crls);
    if (fd) { const p = new Date(fd + "T00:00:00"); if (!isNaN(p)) state.fbDay = p; }
  } catch(e) {}
  if (!state.fbData)      state.fbData = {};
  if (!state.fbCadetData)   state.fbCadetData = {};
  if (!state.fbSyllabusData) state.fbSyllabusData = {};
  if (!state.fbAmlachData)   state.fbAmlachData = {};
  if (!state.shiftBoardMap)  state.shiftBoardMap = {};
  if (!state.colorRules)     state.colorRules = [];
  if (!state.fbRoomData)     state.fbRoomData = {};
  if (!state.fbTrendData)    state.fbTrendData = {};
  if (!state.fbNotesData)    state.fbNotesData = {};
  // fbBoards are loaded per-day dynamically
}

function fbBoardsKey(dateStr) { return `fb_boards_${dateStr}`; }

function getBoardsForDay(dateStr) {
  try {
    const raw = localStorage.getItem(fbBoardsKey(dateStr));
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return [{ id: `${dateStr}_1`, name: "לוח טיסות 1", startHour: "08:00", endHour: "18:00", date: dateStr }];
}

function saveBoardsForDay(dateStr, boards) {
  localStorage.setItem(fbBoardsKey(dateStr), JSON.stringify(boards));
}

function fbSaveToStorage() {
  localStorage.setItem("fb_data",          JSON.stringify(state.fbData));
  localStorage.setItem("fb_cadet_data",    JSON.stringify(state.fbCadetData));
  localStorage.setItem("fb_syllabus_data", JSON.stringify(state.fbSyllabusData || {}));
  localStorage.setItem("fb_amlach_data",   JSON.stringify(state.fbAmlachData   || {}));
  localStorage.setItem("fb_room_data",     JSON.stringify(state.fbRoomData     || {}));
  localStorage.setItem("fb_trend_data",    JSON.stringify(state.fbTrendData    || {}));
  localStorage.setItem("fb_notes_data",    JSON.stringify(state.fbNotesData    || {}));
  localStorage.setItem("fb_day",           formatDate(state.fbDay));
  localStorage.setItem("shift_board_map",  JSON.stringify(state.shiftBoardMap  || {}));
  localStorage.setItem("color_rules",      JSON.stringify(state.colorRules     || []));
}

function fbHoursRange(startHour, endHour) {
  // Returns array of hour strings from startHour up to (not including) endHour
  const startIdx = FB_ALL_HOURS.indexOf(startHour);
  const endIdx   = FB_ALL_HOURS.indexOf(endHour);
  if (startIdx < 0 || endIdx <= startIdx) return FB_ALL_HOURS.slice(0, -1);
  return FB_ALL_HOURS.slice(startIdx, endIdx);
}

// ── Build data from matrix shifts so they appear in flight board ──
function getFbDataFromMatrix(boardId) {
  const board = state.fbBoards.find(b => b.id === boardId);
  if (!board) return {};
  const merged = Object.assign({}, state.fbData[boardId] || {});

  // Use allShifts (flightboard week) when available, else state.shifts
  const shiftsToUse = state.allShifts || state.shifts || [];
  shiftsToUse.forEach(s => {
      if (!s.emp_name) return;
      const startMin = timeToMin(s.start_time);
      const endMin   = timeToMin(s.end_time);
      // For each hour slot covered by this shift, add emp_name
      const hours = fbHoursRange(board.startHour, board.endHour);
      hours.forEach(h => {
        const hMin = timeToMin(h);
        if (hMin >= startMin && hMin < endMin) {
          const key = `${s.shift_date}|${h}`;
          // Matrix data takes precedence, don't overwrite manually set data
          if (!merged[key]) merged[key] = s.emp_name;
        }
      });
  });
  return merged;
}

// ── Week helpers ──
function fbFormatWeekLabel(d) {
  return `${formatDateDisplay(d)} – ${formatDateDisplay(addDays(d, 5))}`;
}
function updateFbWeekLabel() {
  document.getElementById("fb-week-label").textContent = fbFormatWeekLabel(state.flightboardWeek);
}

// ── Render all boards ──
function getWordColor(text) {
  if (!text || !state.colorRules || !state.colorRules.length) return null;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  for (const rule of state.colorRules) {
    for (const word of (rule.words || [])) {
      if (word && t.includes(word.trim().toLowerCase())) return rule.color;
    }
  }
  return null;
}

function renderColorRules() {
  const container = document.getElementById("color-rules-list");
  if (!container) return;
  if (!state.colorRules || !state.colorRules.length) {
    container.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);font-size:0.85rem;padding:10px;text-align:center">אין חוקי צבע</td></tr>`;
    return;
  }
  container.innerHTML = state.colorRules.map((rule, i) => `
    <tr>
      <td style="width:56px;text-align:center">
        <span style="display:inline-block;width:28px;height:28px;border-radius:6px;background:${rule.color};border:2px solid ${rule.color}88;vertical-align:middle"></span>
      </td>
      <td>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${(rule.words||[]).map(w => `<span class="word-tag" style="background:${rule.color}22;border:1px solid ${rule.color}66;color:${rule.color}">${w}</span>`).join("")}
        </div>
      </td>
      <td style="width:60px;text-align:center">
        <button class="btn-danger btn-xs" onclick="deleteColorRule(${i})">🗑</button>
      </td>
    </tr>
  `).join("");
}

function deleteColorRule(idx) {
  state.colorRules.splice(idx, 1);
  fbSaveToStorage();
  renderColorRules();
  renderFlightBoard();
}

function addColorRule() {
  const wordsEl = document.getElementById("new-color-words");
  const colorEl = document.getElementById("new-color-pick");
  if (!wordsEl || !colorEl) return;
  const raw   = wordsEl.value.trim();
  const color = colorEl.value;
  if (!raw) return;
  const words = raw.split(",").map(w => w.trim()).filter(Boolean);
  if (!words.length) return;
  if (!state.colorRules) state.colorRules = [];
  state.colorRules.push({ words, color });
  fbSaveToStorage();
  wordsEl.value = "";
  renderColorRules();
  renderFlightBoard();
}

async function renderFlightBoard() {
  const dateStr = formatDate(state.fbDay);

  // Load shifts for this day's week
  try {
    const weekStr = formatDate(getMonday(state.fbDay));
    state.allShifts = await api(`/api/shifts?week_start=${weekStr}`);
  } catch(e) {}

  // Load boards for this specific day
  state.fbBoards = getBoardsForDay(dateStr);

  updateFbDayLabel();
  const container = document.getElementById("fb-boards-container");
  if (!container) return;

  // Build instructor map from matrix: hour -> emp_name (from actual shifts)
  // Key: empId -> shifts for this day
  const dayShifts = (state.allShifts||[]).filter(s => s.shift_date === dateStr && s.employee_id);

  let html = "";
  state.fbBoards.forEach(board => {
    const hours     = fbHoursRange(board.startHour, board.endHour);
    const bid = String(board.id); // always use string key to match shiftBoardMap
    const cadetData    = (state.fbCadetData[bid]    || state.fbCadetData[board.id]    || {});
    const syllabusData = (state.fbSyllabusData[bid] || state.fbSyllabusData[board.id] || {});
    const amlachData   = (state.fbAmlachData[bid]   || state.fbAmlachData[board.id]   || {});
    const roomData     = (state.fbRoomData[bid]     || state.fbRoomData[board.id]     || {});
    const trendData    = (state.fbTrendData[bid]    || state.fbTrendData[board.id]    || {});
    const notesData    = (state.fbNotesData[bid]    || state.fbNotesData[board.id]    || {});

    let rowsHTML = "";
    hours.forEach(hour => {
      const nextHour  = FB_ALL_HOURS[FB_ALL_HOURS.indexOf(hour) + 1] || "";
      const slotLabel = nextHour ? `${hour}–${nextHour}` : hour;
      const key       = `${dateStr}|${hour}`;
      const hMin      = timeToMin(hour);

      // Only show shifts assigned to this board, or unassigned to first board
      const boardDayShifts = dayShifts.filter(s => {
        const assignedBoard = (state.shiftBoardMap || {})[String(s.id)];
        if (assignedBoard) return String(assignedBoard) === String(board.id);
        // Unassigned shifts → show only in first board
        return state.fbBoards.indexOf(board) === 0;
      });
      const matchShift = boardDayShifts.find(s =>
        hMin >= timeToMin(s.start_time) && hMin < timeToMin(s.end_time)
      );
      const operVal     = matchShift ? (matchShift.emp_name || "") : "";
      const cadetVal    = cadetData[key]   || "";
      const syllabusVal = syllabusData[key] || "";
      const amlachVal   = amlachData[key]   || "";
      const roomVal     = roomData[key]     || "";
      const trendVal    = trendData[key]    || "";
      const notesVal    = notesData[key]    || "";
      const violation   = operVal ? checkFbSlotViolationDaily(board.id, dateStr, hour, operVal) : null;

      // Apply color rules to instructor and all editable cells
      const instrColor  = getWordColor(operVal);
      const cadetColor  = getWordColor(cadetVal);
      const syllabusColor = getWordColor(syllabusVal);
      const amlachColor = getWordColor(amlachVal);
      const roomColor   = getWordColor(roomVal);
      const trendColor  = getWordColor(trendVal);
      const notesColor  = getWordColor(notesVal);

      rowsHTML += `<tr>
        <td class="col-hour">${slotLabel}</td>
        <td class="${violation ? "fb-violation-cell" : "fb-readonly-cell"}" ${violation ? `title="${violation}"` : ""}
          ${instrColor ? `style="background:${instrColor}22;border-right:3px solid ${instrColor}"` : ""}>
          <span class="fb-readonly-val" ${instrColor ? `style="color:${instrColor}"` : ""}>${operVal || '<span class="fb-empty">—</span>'}</span>
          ${violation ? `<div class="fb-violation-hint">⚠ ${violation}</div>` : ""}
        </td>
        <td ${cadetColor ? `style="background:${cadetColor}22"` : ""}><input class="fb-input" type="text" value="${cadetVal}"    placeholder="—" data-board="${bid}" data-key="${key}" data-col="cadet"    oninput="onFbColInput(this)" /></td>
        <td ${roomColor   ? `style="background:${roomColor}22"` : ""}><input class="fb-input" type="text" value="${roomVal}"     placeholder="—" data-board="${bid}" data-key="${key}" data-col="room"     oninput="onFbColInput(this)" /></td>
        <td ${trendColor  ? `style="background:${trendColor}22"` : ""}><input class="fb-input" type="text" value="${trendVal}"   placeholder="—" data-board="${bid}" data-key="${key}" data-col="trend"    oninput="onFbColInput(this)" /></td>
        <td ${syllabusColor ? `style="background:${syllabusColor}22"` : ""}><input class="fb-input" type="text" value="${syllabusVal}" placeholder="—" data-board="${bid}" data-key="${key}" data-col="syllabus" oninput="onFbColInput(this)" /></td>
        <td ${amlachColor ? `style="background:${amlachColor}22"` : ""}><input class="fb-input" type="text" value="${amlachVal}"   placeholder="—" data-board="${bid}" data-key="${key}" data-col="amlach"   oninput="onFbColInput(this)" /></td>
        <td ${notesColor  ? `style="background:${notesColor}22"` : ""}><input class="fb-input fb-notes-input" type="text" value="${notesVal}"    placeholder="—" data-board="${bid}" data-key="${key}" data-col="notes"    oninput="onFbColInput(this)" /></td>
      </tr>`;
    });

    const bIdx = state.fbBoards.indexOf(board);
    const bColor = getFbBoardColor(bIdx);
    html += `
    <div class="fb-board" data-board-id="${board.id}" style="border-color:${bColor.border}40">
      <div class="fb-board-header" style="background:${bColor.bg};border-bottom-color:${bColor.border}40">
        <span class="fb-board-title" style="color:${bColor.label}">✈ ${board.name}</span>
        <span class="fb-board-hours" style="color:${bColor.label}88">${board.startHour} – ${board.endHour}</span>
        <button class="btn-secondary fb-edit-board-btn" data-id="${board.id}">✏ ערוך</button>
      </div>
      <div class="fb-table-wrap">
        <table class="flightboard-table">
          <thead><tr>
            <th class="col-hour">שעה</th>
            <th class="fb-col-instr">מדריך</th>
            <th class="fb-col-edit">חניך</th>
            <th class="fb-col-edit">חדר ת"ת</th>
            <th class="fb-col-edit">מגמה</th>
            <th class="fb-col-edit">סוג סילבוס</th>
            <th class="fb-col-edit">אמל"ח</th>
            <th class="fb-col-notes">הערות</th>
          </tr></thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>
    </div>`;
  });

  container.innerHTML = html;
  container.querySelectorAll(".fb-edit-board-btn").forEach(btn => {
    btn.addEventListener("click", () => openFbBoardModal(btn.dataset.id));
  });

  renderManagersTableDaily(state.flightboardWeek);
  renderFbViolationsBanner();
}

function getFbDataFromMatrixDaily(boardId, dateStr) {
  const board = state.fbBoards.find(b => b.id === boardId);
  if (!board) return {};
  const merged = Object.assign({}, (state.fbData[boardId]||{}));
  (state.allShifts||[]).forEach(s => {
    if (!s.emp_name || s.shift_date !== dateStr) return;
    fbHoursRange(board.startHour, board.endHour).forEach(h => {
      const hMin = timeToMin(h);
      if (hMin >= timeToMin(s.start_time) && hMin < timeToMin(s.end_time)) {
        const key = `${dateStr}|${h}`;
        if (!merged[key]) merged[key] = s.emp_name;
      }
    });
  });
  return merged;
}

function checkFbSlotViolationDaily(boardId, dateStr, hour, empName) {
  if (!empName) return null;
  empName = empName.trim();
  const emp = (state.employees||[]).find(e => e.name.trim() === empName);
  if (!emp) return null;

  const slotStart = timeToMin(hour);
  const slotEnd   = slotStart + 60;

  // 1. Constraint overlap check
  for (const c of (state.constraints||[])) {
    if (c.employee_id !== emp.id) continue;
    // Parse date range
    const cDateStr = c.start_datetime.substring(0,10);
    const cEndStr  = c.end_datetime.substring(0,10);
    if (cDateStr > dateStr || cEndStr < dateStr) continue;

    // Parse time - handle both "YYYY-MM-DD HH:MM" and "YYYY-MM-DD" (full day)
    let cS, cE;
    if (c.start_datetime.length > 10 && c.start_datetime.substring(11,16).trim()) {
      cS = timeToMin(c.start_datetime.substring(11,16));
    } else {
      cS = 0; // full day start
    }
    if (c.end_datetime.length > 10 && c.end_datetime.substring(11,16).trim()) {
      cE = timeToMin(c.end_datetime.substring(11,16));
      if (cE === 0) cE = 24 * 60; // midnight = end of day
    } else {
      cE = 24 * 60; // full day end
    }

    // For multi-day constraints, if this is not the start/end day use full day range
    if (cDateStr < dateStr) cS = 0;
    if (cEndStr  > dateStr) cE = 24 * 60;

    if (slotStart < cE && slotEnd > cS) {
      return `${empName} — ${CONSTRAINT_TYPE_HE[c.constraint_type]||c.constraint_type}`;
    }
  }

  // 2. Shift-vs-shift overlap on same date (double-booking across boards)
  const empShiftsToday = (state.allShifts||[]).filter(s =>
    s.shift_date === dateStr && s.employee_id === emp.id
  );
  // Count overlapping shifts for this slot
  const overlapping = empShiftsToday.filter(s =>
    slotStart < timeToMin(s.end_time) && slotEnd > timeToMin(s.start_time)
  );
  if (overlapping.length > 1) {
    return `${empName} — כפל משמרות באותה שעה`;
  }

  return null;
}

function onFbCadetInput(el) { onFbColInput(el); } // legacy

function onFbColInput(el) {
  // live color update when colorRules exist
  if (state.colorRules && state.colorRules.length) {
    clearTimeout(el._colorDebounce);
    el._colorDebounce = setTimeout(() => renderFlightBoard(), 700);
  }
  // if syllabus column changed and reports view is active, refresh chart
  if (el.dataset.col === "syllabus") {
    clearTimeout(window._syllabusChartTimer);
    window._syllabusChartTimer = setTimeout(() => {
      const reportsActive = document.getElementById("view-reports")?.classList.contains("active");
      if (reportsActive && state._reportWeekShifts) {
        renderSyllabusChart(state._reportWeekShifts);
        renderShiftCountReport([], state._reportWeekShifts);
      }
    }, 800);
  }
  const boardId = el.dataset.board; // keep as string (day-scoped IDs)
  const key     = el.dataset.key;
  const col     = el.dataset.col || "cadet";
  const storeMap = {
    cadet:    "fbCadetData",
    syllabus: "fbSyllabusData",
    amlach:   "fbAmlachData",
    room:     "fbRoomData",
    trend:    "fbTrendData",
    notes:    "fbNotesData",
  };
  const storeName = storeMap[col] || "fbCadetData";
  if (!state[storeName][boardId]) state[storeName][boardId] = {};
  state[storeName][boardId][key] = el.value.trim();
  fbSaveToStorage();

  // If syllabus column changed → also update matching shift notes in DB
  if (col === "syllabus") {
    const [dateStr, hour] = key.split("|");
    const hMin = timeToMin(hour);
    const matchShift = (state.allShifts || state.shifts || []).find(s =>
      s.shift_date === dateStr &&
      hMin >= timeToMin(s.start_time) && hMin < timeToMin(s.end_time)
    );
    if (matchShift && matchShift.id) {
      clearTimeout(window._syllabusShiftTimer);
      window._syllabusShiftTimer = setTimeout(() => {
        api(`/api/shifts/${matchShift.id}`, "PUT", { notes: el.value.trim() || null })
          .then(() => {
            // Update local shift object too
            matchShift.notes = el.value.trim() || null;
          }).catch(() => {});
      }, 600);
    }
  }
}

function updateFbDayLabel() {
  const el = document.getElementById("fb-week-label");
  if (el) el.textContent = `${DAYS_HE[state.fbDay.getDay()===0?0:state.fbDay.getDay()]} ${formatDateDisplay(state.fbDay)}`;
}


function onFbInput(el) {
  const boardId = parseInt(el.dataset.board);
  const key     = el.dataset.key;
  if (!state.fbData[boardId]) state.fbData[boardId] = {};
  state.fbData[boardId][key] = el.value.trim();
  fbSaveToStorage();
  // Debounced re-render to update violations
  clearTimeout(window._fbRenderTimer);
  window._fbRenderTimer = setTimeout(() => {
    renderFlightBoard();
    const inputs = document.querySelectorAll(`.fb-input[data-board="${boardId}"][data-key="${key}"]`);
    if (inputs[0]) { inputs[0].focus(); const len = inputs[0].value.length; inputs[0].setSelectionRange(len, len); }
  }, 300);
}

// ── Violations ──
function checkFbSlotViolation(boardId, dateStr, hour, empName, mergedData) {
  if (!empName) return null;
  empName = empName.trim();
  const emp = state.employees && state.employees.find(e => e.name.trim() === empName);
  if (!emp) return null;

  const slotStart = timeToMin(hour);
  const slotEnd   = slotStart + 60;
  const weekStr   = formatDate(state.flightboardWeek);
  const weekEnd   = formatDate(addDays(state.flightboardWeek, 5));

  // Constraint overlap
  if (state.constraints) {
    for (const c of state.constraints) {
      if (c.employee_id !== emp.id) continue;
      const cDate = c.start_datetime.substring(0, 10);
      const cEndDate = c.end_datetime.substring(0, 10);
      if (cDate > dateStr || cEndDate < dateStr) continue;
      const cS = timeToMin(c.start_datetime.substring(11, 16) || "00:00");
      const cE = timeToMin(c.end_datetime.substring(11, 16) || "23:59");
      if (slotStart < cE && slotEnd > cS) {
        return `${empName} - ${CONSTRAINT_TYPE_HE[c.constraint_type] || c.constraint_type}`;
      }
    }
  }

  // Collect all slots for this emp this week across all boards
  const allKeys = [];
  state.fbBoards.forEach(b => {
    const data = getFbDataFromMatrix(b.id);
    Object.keys(data).forEach(k => {
      const [kDate] = k.split("|");
      if (kDate >= weekStr && kDate <= weekEnd && (data[k]||"").trim() === empName) allKeys.push(k);
    });
  });

  const weekCount = allKeys.length;
  if (weekCount > 10) return `${empName} - יותר מ-10 פעילויות בשבוע (${weekCount})`;

  const dayCount = allKeys.filter(k => k.startsWith(dateStr)).length;
  // dayCount alert handled elsewhere with gap check

  const lateCount = allKeys.filter(k => { const [,h] = k.split("|"); return timeToMin(h) >= 17*60; }).length;
  if (lateCount >= 3) return `${empName} - ${lateCount} משמרות אחרי 17:00`;

  return null;
}

function renderFbViolationsBanner() {
  const banner = document.getElementById("fb-violations-banner");
  if (!banner) return;
  const violations = new Set();
  const weekStr = formatDate(state.flightboardWeek);
  const weekEnd = formatDate(addDays(state.flightboardWeek, 5));

  state.fbBoards.forEach(board => {
    const merged = getFbDataFromMatrix(board.id);
    Object.keys(merged).forEach(key => {
      const [dateStr, hour] = key.split("|");
      if (dateStr < weekStr || dateStr > weekEnd) return;
      const v = checkFbSlotViolation(board.id, dateStr, hour, merged[key], merged);
      if (v) violations.add(v);
    });
  });

  if (violations.size > 0) {
    banner.classList.remove("hidden");
    let html = `<strong>⚠ ${violations.size} חריגות בלוח טיסות:</strong><ul>`;
    [...violations].slice(0, 10).forEach(v => { html += `<li>🔶 ${v}</li>`; });
    if (violations.size > 10) html += `<li>ועוד ${violations.size - 10}...</li>`;
    html += "</ul>";
    banner.innerHTML = html;
  } else {
    banner.classList.add("hidden");
  }
}

// ── Add/Edit Board Modal ──
let _fbEditingBoardId = null;

function populateFbHourSelects() {
  ["fb-board-start","fb-board-end"].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = FB_ALL_HOURS.map(h => `<option value="${h}">${h}</option>`).join("");
  });
}

function openFbBoardModal(boardId) {
  const dateStr = formatDate(state.fbDay);
  const boards  = getBoardsForDay(dateStr);
  populateFbHourSelects();
  const deleteBtn = document.getElementById("fb-board-delete-btn");
  if (boardId) {
    _fbEditingBoardId = boardId;
    const board = boards.find(b => b.id == boardId);
    document.getElementById("fb-board-modal-title").textContent = "ערוך לוח טיסות";
    document.getElementById("fb-board-name").value  = board ? board.name : "";
    document.getElementById("fb-board-start").value = board ? board.startHour : "08:00";
    document.getElementById("fb-board-end").value   = board ? board.endHour : "18:00";
    deleteBtn.classList.remove("hidden");
  } else {
    _fbEditingBoardId = null;
    document.getElementById("fb-board-modal-title").textContent = "הוסף לוח טיסות";
    document.getElementById("fb-board-name").value  = `לוח טיסות ${boards.length + 1}`;
    document.getElementById("fb-board-start").value = "08:00";
    document.getElementById("fb-board-end").value   = "18:00";
    deleteBtn.classList.add("hidden");
  }
  openModal("modal-fb-board");
}

document.getElementById("fb-board-save-btn").addEventListener("click", () => {
  const name  = document.getElementById("fb-board-name").value.trim() || "לוח טיסות";
  const start = document.getElementById("fb-board-start").value;
  const end   = document.getElementById("fb-board-end").value;
  if (start >= end) { alert("שעת ההתחלה חייבת להיות לפני שעת הסיום"); return; }

  const dateStr = formatDate(state.fbDay);
  const boards  = getBoardsForDay(dateStr);
  if (_fbEditingBoardId) {
    const board = boards.find(b => b.id == _fbEditingBoardId);
    if (board) { board.name = name; board.startHour = start; board.endHour = end; }
  } else {
    const newId = `${dateStr}_${Date.now()}`;
    boards.push({ id: newId, name, startHour: start, endHour: end, date: dateStr });
  }
  saveBoardsForDay(dateStr, boards);
  fbSaveToStorage();
  closeModal("modal-fb-board");
  renderFlightBoard();
});

document.getElementById("fb-board-delete-btn").addEventListener("click", () => {
  const dateStr = formatDate(state.fbDay);
  const boards  = getBoardsForDay(dateStr);
  if (!_fbEditingBoardId || boards.length <= 1) {
    alert("לא ניתן למחוק את הלוח האחרון"); return;
  }
  if (!confirm("למחוק לוח זה?")) return;
  const updated = boards.filter(b => b.id != _fbEditingBoardId);
  saveBoardsForDay(dateStr, updated);
  delete state.fbCadetData[_fbEditingBoardId];
  fbSaveToStorage();
  closeModal("modal-fb-board");
  renderFlightBoard();
});

document.getElementById("fb-add-board-btn").addEventListener("click", () => openFbBoardModal(null));

// ── Daily matrix navigation ──
document.getElementById("prev-day").addEventListener("click", () => {
  state.currentDay = addDays(state.currentDay, -1);
  loadDailySchedule();
});
document.getElementById("next-day").addEventListener("click", () => {
  state.currentDay = addDays(state.currentDay, 1);
  loadDailySchedule();
});
document.getElementById("today-btn").addEventListener("click", () => {
  state.currentDay = new Date();
  loadDailySchedule();
});

// ── Week analysis panel ──
document.getElementById("week-analysis-btn").addEventListener("click", () => {
  const panel = document.getElementById("week-analysis-panel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) renderWeekAnalysis();
});
document.getElementById("week-analysis-close").addEventListener("click", () => {
  document.getElementById("week-analysis-panel").classList.add("hidden");
});

// ── Timeline close ──
document.getElementById("timeline-close-btn").addEventListener("click", () => {
  document.getElementById("timeline-panel").classList.remove("active");
});

// ── Navigation ──
document.getElementById("fb-prev-week").addEventListener("click", () => {
  state.fbDay = addDays(state.fbDay, -1);
  state.flightboardWeek = getMonday(state.fbDay);
  fbSaveToStorage();
  renderFlightBoard();
  renderManagersTableDaily();
});
document.getElementById("fb-next-week").addEventListener("click", () => {
  state.fbDay = addDays(state.fbDay, 1);
  state.flightboardWeek = getMonday(state.fbDay);
  fbSaveToStorage();
  renderFlightBoard();
  renderManagersTableDaily();
});


// ── Excel export for tracking report ──
async function exportTrackingExcel() {
  const reportWeekStr = formatDate(state.reportWeek);
  const data = await api(`/api/reports/shift-count?week_start=${reportWeekStr}`);
  if (!data.length) { alert("אין נתונים לייצוא"); return; }

  const empNames  = [...new Set(data.map(r => r.emp_name))];
  const typeNames = [...new Set(data.map(r => r.type_name))];

  // Build CSV
  const header = ["מפעיל", ...typeNames, 'סה"כ שעות'].join(",");
  const rows = empNames.map(emp => {
    const empData = data.filter(r => r.emp_name === emp);
    let totalHours = 0;
    const cols = typeNames.map(t => {
      const rec = empData.find(r => r.type_name === t);
      const cnt = rec ? rec.count : 0;
      // Estimate hours: type duration from shiftTypes
      const st = state.shiftTypes.find(s => s.name === t);
      const h = cnt * ((st ? st.duration_minutes : 60) / 60);
      totalHours += h;
      return h.toFixed(1);
    });
    return [emp, ...cols, totalHours.toFixed(1)].join(",");
  });

  const csv = "\uFEFF" + [header, ...rows].join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `מעקב_${reportWeekStr}.csv`; a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("fb-today-btn").addEventListener("click", () => {
  state.fbDay = new Date();
  state.flightboardWeek = getMonday(new Date());
  fbSaveToStorage();
  renderFlightBoard();
  renderManagersTableDaily();
});

// ══════════════════════════════════════════════════════════
// REMOTE REGISTRATION MODULE
// ══════════════════════════════════════════════════════════

const AFFILIATION_ORDER_RR = ["קפ''ט", "מיל' אורגני", "מיל' דואלי", "מגמה א'", "מגמה ב'", "מגמה ג'", "מגמה ד'"];
const DAYS_HE_RR = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function openRemoteRegModal() {
  // Populate week start (current week Sunday)
  const monday = getMonday(state.currentDay);
  // find sunday = monday - 1
  const sunday = addDays(monday, -1);
  const weekStart = formatDate(sunday);
  const rrWeek = document.getElementById("rr-week-start");
  if (rrWeek) rrWeek.value = weekStart;

  // Populate day select
  const daySel = document.getElementById("rr-day-select");
  if (daySel) {
    daySel.innerHTML = '<option value="">-- בחר יום --</option>';
    for (let i = 0; i < 7; i++) {
      const d = addDays(new Date(weekStart + "T00:00:00"), i);
      const [yy,mm,dd] = formatDate(d).split("-");
      const dayLabel = DAYS_HE_RR[(d.getDay() + 1) % 7 === 0 ? 6 : (d.getDay() + 1) % 7];
      // Actually: getDay() 0=Sun,1=Mon...6=Sat. We want Sun=ראשון
      const heDay = DAYS_HE_RR[d.getDay()];
      daySel.innerHTML += `<option value="${formatDate(d)}">${heDay} ${dd}/${mm}/${yy}</option>`;
    }
  }

  // Populate affiliation select
  const affilSel = document.getElementById("rr-affil-select");
  if (affilSel) {
    affilSel.innerHTML = '<option value="">-- כל המפעילים --</option>';
    AFFILIATION_ORDER_RR.forEach(a => {
      affilSel.innerHTML += `<option value="${a}">${a}</option>`;
    });
  }

  // Populate hour selects
  ["rr-from-h", "rr-to-h"].forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = "";
    for (let h = 6; h <= 22; h++) {
      const hh = String(h).padStart(2, "0");
      el.innerHTML += `<option value="${hh}" ${(idx === 0 && h === 7) || (idx === 1 && h === 9) ? "selected" : ""}>${hh}</option>`;
    }
  });

  // Preview update on change
  ["rr-week-start","rr-day-select","rr-affil-select","rr-from-h","rr-from-m","rr-to-h","rr-to-m"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = updateRrPreview;
  });

  // Send button
  const sendBtn = document.getElementById("rr-send-btn");
  if (sendBtn) sendBtn.onclick = sendRemoteRegistration;

  openModal("modal-remote-reg");
  setTimeout(updateRrPreview, 100);
}

function updateRrPreview() {
  const preview  = document.getElementById("rr-preview");
  if (!preview) return;
  const dayVal   = document.getElementById("rr-day-select")?.value;
  const affilVal = document.getElementById("rr-affil-select")?.value;
  const fromH    = document.getElementById("rr-from-h")?.value || "07";
  const fromM    = document.getElementById("rr-from-m")?.value || "00";
  const toH      = document.getElementById("rr-to-h")?.value   || "09";
  const toM      = document.getElementById("rr-to-m")?.value   || "00";
  if (!dayVal) { preview.style.display = "none"; return; }

  const empList   = (state.employees || []).filter(e => !affilVal || e.affiliation === affilVal);
  const [yy,mm,dd] = dayVal.split("-");
  const heDay     = DAYS_HE_RR[new Date(dayVal + "T00:00:00").getDay()];
  const timeRange = `${fromH}:${fromM}–${toH}:${toM}`;
  const tun       = state.tunnel || {};
  const hasTunnel = tun.has_tunnel;
  const baseUrl   = tun.base_url || window.location.origin;

  let tunnelBadge;
  if (tun.status === "starting") {
    tunnelBadge = `<div class="rr-tunnel-box rr-tunnel-starting">
      ⏳ <b>מחכה למנהרה...</b>
      <span class="rr-tunnel-spin">◌</span>
    </div>`;
  } else if (hasTunnel) {
    tunnelBadge = `<div class="rr-tunnel-box rr-tunnel-ok">
      ✅ <b>מנהרה פעילה</b> — קישורים יעבדו מכל מקום<br>
      <span style="font-size:0.75rem;opacity:0.8;direction:ltr;unicode-bidi:bidi-override">${baseUrl}</span>
      <button onclick="stopTunnel()" class="rr-tunnel-btn rr-tunnel-btn-stop">⏹ עצור</button>
    </div>`;
  } else {
    tunnelBadge = `<div class="rr-tunnel-box rr-tunnel-warn">
      ⚠️ <b>מנהרה לא פעילה</b> — קישורים יעבדו רק ברשת מקומית<br>
      <button onclick="startTunnel()" id="cf-start-btn" class="rr-tunnel-btn rr-tunnel-btn-start">
        🚇 הפעל מנהרה
      </button>
      <div style="font-size:0.72rem;margin-top:6px;opacity:0.85">
        אם המנהרה לא מתחברת, הרץ: <code style="color:#fcd34d">pip install pyngrok</code>
      </div>
    </div>`;
  }

  preview.style.display = "block";
  preview.innerHTML = `
    ${tunnelBadge}
    <div style="margin-top:10px;font-size:0.83rem">
      <span style="color:var(--text)">יום: <b>${heDay} ${dd}/${mm}/${yy}</b> | שעות: <b>${timeRange}</b></span><br>
      <span style="color:var(--text-muted)">יישלח ל-<b style="color:#fbbf24">${empList.length}</b> מפעילים${affilVal ? ` (${affilVal})` : ''}</span>
    </div>`;
}

async function startTunnel() {
  const btn = document.getElementById("cf-start-btn");
  if (btn) { btn.textContent = "⏳ מפעיל..."; btn.disabled = true; }
  try {
    await api("/api/tunnel/start", "POST");
    state.tunnel = { ...(state.tunnel||{}), status: "starting" };
    updateRrPreview();
    // Poll until running or error (max 30s)
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      await fetchTunnelStatus();
      updateRrPreview();
      if (state.tunnel.status === "running") {
        clearInterval(poll);
        showSuccess("✅ מנהרה פעילה: " + state.tunnel.public_url);
      } else if (state.tunnel.status === "not_installed") {
        clearInterval(poll);
        showError("חסרה חבילת pyngrok.\nהרץ בחלון CMD:\npip install pyngrok\nולאחר מכן הפעל מחדש את השרת.");
      } else if (tries >= 60 || state.tunnel.status === "error") {
        clearInterval(poll);
        showError("המנהרה לא הצליחה להתחבר. בדוק שcloudflared מותקן.");
      }
    }, 500);
  } catch(e) {
    showError(e.message);
    if (btn) { btn.textContent = "🚇 הפעל Cloudflare Tunnel"; btn.disabled = false; }
  }
}

async function stopTunnel() {
  await api("/api/tunnel/stop", "POST").catch(() => {});
  await fetchTunnelStatus();
  updateRrPreview();
}


async function sendRemoteRegistration() {
  const dayVal   = document.getElementById("rr-day-select")?.value;
  const affilVal = document.getElementById("rr-affil-select")?.value;
  const fromH    = document.getElementById("rr-from-h")?.value || "07";
  const fromM    = document.getElementById("rr-from-m")?.value || "00";
  const toH      = document.getElementById("rr-to-h")?.value   || "09";
  const toM      = document.getElementById("rr-to-m")?.value   || "00";

  if (!dayVal) { showError("נא לבחור יום"); return; }

  const empList = (state.employees || []).filter(e => !affilVal || e.affiliation === affilVal);
  if (!empList.length) { showError("לא נמצאו מפעילים בקטגוריה זו"); return; }

  // Refresh tunnel status before building URLs
  await fetchTunnelStatus();
  const baseUrl  = _getBaseUrl();
  const hasTunnel = state.tunnel?.has_tunnel;

  if (!hasTunnel) {
    const go = confirm(
      "⚠️ מנהרת Cloudflare לא פעילה.\n\n" +
      "הקישורים יעבדו רק ברשת המקומית (" + (state.tunnel?.local_url||baseUrl) + ").\n\n" +
      "האם להמשיך בכל זאת?"
    );
    if (!go) return;
  }

  const [yy,mm,dd] = dayVal.split("-");
  const heDay    = DAYS_HE_RR[new Date(dayVal + "T00:00:00").getDay()];
  const fromTime = `${fromH}:${fromM}`;
  const toTime   = `${toH}:${toM}`;

  const sendBtn = document.getElementById("rr-send-btn");
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "⏳ שולח..."; }

  // Create a session per operator and collect tokens
  const tokenMap = {};
  for (const emp of empList) {
    const token = _genToken();
    try {
      await api("/api/remote-registrations/session", "POST", {
        session_token: token,
        employee_id:   emp.id,
        employee_name: emp.name,
        shift_date:    dayVal,
        from_time:     fromTime,
        to_time:       toTime,
      });
      tokenMap[emp.id] = token;
    } catch(e) {
      showError("שגיאה עבור " + emp.name + ": " + e.message);
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "📤 שלח הודעות"; }
      return;
    }
  }

  // Open WA per operator with personal link
  let sent = 0;
  for (const emp of empList) {
    const t   = tokenMap[emp.id];
    if (!t) continue;
    const url = `${baseUrl}/register?t=${t}`;
    const msg = `שלום ${emp.name} 👋
רישום משמרת ל${heDay} ${dd}/${mm}/${yy}
שעות פנויות: ${fromTime}–${toTime}

🔗 לחץ לרישום:
${url}`;
    let phone = (emp.phone || "").replace(/[-+\s]/g, "");
    if (phone.startsWith("0")) phone = "972" + phone.slice(1);
    if (phone) {
      setTimeout(() => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank"), sent * 350);
      sent++;
    }
  }

  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "📤 שלח הודעות"; }
  if (sent > 0) showSuccess(`✅ נשלחו ${sent} הודעות עם קישור אישי`);
  else showError("אין מספרי טלפון למפעילים שנבחרו");

  closeModal("modal-remote-reg");

  const panel = document.getElementById("remote-reg-panel");
  if (panel) panel.classList.remove("hidden");
  await loadRemoteRegsFromServer(dayVal);
  startRegPolling(dayVal);
}


// State for registrations
if (!window._remoteRegs) window._remoteRegs = [];

function addPendingRegEntry(emp, date, fromTime, toTime) {
  // Don't duplicate
  if (window._remoteRegs.find(r => r.empId === emp.id && r.date === date)) return;
  window._remoteRegs.push({
    id: Date.now() + Math.random(),
    empId: emp.id,
    empName: emp.name,
    date,
    fromTime,
    toTime,
    regStart: null,
    regEnd: null,
    status: "pending",
    phone: emp.phone || ""
  });
}

function renderRemoteRegPanel() {
  const list = document.getElementById("remote-reg-list");
  if (!list) return;
  if (!window._remoteRegs.length) {
    list.innerHTML = `<div style="padding:16px;color:var(--text-muted);text-align:center;font-size:0.84rem">אין רישומים ממתינים</div>`;
    return;
  }

  const sorted = [...window._remoteRegs].sort((a,b) => a.date.localeCompare(b.date) || a.empName.localeCompare(b.empName));
  list.innerHTML = sorted.map(r => {
    const [yy,mm,dd] = r.date.split("-");
    const heDay = DAYS_HE_RR[new Date(r.date + "T00:00:00").getDay()];
    const statusMap = {
      pending:   { cls: "rr-status-pending",   txt: "⏳ ממתין"   },
      submitted: { cls: "rr-status-submitted",  txt: "📨 הוגש"    },
      confirmed: { cls: "rr-status-confirmed",  txt: "✅ אושר"    },
    };
    const { cls: statusCls, txt: statusTxt } = statusMap[r.status] || statusMap.pending;
    const regInfo = r.regStart
      ? `${r.regStart}–${r.regEnd}`
      : (r.status === "pending" ? `פנוי: ${r.fromTime}–${r.toTime}` : `${r.fromTime}–${r.toTime}`);
    return `<div class="remote-reg-item ${r.status === 'confirmed' ? 'confirmed' : ''}"
      oncontextmenu="event.preventDefault();showRegMenu(event,'${r.id}')"
      data-reg-id="${r.id}">
      <span class="rr-emp">${r.empName}</span>
      <span class="rr-date">${heDay} ${dd}/${mm}/${yy}</span>
      <span class="rr-time">${regInfo}</span>
      <span class="rr-status-badge ${statusCls}">${statusTxt}</span>
    </div>`;
  }).join("");
}

function refreshRemoteRegPanel() {
  renderRemoteRegPanel();
}

// Context menu for registration entry
let _regMenuCleanup = null;
function showRegMenu(event, regId) {
  hideRegMenu();
  const reg = window._remoteRegs.find(r => String(r.id) === String(regId));
  if (!reg) return;

  const menu = document.createElement("div");
  menu.id = "reg-ctx-menu";
  // Position menu - keep on screen
  const menuW = 220, menuH = 160;
  const top  = Math.min(event.clientY, window.innerHeight - menuH - 10);
  const left = Math.min(event.clientX, window.innerWidth  - menuW - 10);
  menu.style.cssText = `position:fixed;z-index:9999;top:${top}px;left:${left}px;
    background:var(--surface2);border:1px solid var(--border);border-radius:10px;
    overflow:hidden;min-width:${menuW}px;box-shadow:0 8px 24px rgba(0,0,0,0.5);direction:rtl;`;

  if (reg.status === "submitted") {
    // Operator filled form — ready to approve
    menu.innerHTML += `<div class="cell-menu-item" style="background:rgba(34,197,94,0.1)" onclick="hideRegMenu();parseAndInsertReg('${regId}')">
      ✈ הזנה אוטומטית למטריצה (${reg.regStart}–${reg.regEnd})</div>`;
    menu.innerHTML += `<div class="cell-menu-item" onclick="hideRegMenu();openEnterRegTime('${regId}')">
      ✏️ שנה שעות לפני הזנה</div>`;
  } else if (reg.status === "pending") {
    menu.innerHTML += `<div class="cell-menu-item" onclick="hideRegMenu();openEnterRegTime('${regId}')">
      ✏️ הזן שעת רישום ידנית</div>`;
  } else if (reg.status === "confirmed") {
    menu.innerHTML += `<div class="cell-menu-item" onclick="hideRegMenu();shiftRegTime('${regId}')">
      🕐 שנה שעת רישום</div>`;
  }
  menu.innerHTML += `<div class="cell-menu-item con-item" style="border-top:1px solid var(--border)" onclick="hideRegMenu();deleteReg('${regId}')">
    🗑 מחק רישום</div>`;

  document.body.appendChild(menu);
  setTimeout(() => {
    _regMenuCleanup = e => { if (!menu.contains(e.target)) hideRegMenu(); };
    document.addEventListener("click", _regMenuCleanup);
  }, 10);
}

function hideRegMenu() {
  const m = document.getElementById("reg-ctx-menu");
  if (m) m.remove();
  if (_regMenuCleanup) { document.removeEventListener("click", _regMenuCleanup); _regMenuCleanup = null; }
}

function openEnterRegTime(regId) {
  const reg = window._remoteRegs.find(r => String(r.id) === String(regId));
  if (!reg) return;
  const defaultVal = reg.regStart ? `${reg.regStart}-${reg.regEnd}` : `${reg.fromTime}-${reg.toTime}`;
  const input = prompt(`הזן שעות רישום עבור ${reg.empName} (פורמט: HH:MM-HH:MM):`, defaultVal);
  if (!input) return;
  const match = input.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
  if (!match) { showError("פורמט שגוי. השתמש ב- HH:MM-HH:MM"); return; }
  const origStart = reg.regStart;
  const origEnd   = reg.regEnd;
  reg.regStart = match[1].padStart(5, "0");
  reg.regEnd   = match[2].padStart(5, "0");

  // If hours differ from what operator requested - ask to send WA
  const changed = origStart && (origStart !== reg.regStart || origEnd !== reg.regEnd);
  if (changed) {
    const [yy,mm,dd] = reg.date.split("-");
    const DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
    const heDay = DAYS[new Date(reg.date + "T00:00:00").getDay()];
    const msg = `שלום ${reg.empName},
שים לב — השעות שלך שונו:
${heDay} ${dd}/${mm}/${yy} | ${reg.regStart}–${reg.regEnd}
(בקשתך המקורית: ${origStart}–${origEnd})
נא להתעדכן ממכלול תכנון`;
    let phone = (reg.phone || "").replace(/[-+\s]/g, "");
    if (phone.startsWith("0")) phone = "972" + phone.slice(1);
    if (phone) {
      const sendWA = confirm(`השעות שונו מ-${origStart}–${origEnd} ל-${reg.regStart}–${reg.regEnd}.
לשלוח הודעה ל-${reg.empName}?`);
      if (sendWA) {
        setTimeout(() => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank"), 200);
      }
    }
  }
  insertRegToMatrix(reg);
}

function parseAndInsertReg(regId) {
  const reg = window._remoteRegs.find(r => String(r.id) === String(regId));
  if (!reg) return;
  if (reg.regStart && reg.regEnd) {
    insertRegToMatrix(reg);
  } else {
    openEnterRegTime(regId);
  }
}

async function insertRegToMatrix(reg) {
  if (!reg.regStart || !reg.regEnd) return;
  const emp = (state.employees || []).find(e => e.id === reg.empId);
  if (!emp) { showError("מפעיל לא נמצא"); return; }

  // Check matrix conflict - same employee same date overlapping shift
  const dayShifts = (state.shifts || []).filter(s =>
    s.shift_date === reg.date && s.employee_id === reg.empId
  );
  const [rsh, rsm] = reg.regStart.split(":").map(Number);
  const [reh, rem] = reg.regEnd.split(":").map(Number);
  const regStartMin = rsh * 60 + rsm;
  const regEndMin   = reh * 60 + rem;
  for (const s of dayShifts) {
    const [ssh, ssm] = s.start_time.split(":").map(Number);
    const [seh, sem] = s.end_time.split(":").map(Number);
    const sStart = ssh * 60 + ssm;
    const sEnd   = seh * 60 + sem;
    if (regStartMin < sEnd && regEndMin > sStart) {
      const go = confirm(`⚠️ ל${emp.name} כבר יש משמרת באותה שעה (${s.start_time}–${s.end_time}).
להמשיך בכל זאת?`);
      if (!go) return;
      break;
    }
  }

  // Find default shift type
  const st = state.shiftTypes[0];
  if (!st) { showError("אין סוג משמרת"); return; }

  try {
    const result = await api("/api/shifts", "POST", {
      shift_date: reg.date,
      shift_type_id: st.id,
      start_time: reg.regStart,
      end_time: reg.regEnd,
      employee_id: reg.empId,
    });
    reg.status = "confirmed";
    reg.shiftId = result.id;
    // Persist confirmed status to DB
    try {
      await api(`/api/remote-registrations/${reg.serverId}`, "PUT", {
        status: "confirmed",
        shift_id: result.id,
      });
    } catch(e) {}
    renderRemoteRegPanel();
    await loadDailySchedule();
    renderFlightBoard();

    // Send confirmation WA
    const [yy,mm,dd] = reg.date.split("-");
    const heDay = DAYS_HE_RR[new Date(reg.date + "T00:00:00").getDay()];
    const msg = `שלום ${reg.empName},\nהרישום שלך נקלט בהצלחה! ✅\n${heDay} ${dd}/${mm}/${yy} | ${reg.regStart}–${reg.regEnd}\nמכלול תכנון`;
    let phone = reg.phone.replace(/[-+\s]/g, "");
    if (phone.startsWith("0")) phone = "972" + phone.slice(1);
    if (phone) {
      setTimeout(() => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank"), 200);
    }
    showSuccess(`רישום ${reg.empName} הוזן למטריצה`);
  } catch(e) { showError(e.message); }
}

async function shiftRegTime(regId) {
  const reg = window._remoteRegs.find(r => String(r.id) === String(regId));
  if (!reg) return;
  const input = prompt(`שנה שעות רישום עבור ${reg.empName} (פורמט: HH:MM-HH:MM):`, `${reg.regStart}-${reg.regEnd}`);
  if (!input) return;
  const match = input.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
  if (!match) { showError("פורמט שגוי"); return; }
  const newStart = match[1].padStart(5,"0");
  const newEnd   = match[2].padStart(5,"0");

  // Update shift in DB if exists
  if (reg.shiftId) {
    try {
      await api(`/api/shifts/${reg.shiftId}`, "PUT", { start_time: newStart, end_time: newEnd });
      await loadDailySchedule();
      renderFlightBoard();
    } catch(e) { showError(e.message); return; }
  }

  const oldStart = reg.regStart, oldEnd = reg.regEnd;
  reg.regStart = newStart;
  reg.regEnd   = newEnd;
  renderRemoteRegPanel();

  // Send WA notification about time change
  const [yy,mm,dd] = reg.date.split("-");
  const heDay = DAYS_HE_RR[new Date(reg.date + "T00:00:00").getDay()];
  const msg = `שלום ${reg.empName},
שים לב — השעות שלך שונו:
${heDay} ${dd}/${mm}/${yy} | ${newStart}–${newEnd}
(בקשתך המקורית: ${oldStart}–${oldEnd})
נא להתעדכן ממכלול תכנון`;
  let phone = (reg.phone || "").replace(/[-+\s]/g, "");
  if (phone.startsWith("0")) phone = "972" + phone.slice(1);
  if (phone) {
    const sendWA = confirm(`לשלוח הודעה ל-${reg.empName} על שינוי השעות?
${oldStart}–${oldEnd} ← ${newStart}–${newEnd}`);
    if (sendWA) {
      setTimeout(() => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank"), 200);
    }
  }
  showSuccess(`שעות ${reg.empName} עודכנו`);
}

function deleteReg(regId) {
  window._remoteRegs = window._remoteRegs.filter(r => String(r.id) !== String(regId));
  // Also delete from DB
  const reg = (window._remoteRegs || []).find(r => String(r.id) === String(regId));
  if (reg?.serverId) api(`/api/remote-registrations/${reg.serverId}`, "DELETE").catch(()=>{});
  renderRemoteRegPanel();
}

async function loadRemoteRegsFromServer(filterDate) {
  try {
    const params = filterDate ? `?week_start=${filterDate}` : "";
    const regs = await api(`/api/remote-registrations${params}`);
    const emps = state.employees || [];
    window._remoteRegs = regs.map(r => {
      const emp = emps.find(e => e.id === r.employee_id);
      return {
        id:       r.id,
        serverId: r.id,
        empId:    r.employee_id,
        empName:  r.employee_name,
        date:     r.shift_date,
        fromTime: r.start_time,
        toTime:   r.end_time,
        regStart: r.reg_start || null,
        regEnd:   r.reg_end   || null,
        status:   r.status,
        phone:    emp?.phone || "",
        shiftId:  r.shift_id || null,
      };
    });
  } catch(e) { console.error("loadRemoteRegsFromServer:", e); }
}

async function openRegPanel() {
  const panel = document.getElementById("remote-reg-panel");
  if (panel) panel.classList.remove("hidden");
  await loadSheetUrlToPanel();
  await loadRemoteRegsFromServer();
  renderRemoteRegPanel();
}

async function loadSheetUrlToPanel() {
  try {
    const cfg = await api("/api/sheet-config");
    const inp = document.getElementById("rr-sheet-url");
    if (inp && cfg.sheet_url) inp.value = cfg.sheet_url;
  } catch(e) {}
}

async function saveSheetUrl() {
  const url = document.getElementById("rr-sheet-url")?.value?.trim();
  if (!url) return;
  try {
    await api("/api/sheet-config", "POST", { sheet_url: url });
    showSuccess("✅ כתובת Sheet נשמרה");
    await pollSheetNow();
  } catch(e) { showError(e.message); }
}

async function pollSheetNow() {
  const status = document.getElementById("sheet-status");
  if (status) status.textContent = "⏳ טוען תגובות...";
  try {
    const result = await api("/api/sheet-poll");
    await loadRemoteRegsFromServer();
    renderRemoteRegPanel();
    const panel = document.getElementById("remote-reg-panel");
    if (panel) panel.classList.remove("hidden");
    if (status) {
      status.textContent = result.count > 0
        ? `✅ ${result.count} חדשים | סה"כ: ${result.total}`
        : `✅ עודכן | ${result.total} תגובות`;
    }
  } catch(e) {
    if (status) status.textContent = "❌ " + e.message;
  }
}

async function pollSheetRegistrations() {
  try {
    const result = await api("/api/sheet-poll");
    if (result.count > 0) {
      await loadRemoteRegsFromServer();
      renderRemoteRegPanel();
    }
  } catch(e) {}
}

function startSheetPolling() {
  setInterval(async () => {
    const panel = document.getElementById("remote-reg-panel");
    if (panel && !panel.classList.contains("hidden")) {
      await pollSheetRegistrations();
    }
  }, 30000);
}

async function loadRemoteRegsFromServer(filterDate) {
  try {
    const params = filterDate ? `?week_start=${filterDate}` : "";
    const regs = await api(`/api/remote-registrations${params}`);
    const emps = state.employees || [];
    window._remoteRegs = regs.map(r => {
      const emp = emps.find(e => e.id === r.employee_id);
      return {
        id:       r.id,
        serverId: r.id,
        empId:    r.employee_id,
        empName:  r.employee_name,
        date:     r.shift_date,
        fromTime: r.start_time,
        toTime:   r.end_time,
        regStart: r.reg_start || null,
        regEnd:   r.reg_end   || null,
        status:   r.status,
        phone:    emp?.phone || "",
        shiftId:  r.shift_id || null,
      };
    });
  } catch(e) { console.error("loadRemoteRegsFromServer:", e); }
}

function _getBaseUrl() {
  return state.tunnel?.base_url || window.location.origin;
}


async function fetchTunnelStatus() {
  try {
    state.tunnel = await api("/api/tunnel/status");
  } catch(e) {
    state.tunnel = { status: "stopped", base_url: window.location.origin, has_tunnel: false };
  }
}


