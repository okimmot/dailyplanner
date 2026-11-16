(() => {
  'use strict';

  const STORE_KEY = 'day-planner:v1';
  const SETTINGS_KEY = 'day-planner:settings';
  const TODO_KEY = 'day-planner:todos';
  const HOUR_H = 72;            // px per hour
  const PPM = HOUR_H / 60;      // px per minute
  const SNAP = 15;              // minutes
  const DAY = 1440;
  const DURATIONS = [15, 30, 45, 60, 90, 120];
  const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5"/></svg>';

  // ---------- helpers ----------

  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const snap = (m) => Math.round(m / SNAP) * SNAP;
  const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const timeRange = (start, dur) => `${hhmm(start)} – ${hhmm(start + dur)}`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function fmtDur(m) {
    m = Math.round(m);
    const h = Math.floor(m / 60), r = m % 60;
    if (h && r) return `${h}h ${r}m`;
    return h ? `${h}h` : `${r}m`;
  }

  function parseTime(s) {
    const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
    return m ? clamp(+m[1] * 60 + +m[2], 0, DAY - 5) : null;
  }

  function dateKey(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function nowMin() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...kids.filter(Boolean));
    return node;
  }

  // ---------- state ----------

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function loadSettings() {
    const s = readJSON(SETTINGS_KEY) || {};
    const dayStart = Number.isInteger(s.dayStart) ? clamp(s.dayStart, 0, 23) : 6;
    const dayEnd = Number.isInteger(s.dayEnd) ? clamp(s.dayEnd, dayStart + 1, 24) : 24;
    return { dayStart, dayEnd, theme: s.theme === 'dark' ? 'dark' : 'light' };
  }

  function cleanTasks(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((t) => t && typeof t.title === 'string')
      .map((t) => ({
        id: String(t.id || uid()),
        title: t.title,
        start: Number.isFinite(t.start) ? clamp(Math.round(t.start), 0, DAY - 5) : null,
        dur: Number.isFinite(t.dur) ? clamp(Math.round(t.dur), 5, DAY) : 30,
        done: !!t.done,
      }));
  }

  // Today's plan only. When the date changes, yesterday's unfinished tasks are
  // parked in `carry` until the user brings them over or dismisses them.
  function loadState() {
    const saved = readJSON(STORE_KEY);
    const today = dateKey();
    if (saved && saved.date === today) {
      return { date: today, tasks: cleanTasks(saved.tasks), carry: cleanTasks(saved.carry), carryFrom: saved.carryFrom || null };
    }
    let carry = [], carryFrom = null;
    if (saved) {
      const unfinished = cleanTasks(saved.tasks).filter((t) => !t.done);
      if (unfinished.length) { carry = unfinished; carryFrom = saved.date; }
      else { carry = cleanTasks(saved.carry); carryFrom = saved.carryFrom || null; }
    }
    return { date: today, tasks: [], carry, carryFrom };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  }

  let settings = loadSettings();
  let state = loadState();
  let view = [settings.dayStart * 60, settings.dayEnd * 60];
  let drag = null;
  let draft = null;
  let editingId = null;
  let suppressClick = false;
  let lastMinute = -1;

  const findTask = (id) => state.tasks.find((t) => t.id === id);
  const scheduled = () => state.tasks.filter((t) => t.start != null);
  const selectedDur = () => +(document.querySelector('input[name="dur"]:checked')?.value || 30);

  // ---------- elements ----------

  const grid = $('#grid'), hoursEl = $('#hours'), lane = $('#lane');
  const listEl = $('#unscheduled');
  const editor = $('#editor'), editForm = $('#editForm');
  const editTitle = $('#editTitle'), editStart = $('#editStart'), editDur = $('#editDur'), editDone = $('#editDone');
  const newTitle = $('#newTitle'), newStart = $('#newStart');
  const dayStartSel = $('#dayStart'), dayEndSel = $('#dayEnd');
  let nowLine = null, pastEl = null, slotEl = null;

  // ---------- header + stats ----------

  function renderHeader() {
    const d = new Date();
    $('#dayName').textContent = d.toLocaleDateString('en-GB', { weekday: 'long' });
    $('#dateStr').textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    $('#clock').textContent = hhmm(nowMin());

    const total = state.tasks.length;
    const planned = state.tasks.reduce((s, t) => s + t.dur, 0);
    const done = state.tasks.reduce((s, t) => s + (t.done ? t.dur : 0), 0);
    const todo = planned - done;
    const remaining = Math.max(0, settings.dayEnd * 60 - Math.max(nowMin(), settings.dayStart * 60));
    const free = remaining - todo;

    const summary = $('#summary');
    summary.className = 'summary';
    if (!total) {
      summary.textContent = 'Nothing planned yet';
    } else if (!todo) {
      summary.textContent = `▲ All ${total} done`;
      summary.classList.add('good');
    } else if (free >= 0) {
      summary.textContent = `▲ ${fmtDur(todo)} to do · ${fmtDur(free)} to spare`;
      summary.classList.add('good');
    } else {
      summary.textContent = `▼ ${fmtDur(todo)} to do · ${fmtDur(-free)} more than the day has left`;
      summary.classList.add('bad');
    }

    $('#statPlanned').textContent = fmtDur(planned);
    $('#statDone').textContent = fmtDur(done);
    $('#statTodo').textContent = fmtDur(todo);
    const freeEl = $('#statFree');
    freeEl.textContent = free < 0 ? `−${fmtDur(-free)}` : fmtDur(free);
    freeEl.classList.toggle('bad', free < 0);
    $('#progressFill').style.width = planned ? `${(done / planned) * 100}%` : '0';
  }

  function renderCarry() {
    const box = $('#carry');
    box.hidden = !state.carry.length;
    if (!state.carry.length) return;
    let from = 'an earlier day';
    if (state.carryFrom) {
      const then = new Date(state.carryFrom + 'T00:00');
      const days = Math.round((new Date(state.date + 'T00:00') - then) / 86400000);
      from = days === 1 ? 'yesterday' : then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
    const n = state.carry.length;
    $('#carryText').textContent = `${n} unfinished ${n === 1 ? 'task' : 'tasks'} from ${from}`;
  }

  // ---------- timeline ----------

  function viewRange() {
    let s = settings.dayStart * 60, e = settings.dayEnd * 60;
    for (const t of scheduled()) {
      s = Math.min(s, Math.floor(t.start / 60) * 60);
      e = Math.max(e, Math.ceil((t.start + t.dur) / 60) * 60);
    }
    return [s, Math.min(e, DAY)];
  }

  // Side-by-side columns for tasks that overlap in time.
  function layout(items) {
    const out = new Map();
    let cluster = [], cols = [], clusterEnd = -1;
    const flush = () => {
      for (const t of cluster) out.get(t.id).n = cols.length;
      cluster = []; cols = []; clusterEnd = -1;
    };
    for (const t of items) {
      const end = t.start + Math.max(t.dur, SNAP);
      if (cluster.length && t.start >= clusterEnd) flush();
      let c = cols.findIndex((colEnd) => colEnd <= t.start);
      if (c === -1) { c = cols.length; cols.push(end); } else cols[c] = end;
      out.set(t.id, { col: c, n: 1 });
      cluster.push(t);
      clusterEnd = Math.max(clusterEnd, end);
    }
    flush();
    return out;
  }

  function sizeClass(dur) {
    if (dur < 30) return ' row tiny';
    if (dur < 45) return ' row';
    return dur >= 75 ? ' tall' : '';
  }

  function checkButton(t) {
    return el('button', {
      class: 'check', type: 'button', role: 'checkbox',
      'aria-checked': String(t.done), 'aria-label': 'Done', html: CHECK_SVG,
    });
  }

  function blockEl(t, pos, vs, now) {
    const overdue = !t.done && t.start + t.dur <= now;
    const node = el('div', {
      class: 'block' + sizeClass(t.dur) + (t.done ? ' done' : '') + (overdue ? ' overdue' : ''),
      'data-id': t.id, tabindex: '0', role: 'button',
      'aria-label': `${t.title}, ${timeRange(t.start, t.dur)}`,
    },
      checkButton(t),
      el('div', { class: 'b-text' },
        el('span', { class: 'b-title', text: t.title }),
        el('span', { class: 'b-time', text: timeRange(t.start, t.dur) })),
      el('div', { class: 'grip' }));
    node.style.top = `${(t.start - vs) * PPM}px`;
    node.style.height = `${Math.max(t.dur * PPM - 2, 14)}px`;
    node.style.left = `${(pos.col / pos.n) * 100}%`;
    node.style.width = `calc(${100 / pos.n}% - ${pos.n > 1 ? 3 : 0}px)`;
    return node;
  }

  function renderTimeline() {
    view = viewRange();
    const [vs, ve] = view;
    const now = nowMin();
    grid.style.height = `${(ve - vs) * PPM}px`;

    hoursEl.replaceChildren();
    for (let m = vs; m <= ve; m += 60) {
      const line = el('div', { class: 'hour' }, el('span', { text: hhmm(m) }));
      line.style.top = `${(m - vs) * PPM}px`;
      hoursEl.append(line);
    }

    const items = scheduled().sort((a, b) => a.start - b.start || b.dur - a.dur);
    const pos = layout(items);
    pastEl = el('div', { class: 'past' });
    slotEl = el('div', { class: 'slot' });
    nowLine = el('div', { class: 'now' });
    lane.replaceChildren(pastEl, slotEl, ...items.map((t) => blockEl(t, pos.get(t.id), vs, now)), nowLine);
    positionNow();
  }

  function positionNow() {
    if (!nowLine) return;
    const [vs, ve] = view;
    const now = nowMin();
    const inView = now >= vs && now <= ve;
    nowLine.hidden = !inView;
    nowLine.style.top = `${(now - vs) * PPM}px`;
    pastEl.style.height = `${(clamp(now, vs, ve) - vs) * PPM}px`;
  }

  // ---------- unscheduled list ----------

  function renderUnscheduled() {
    const items = state.tasks.filter((t) => t.start == null);
    listEl.replaceChildren(...items.map((t) =>
      el('li', { class: 'u-item' + (t.done ? ' done' : ''), 'data-id': t.id },
        checkButton(t),
        el('span', { class: 'u-title', text: t.title }),
        el('span', { class: 'u-dur', text: fmtDur(t.dur) }),
        !t.done && el('button', { class: 'chip place', type: 'button', title: 'Put in the next free slot', text: 'Place' }))));
    $('#placeAll').hidden = items.filter((t) => !t.done).length < 2;
  }

  function render() {
    renderHeader();
    renderCarry();
    renderTimeline();
    renderUnscheduled();
  }

  function commit() {
    save();
    render();
  }

  // ---------- scheduling ----------

  function nextFree(dur) {
    const from = Math.ceil(Math.max(nowMin(), settings.dayStart * 60) / SNAP) * SNAP;
    const busy = scheduled();
    for (let s = from; s + dur <= DAY; s += SNAP) {
      if (!busy.some((b) => s < b.start + b.dur && b.start < s + dur)) return s;
    }
    return clamp(from, 0, Math.max(0, DAY - dur));
  }

  function place(t) {
    t.start = nextFree(t.dur);
    t.dur = Math.min(t.dur, DAY - t.start);
  }

  function revealBlock(id) {
    const node = lane.querySelector(`.block[data-id="${CSS.escape(id)}"]`);
    if (node) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- inline create ----------

  function startDraft(start) {
    const dur = Math.min(selectedDur(), DAY - start);
    const input = el('input', { type: 'text', placeholder: `New task at ${hhmm(start)}`, maxlength: '120', enterkeyhint: 'done' });
    const node = el('div', { class: 'block draft' }, input);
    node.style.top = `${(start - view[0]) * PPM}px`;
    node.style.height = `${Math.max(dur * PPM - 2, 34)}px`;
    node.style.left = '0';
    node.style.width = '100%';
    slotEl.style.display = 'none';
    lane.append(node);

    let finished = false;
    const finish = (keep) => {
      if (finished) return;
      finished = true;
      draft = null;
      const title = input.value.trim();
      if (keep && title) state.tasks.push({ id: uid(), title, start, dur, done: false });
      commit();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    draft = node;
    input.focus();
  }

  // ---------- drag: move, resize, place ----------

  function beginDrag(e, kind, task, node) {
    drag = {
      kind, task, node,
      x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
      grab: e.clientY - node.getBoundingClientRect().top,
      start: task.start, dur: task.dur,
      active: false, over: false, ghost: null, preview: null,
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', cancelDrag);
  }

  function activateDrag() {
    drag.active = true;
    document.body.classList.add(drag.kind === 'resize' ? 'resizing' : 'dragging');
    drag.node.classList.add('dragging');
    if (slotEl) slotEl.style.display = 'none';
    if (drag.kind === 'place') {
      drag.ghost = el('div', { class: 'ghost', text: drag.task.title });
      document.body.append(drag.ghost);
      drag.preview = el('div', { class: 'block preview' + sizeClass(drag.dur) },
        el('div', { class: 'b-text' },
          el('span', { class: 'b-title', text: drag.task.title }),
          el('span', { class: 'b-time' })));
      drag.preview.style.left = '0';
      drag.preview.style.width = '100%';
      drag.preview.style.height = `${Math.max(drag.dur * PPM - 2, 14)}px`;
      drag.preview.hidden = true;
      lane.append(drag.preview);
    }
    requestAnimationFrame(autoScroll);
  }

  function updateDrag() {
    const rect = lane.getBoundingClientRect();
    const [vs, ve] = view;
    const d = drag;
    if (d.kind === 'move') {
      d.start = Math.max(vs, Math.min(vs + snap((d.y - rect.top - d.grab) / PPM), ve - d.dur));
      d.node.style.top = `${(d.start - vs) * PPM}px`;
      d.node.querySelector('.b-time').textContent = timeRange(d.start, d.dur);
    } else if (d.kind === 'resize') {
      const end = vs + snap((d.y - rect.top) / PPM);
      d.dur = clamp(end - d.start, SNAP, ve - d.start);
      d.node.style.height = `${Math.max(d.dur * PPM - 2, 14)}px`;
      d.node.querySelector('.b-time').textContent = timeRange(d.start, d.dur);
    } else {
      d.over = d.x >= rect.left && d.x <= rect.right && d.y >= rect.top && d.y <= rect.bottom;
      d.ghost.style.transform = `translate(${d.x + 12}px, ${d.y + 12}px)`;
      d.ghost.hidden = d.over;
      d.preview.hidden = !d.over;
      if (d.over) {
        d.start = Math.max(vs, Math.min(vs + snap((d.y - rect.top - 12) / PPM), ve - d.dur));
        d.preview.style.top = `${(d.start - vs) * PPM}px`;
        d.preview.querySelector('.b-time').textContent = timeRange(d.start, Math.min(d.dur, DAY - d.start));
      }
    }
  }

  function autoScroll() {
    if (!drag || !drag.active) return;
    const edge = 70;
    let dy = 0;
    if (drag.y < edge) dy = -Math.min(18, (edge - drag.y) / 4);
    else if (drag.y > innerHeight - edge) dy = Math.min(18, (drag.y - (innerHeight - edge)) / 4);
    if (dy) { scrollBy(0, dy); updateDrag(); }
    requestAnimationFrame(autoScroll);
  }

  function onDragMove(e) {
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 4) return;
      activateDrag();
    }
    updateDrag();
  }

  function endDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', cancelDrag);
    document.body.classList.remove('dragging', 'resizing');
    drag.ghost?.remove();
    const finished = drag;
    drag = null;
    return finished;
  }

  function onDragEnd() {
    const d = endDrag();
    if (!d.active) return;            // a plain click; the click handler takes it
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (d.kind === 'place') {
      if (d.over) {
        d.task.start = d.start;
        d.task.dur = Math.min(d.dur, DAY - d.start);
      }
    } else {
      d.task.start = d.start;
      d.task.dur = d.dur;
    }
    commit();
  }

  function cancelDrag() {
    if (!drag) return;
    endDrag();
    render();
  }

  // ---------- timeline events ----------

  lane.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || drag) return;
    const node = e.target.closest('.block');
    if (!node || !node.dataset.id || e.target.closest('.check')) return;
    const task = findTask(node.dataset.id);
    if (task) beginDrag(e, e.target.closest('.grip') ? 'resize' : 'move', task, node);
  });

  lane.addEventListener('click', (e) => {
    if (suppressClick) return;
    const node = e.target.closest('.block');
    if (node && node.dataset.id) {
      const task = findTask(node.dataset.id);
      if (!task) return;
      if (e.target.closest('.check')) { task.done = !task.done; commit(); }
      else openEditor(task.id);
      return;
    }
    if (e.target !== lane || draft) return;
    const y = e.clientY - lane.getBoundingClientRect().top;
    const start = clamp(view[0] + Math.floor(y / PPM / SNAP) * SNAP, view[0], DAY - SNAP);
    startDraft(start);
  });

  lane.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('block') && e.target.dataset.id) {
      e.preventDefault();
      openEditor(e.target.dataset.id);
    }
  });

  lane.addEventListener('pointermove', (e) => {
    if (!slotEl || e.pointerType !== 'mouse') return;
    if (e.target !== lane || drag || draft) { slotEl.style.display = 'none'; return; }
    const y = e.clientY - lane.getBoundingClientRect().top;
    const start = clamp(view[0] + Math.floor(y / PPM / SNAP) * SNAP, view[0], DAY - SNAP);
    const dur = Math.min(selectedDur(), DAY - start);
    slotEl.style.display = 'flex';
    slotEl.style.top = `${(start - view[0]) * PPM}px`;
    slotEl.style.height = `${Math.max(dur * PPM - 2, 14)}px`;
    slotEl.textContent = `+ ${hhmm(start)}`;
  });

  lane.addEventListener('pointerleave', () => { if (slotEl) slotEl.style.display = 'none'; });

  // ---------- unscheduled events ----------

  listEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || drag) return;
    const node = e.target.closest('.u-item');
    if (!node || e.target.closest('button')) return;
    const task = findTask(node.dataset.id);
    if (task) beginDrag(e, 'place', task, node);
  });

  listEl.addEventListener('click', (e) => {
    if (suppressClick) return;
    const node = e.target.closest('.u-item');
    const task = node && findTask(node.dataset.id);
    if (!task) return;
    if (e.target.closest('.check')) { task.done = !task.done; commit(); }
    else if (e.target.closest('.place')) { place(task); commit(); revealBlock(task.id); }
    else openEditor(task.id);
  });

  $('#placeAll').addEventListener('click', () => {
    for (const t of state.tasks) if (t.start == null && !t.done) place(t);
    commit();
  });

  // ---------- add form ----------

  $('#durPills').append(...DURATIONS.map((d) =>
    el('label', { class: 'pill' },
      el('input', { type: 'radio', name: 'dur', value: String(d), checked: d === 30 }),
      el('span', { text: fmtDur(d) }))));

  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = newTitle.value.trim();
    if (!title) { newTitle.focus(); return; }
    const start = parseTime(newStart.value);
    const dur = start == null ? selectedDur() : Math.min(selectedDur(), DAY - start);
    const task = { id: uid(), title, start, dur, done: false };
    state.tasks.push(task);
    newTitle.value = '';
    newStart.value = '';
    commit();
    newTitle.focus();
    if (start != null) revealBlock(task.id);
  });

  // ---------- editor ----------

  function fillDurations(current) {
    const opts = [];
    for (let m = 15; m <= 180; m += 15) opts.push(m);
    for (let m = 210; m <= 480; m += 30) opts.push(m);
    if (!opts.includes(current)) { opts.push(current); opts.sort((a, b) => a - b); }
    editDur.replaceChildren(...opts.map((m) => el('option', { value: String(m), text: fmtDur(m) })));
    editDur.value = String(current);
  }

  function openEditor(id) {
    const t = findTask(id);
    if (!t) return;
    editingId = id;
    editTitle.value = t.title;
    editStart.value = t.start == null ? '' : hhmm(t.start);
    fillDurations(t.dur);
    editDone.checked = t.done;
    $('#editUnschedule').hidden = t.start == null;
    editor.showModal();
  }

  editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = findTask(editingId);
    if (t) {
      t.title = editTitle.value.trim() || t.title;
      t.start = parseTime(editStart.value);
      t.dur = +editDur.value || t.dur;
      if (t.start != null) t.dur = Math.min(t.dur, DAY - t.start);
      t.done = editDone.checked;
    }
    editor.close();
    commit();
  });

  $('#editUnschedule').addEventListener('click', () => {
    editStart.value = '';
    $('#editUnschedule').hidden = true;
  });

  $('#editDelete').addEventListener('click', () => {
    state.tasks = state.tasks.filter((t) => t.id !== editingId);
    editor.close();
    commit();
  });

  $('#editCancel').addEventListener('click', () => editor.close());
  editor.addEventListener('click', (e) => { if (e.target === editor) editor.close(); });

  // ---------- to-do list ----------
  // Separate from the day's plan: to-dos persist across days until removed.

  function loadTodos() {
    const list = readJSON(TODO_KEY);
    if (!Array.isArray(list)) return [];
    return list
      .filter((t) => t && typeof t.text === 'string')
      .map((t) => ({ id: String(t.id || uid()), text: t.text, done: !!t.done }));
  }

  let todos = loadTodos();
  const todoList = $('#todoList'), todoInput = $('#todoInput');

  function saveTodos() {
    try { localStorage.setItem(TODO_KEY, JSON.stringify(todos)); } catch { /* storage unavailable */ }
  }

  function renderTodos() {
    const ordered = [...todos.filter((t) => !t.done), ...todos.filter((t) => t.done)];
    todoList.replaceChildren(...ordered.map((t) =>
      el('li', { class: 't-item' + (t.done ? ' done' : ''), 'data-id': t.id },
        checkButton(t),
        el('span', { class: 't-text', text: t.text }),
        el('button', { class: 't-del', type: 'button', 'aria-label': `Delete ${t.text}`, text: '×' }))));
    $('#clearTodos').hidden = !todos.some((t) => t.done);
  }

  function commitTodos() {
    saveTodos();
    renderTodos();
  }

  $('#todoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = todoInput.value.trim();
    if (!text) { todoInput.focus(); return; }
    todos.push({ id: uid(), text, done: false });
    todoInput.value = '';
    commitTodos();
    todoInput.focus();
  });

  todoList.addEventListener('click', (e) => {
    const item = e.target.closest('.t-item');
    const todo = item && todos.find((t) => t.id === item.dataset.id);
    if (!todo) return;
    if (e.target.closest('.t-del')) todos = todos.filter((t) => t !== todo);
    else if (e.target.closest('.check, .t-text')) todo.done = !todo.done;
    else return;
    commitTodos();
  });

  $('#clearTodos').addEventListener('click', () => {
    todos = todos.filter((t) => !t.done);
    commitTodos();
  });

  // ---------- theme ----------

  const themeToggle = $('#themeToggle');

  function applyTheme() {
    const dark = settings.theme === 'dark';
    if (dark) document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    themeToggle.textContent = dark ? 'Light' : 'Dark';
    themeToggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
  }

  themeToggle.addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
  });

  // ---------- day range, clear, carry-over ----------

  function fillRange() {
    dayStartSel.replaceChildren(...Array.from({ length: 24 }, (_, h) => el('option', { value: String(h), text: hhmm(h * 60) })));
    dayEndSel.replaceChildren(...Array.from({ length: 24 }, (_, i) => el('option', { value: String(i + 1), text: i + 1 === 24 ? '24:00' : hhmm((i + 1) * 60) })));
    dayStartSel.value = String(settings.dayStart);
    dayEndSel.value = String(settings.dayEnd);
  }

  dayStartSel.addEventListener('change', () => {
    settings.dayStart = +dayStartSel.value;
    if (settings.dayEnd <= settings.dayStart) settings.dayEnd = settings.dayStart + 1;
    saveSettings(); fillRange(); render();
  });

  dayEndSel.addEventListener('change', () => {
    settings.dayEnd = +dayEndSel.value;
    if (settings.dayStart >= settings.dayEnd) settings.dayStart = settings.dayEnd - 1;
    saveSettings(); fillRange(); render();
  });

  $('#clearDay').addEventListener('click', () => {
    if (!state.tasks.length) return;
    if (!confirm('Remove all of today’s tasks?')) return;
    state.tasks = [];
    commit();
  });

  $('#carryBring').addEventListener('click', () => {
    state.tasks.push(...state.carry.map((t) => ({ ...t, id: uid(), start: null, done: false })));
    state.carry = [];
    state.carryFrom = null;
    commit();
  });

  $('#carryDismiss').addEventListener('click', () => {
    state.carry = [];
    state.carryFrom = null;
    commit();
  });

  // ---------- keyboard ----------

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag) { cancelDrag(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || editor.open) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (!typing && (e.key === '/' || e.key === 'n')) {
      e.preventDefault();
      newTitle.focus();
    }
  });

  // ---------- clock, day rollover, other tabs ----------

  function tick() {
    if (dateKey() !== state.date) {
      if (drag) cancelDrag();
      if (editor.open) editor.close();
      state = loadState();
      commit();
      return;
    }
    const m = nowMin();
    if (m === lastMinute) return;
    lastMinute = m;
    renderHeader();
    if (!drag && !draft) renderTimeline();
    else positionNow();
  }

  setInterval(tick, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY && !drag && !draft && !editor.open) { state = loadState(); render(); }
    if (e.key === TODO_KEY) { todos = loadTodos(); renderTodos(); }
    if (e.key === SETTINGS_KEY) { settings = loadSettings(); applyTheme(); fillRange(); render(); }
  });

  // ---------- start ----------

  applyTheme();
  fillRange();
  renderTodos();
  lastMinute = nowMin();
  commit();

  // Side-by-side layout only: if the current time is below the fold, open with it in view.
  if (nowLine && !nowLine.hidden && matchMedia('(min-width: 901px)').matches) {
    const y = nowLine.getBoundingClientRect().top;
    if (y > innerHeight - 100) scrollTo(0, scrollY + y - innerHeight * 0.35);
  }
})();
