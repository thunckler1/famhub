const state = {
  currentDate: new Date(),
  googleConnected: false,
  googleUser: null,
  googleCalendars: [],
  googleEvents: [],
  localEvents: [],
  groceryItems: ['Milk × 2', 'Bread', 'Apples', 'Soccer snacks for Jake'],
  todoItems: ['Book camping site', 'Call Grandma J', 'Get Sofia new shoes'],
  meals: ['Spaghetti night', 'Taco Tuesday', 'Leftovers', "Grandma J's cooking!", 'Pizza Friday', 'BBQ at home', 'Meal prep Sunday'],
};

const DEFAULT_MEMBERS = [
  {key:'dad', name:'Dad', color:'#534ab7'},
  {key:'mom', name:'Mom', color:'#d4537e'},
  {key:'jake', name:'Jake', color:'#1d9e75'},
  {key:'emma', name:'Emma', color:'#d85a30'},
  {key:'liam', name:'Liam', color:'#378add'},
  {key:'sofia', name:'Sofia', color:'#ba7517'},
  {key:'gp1', name:'Grandma & Grandpa J', color:'#888780'},
  {key:'gp2', name:'Grandma & Grandpa M', color:'#639922'},
];
state.members = DEFAULT_MEMBERS.map(m => ({...m}));

function memberColor(key) {
  const m = state.members.find(m => m.key === key);
  return m ? m.color : '#534ab7';
}

async function loadMembers() {
  try {
    const res = await fetch('/api/family');
    const data = await res.json();
    if (Array.isArray(data.members) && data.members.length) state.members = data.members;
  } catch(e) { console.warn('Could not load family:', e.message); }
}

async function saveMembers() {
  const res = await fetch('/api/family', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ members: state.members }),
  });
  if (!res.ok) throw new Error('Save failed');
  const data = await res.json();
  if (Array.isArray(data.members)) state.members = data.members;
}

async function loadLists() {
  try {
    const res = await fetch('/api/lists');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.grocery)) state.groceryItems = data.grocery;
    if (Array.isArray(data.todo)) state.todoItems = data.todo;
  } catch(e) { console.warn('Could not load lists:', e.message); }
}

async function saveLists() {
  const res = await fetch('/api/lists', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grocery: state.groceryItems, todo: state.todoItems }),
  });
  if (!res.ok) throw new Error('Save failed');
}

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected') === 'true') history.replaceState({}, '', '/');
  await checkGoogleStatus();
  renderAll();
  await Promise.all([loadMembers(), loadLists()]);
  renderAll();
});

async function checkGoogleStatus() {
  try {
    const res = await fetch('/auth/status');
    const data = await res.json();
    state.googleConnected = data.connected;
    state.googleUser = data.user || null;
    if (data.connected) {
      await loadGoogleCalendars();
      await loadGoogleEvents();
    }
  } catch(e) { console.warn('Server unreachable:', e.message); }
}

async function loadGoogleCalendars() {
  try {
    const res = await fetch('/api/calendars');
    const data = await res.json();
    state.googleCalendars = data.calendars || [];
    renderCalendarList();
    renderCalendarTargets();
  } catch(e) { console.warn(e.message); }
}

function renderCalendarTargets() {
  const sel = document.getElementById('ev-calendar');
  if (!sel) return;
  const writable = state.googleCalendars.filter(c => c.writable);
  const list = writable.length ? writable : state.googleCalendars;
  sel.innerHTML = list.map(c =>
    `<option value="${c.id}"${c.primary ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');
}

async function loadGoogleEvents() {
  document.getElementById('loading-events').style.display = 'block';
  try {
    const res = await fetch('/api/all-events?days=60');
    const data = await res.json();
    state.googleEvents = data.events || [];
    renderCalendarGrid();
    renderUpcoming();
    renderToday();
  } catch(e) { console.warn(e.message); }
  finally { document.getElementById('loading-events').style.display = 'none'; }
}

function renderHeaderRight() {
  const el = document.getElementById('header-right');
  if (state.googleConnected && state.googleUser) {
    el.innerHTML = `
      <div class="user-chip">
        ${state.googleUser.picture ? `<img class="user-avatar" src="${state.googleUser.picture}" alt="">` : ''}
        <span>${state.googleUser.name || state.googleUser.email}</span>
      </div>
      <a href="/auth/logout"><button class="btn-disconnect">Disconnect</button></a>`;
  } else {
    el.innerHTML = `<a href="/auth/google"><button class="btn-connect">Sign in with Google</button></a>`;
  }
}

function renderGoogleStatus() {
  const el = document.getElementById('google-status');
  if (state.googleConnected && state.googleUser) {
    el.innerHTML = `<div class="google-connected">
      <div class="google-dot"></div>
      <div class="google-info">
        <div class="google-name">Connected</div>
        <div class="google-email">${state.googleUser.email}</div>
      </div></div>`;
    document.getElementById('calendar-list-section').style.display = 'block';
  } else {
    el.innerHTML = `<a href="/auth/google" style="text-decoration:none">
      <button class="btn-google">Connect Google Calendar</button></a>`;
    document.getElementById('calendar-list-section').style.display = 'none';
  }
}

function renderMembers() {
  document.getElementById('member-list').innerHTML = state.members.map(m =>
    `<div class="cal-item"><div class="cal-dot" style="background:${m.color}"></div><span>${escapeHtml(m.name)}</span></div>`
  ).join('');
  const sel = document.getElementById('ev-member');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = state.members.map(m =>
      `<option value="${m.key}">${escapeHtml(m.name)}</option>`
    ).join('');
    if (state.members.some(m => m.key === prev)) sel.value = prev;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderCalendarList() {
  document.getElementById('calendar-list').innerHTML = state.googleCalendars.map(cal =>
    `<div class="cal-item"><div class="cal-dot" style="background:${cal.color}"></div><span>${cal.name}</span></div>`
  ).join('');
}

function renderCalendarGrid() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();
  const today = new Date();
  document.getElementById('cal-month-label').textContent =
    state.currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let html = `<div class="cal-grid">`;
  days.forEach(d => html += `<div class="cal-day-header">${d}</div>`);

  const renderCell = (date, inMonth) => {
    const ds = date.toISOString().slice(0, 10);
    const isToday = date.toDateString() === today.toDateString();
    const evs = [
      ...state.localEvents.filter(e => e.date === ds),
      ...state.googleEvents.filter(e => (e.start||'').slice(0,10) === ds),
    ];
    const shown = evs.slice(0, 3);
    const extra = evs.length - shown.length;
    const pills = shown.map(ev => {
      const color = ev.calendarColor || memberColor(ev.member);
      const r=parseInt(color.slice(1,3),16), g=parseInt(color.slice(3,5),16), b=parseInt(color.slice(5,7),16);
      const bg = `rgba(${r},${g},${b},0.12)`;
      const title = (ev.title||ev.summary||'').slice(0,20);
      return `<div class="event-pill" style="background:${bg};color:${color}">${title}</div>`;
    }).join('');
    return `<div class="cal-day${!inMonth?' other-month':''}${isToday?' today':''}">
      <div class="day-num">${date.getDate()}</div>${pills}
      ${extra > 0 ? `<div class="more-events">+${extra} more</div>` : ''}
    </div>`;
  };

  for (let i = 0; i < firstDay; i++) html += renderCell(new Date(year, month, -(firstDay-i-1)), false);
  for (let d = 1; d <= daysInMonth; d++) html += renderCell(new Date(year, month, d), true);
  const total = firstDay + daysInMonth;
  const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= trailing; i++) html += renderCell(new Date(year, month+1, i), false);

  html += `</div>`;
  document.getElementById('calendar-grid').innerHTML = html;
}

function renderUpcoming() {
  const el = document.getElementById('upcoming-list');
  const now = new Date();
  const upcoming = [
    ...state.localEvents.map(e => ({...e, startStr: e.date+'T'+(e.time||'00:00'), color: memberColor(e.member)})),
    ...state.googleEvents.map(e => ({...e, startStr: e.start, color: e.calendarColor||'#4285f4'})),
  ].filter(e => new Date(e.startStr) >= now)
   .sort((a,b) => new Date(a.startStr) - new Date(b.startStr))
   .slice(0, 5);

  if (!upcoming.length) {
    el.innerHTML = `<p class="muted">${state.googleConnected ? 'No upcoming events.' : 'Connect Google Calendar to see events.'}</p>`;
    return;
  }
  el.innerHTML = upcoming.map(e => {
    const d = new Date(e.startStr);
    const label = d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
    const time = e.allDay ? 'All day' : d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
    const r=parseInt(e.color.slice(1,3),16), g=parseInt(e.color.slice(3,5),16), b=parseInt(e.color.slice(5,7),16);
    return `<div class="upcoming-event" style="border-left-color:${e.color};background:rgba(${r},${g},${b},0.08)">
      <div class="upcoming-title" style="color:${e.color}">${e.title||e.summary||''}</div>
      <div class="upcoming-time">${label} · ${time}</div>
    </div>`;
  }).join('');
}

const pad2 = n => String(n).padStart(2, '0');
const localDateStr = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

// Device location, requested at most once (false = tried and unavailable)
let cachedPos = null;
function getPosition() {
  return new Promise(resolve => {
    if (cachedPos !== null) return resolve(cachedPos || null);
    if (!navigator.geolocation) { cachedPos = false; return resolve(null); }
    navigator.geolocation.getCurrentPosition(
      p => { cachedPos = `${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)}`; resolve(cachedPos); },
      () => { cachedPos = false; resolve(null); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });
}

function todaysEvents() {
  const ds = localDateStr(new Date());
  return [
    ...state.localEvents
      .filter(e => e.date === ds)
      .map(e => ({ title: e.title, start: `${e.date}T${e.time || '00:00'}`, allDay: !e.time, location: e.location, member: e.member })),
    ...state.googleEvents.filter(e => (e.start || '').slice(0,10) === ds),
  ].sort((a,b) => new Date(a.start) - new Date(b.start));
}

function renderToday() {
  const el = document.getElementById('today-cards');
  if (!el) return;
  const now = new Date();
  document.getElementById('today-date').textContent =
    now.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

  const events = todaysEvents();
  if (!events.length) {
    el.innerHTML = `<div class="empty-card">${state.googleConnected
      ? '🎉 Nothing scheduled today.'
      : 'Connect Google Calendar to see today’s events.'}</div>`;
    return;
  }

  el.innerHTML = events.map((ev, i) => {
    const color = ev.calendarColor || memberColor(ev.member) || '#534ab7';
    const start = new Date(ev.start);
    const timeLabel = ev.allDay ? 'All day' : start.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
    const loc = ev.location;
    const dir = loc ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc)}` : null;
    return `<div class="event-card" style="border-left-color:${color}">
      <div class="ec-time">${timeLabel}</div>
      <div class="ec-body">
        <div class="ec-title">${escapeHtml(ev.title || ev.summary || '(No title)')}</div>
        ${loc ? `<div class="ec-loc">📍 ${escapeHtml(loc)}</div>` : ''}
        ${loc && !ev.allDay ? `<div class="ec-travel" id="travel-${i}"></div>` : ''}
      </div>
      ${dir ? `<a class="ec-directions" href="${dir}" target="_blank" rel="noopener">Directions ›</a>` : ''}
    </div>`;
  }).join('');

  fillTravelTimes(events);
}

// Fetch live driving ETAs for upcoming events that have a location
async function fillTravelTimes(events) {
  const targets = events
    .map((ev, i) => ({ ev, i }))
    .filter(x => x.ev.location && !x.ev.allDay && new Date(x.ev.start) > new Date());
  if (!targets.length) return;

  targets.forEach(({ i }) => {
    const c = document.getElementById('travel-' + i);
    if (c) c.innerHTML = '<span class="muted">Checking traffic…</span>';
  });

  const origin = await getPosition();
  if (!origin) {
    targets.forEach(({ i }) => {
      const c = document.getElementById('travel-' + i);
      if (c) c.innerHTML = '<span class="muted">Enable location for live travel time</span>';
    });
    return;
  }

  for (const { ev, i } of targets) {
    const c = document.getElementById('travel-' + i);
    if (!c) continue;
    try {
      const res = await fetch(`/api/travel?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(ev.location)}`);
      if (res.status === 401) { c.innerHTML = '<span class="muted">Sign in for live ETA</span>'; return; }
      const d = await res.json();
      if (!d.available) {  // no Maps key configured — drop chips, stop asking
        targets.forEach(({ i }) => { const x = document.getElementById('travel-' + i); if (x) x.innerHTML = ''; });
        return;
      }
      if (!d.ok) { c.innerHTML = ''; continue; }
      const leaveBy = new Date(new Date(ev.start).getTime() - d.durationSec * 1000);
      const urgent = leaveBy.getTime() - Date.now() < 15 * 60 * 1000;
      const leaveStr = leaveBy.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
      c.innerHTML = `<span class="travel-chip${urgent ? ' urgent' : ''}">🚗 ${d.durationText} · leave by ${leaveStr}</span>`;
    } catch(e) { c.innerHTML = ''; }
  }
}

function renderMeals() {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  document.getElementById('meals-grid').innerHTML = days.map((d,i) =>
    `<div class="meal-day"><div class="meal-day-name">${d}</div><div class="meal-day-content">${state.meals[i]||'—'}</div></div>`
  ).join('');
}

function renderLists() {
  ['grocery','todo'].forEach(type => {
    const items = type === 'grocery' ? state.groceryItems : state.todoItems;
    document.getElementById(type+'-list').innerHTML = items.map(item =>
      `<li onclick="this.classList.toggle('done')"><input type="checkbox"><span>${item}</span></li>`
    ).join('');
  });
}

function showView(name) {
  const views = ['today','calendar','lists','meals'];
  views.forEach(v => {
    document.getElementById('view-'+v).style.display = v === name ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach((btn,i) => {
    btn.classList.toggle('active', views[i] === name);
  });
  if (name === 'today') renderToday();
}

function changeMonth(dir) {
  state.currentDate.setMonth(state.currentDate.getMonth() + dir);
  renderCalendarGrid();
}

function goToday() { state.currentDate = new Date(); renderCalendarGrid(); }

function showAddEvent() {
  document.getElementById('ev-paste').value = '';
  document.getElementById('parse-hint').textContent = '';
  document.getElementById('ev-title').value = '';
  document.getElementById('ev-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('ev-time').value = '09:00';
  document.getElementById('ev-allday').checked = false;
  toggleAllDay();
  document.getElementById('ev-location').value = '';
  document.getElementById('ev-notes').value = '';
  applyRecurrence(null);
  renderCalendarTargets();
  document.getElementById('modal').style.display = 'flex';
  if (!state.googleConnected) {
    document.getElementById('parse-hint').textContent = 'Connect Google Calendar to add events.';
  }
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }

function toggleAllDay() {
  document.getElementById('ev-time').disabled = document.getElementById('ev-allday').checked;
}

function applyParsed(p) {
  if (!p) return;
  if (p.title) document.getElementById('ev-title').value = p.title;
  if (p.date) document.getElementById('ev-date').value = p.date;
  document.getElementById('ev-allday').checked = !!p.allDay;
  toggleAllDay();
  if (!p.allDay && p.time) document.getElementById('ev-time').value = p.time;
  document.getElementById('ev-location').value = p.location || '';
  applyRecurrence(p.recurrence);
}

// Set the Repeats dropdown from a parsed { rrule, label }, adding a custom option when needed
function applyRecurrence(rec) {
  const sel = document.getElementById('ev-repeat');
  sel.querySelectorAll('option[data-custom]').forEach(o => o.remove());
  if (!rec || !rec.rrule) { sel.value = ''; return; }
  const standard = [...sel.options].find(o => o.value === rec.rrule);
  if (standard) { sel.value = rec.rrule; return; }
  const opt = document.createElement('option');
  opt.value = rec.rrule;
  opt.textContent = rec.label || 'Custom repeat';
  opt.dataset.custom = '1';
  sel.add(opt, sel.options[1]);  // right after "Does not repeat"
  sel.value = rec.rrule;
}

// Parse the modal's paste box and fill the form fields
async function parsePaste() {
  const text = document.getElementById('ev-paste').value.trim();
  const hint = document.getElementById('parse-hint');
  if (!text) { hint.textContent = 'Paste or type something first.'; return; }
  hint.textContent = 'Reading…';
  try {
    const res = await fetch('/api/parse-event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.status === 401) { hint.textContent = 'Connect Google Calendar first.'; return; }
    const data = await res.json();
    applyParsed(data.parsed);
    hint.textContent = data.foundDate
      ? '✓ Filled in below — review, then add to calendar.'
      : "Couldn't spot a date — please set it below.";
  } catch(e) { hint.textContent = 'Could not read that. Enter details manually.'; }
}

// Sidebar quick-add: parse pasted text, then open the modal pre-filled to confirm
async function quickAdd() {
  const text = document.getElementById('quick-paste').value.trim();
  if (!text) return;
  showAddEvent();
  document.getElementById('ev-paste').value = text;
  await parsePaste();
  document.getElementById('quick-paste').value = '';
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

let familyDraft = [];

function showFamily() {
  familyDraft = state.members.map(m => ({...m}));
  renderFamilyRows();
  document.getElementById('family-modal').style.display = 'flex';
}

function closeFamily() { document.getElementById('family-modal').style.display = 'none'; }

function renderFamilyRows() {
  document.getElementById('family-rows').innerHTML = familyDraft.map((m, i) =>
    `<div class="family-row">
      <input type="color" value="${m.color}" oninput="familyDraft[${i}].color=this.value">
      <input type="text" class="family-name" value="${escapeHtml(m.name)}" placeholder="Name" oninput="familyDraft[${i}].name=this.value">
      <button class="family-remove" title="Remove" onclick="removeMember(${i})">×</button>
    </div>`
  ).join('');
}

function addMember() {
  const n = familyDraft.length;
  familyDraft.push({key: 'm' + Date.now() + '-' + n, name: '', color: '#534ab7'});
  renderFamilyRows();
}

function removeMember(i) {
  familyDraft.splice(i, 1);
  renderFamilyRows();
}

async function saveFamily() {
  const cleaned = familyDraft
    .map(m => ({...m, name: (m.name || '').trim()}))
    .filter(m => m.name);
  if (!cleaned.length) { alert('Add at least one family member.'); return; }
  state.members = cleaned;
  try {
    await saveMembers();
  } catch(e) {
    alert('Could not save to the server. Please try again.');
    return;
  }
  closeFamily();
  renderMembers();
  renderCalendarGrid();
  renderUpcoming();
}

async function saveEvent() {
  const hint = document.getElementById('parse-hint');
  const title = document.getElementById('ev-title').value.trim();
  const date = document.getElementById('ev-date').value;
  const allDay = document.getElementById('ev-allday').checked;
  const time = allDay ? null : document.getElementById('ev-time').value;
  const location = document.getElementById('ev-location').value.trim();
  const description = document.getElementById('ev-notes').value.trim();
  const calendarId = document.getElementById('ev-calendar').value || 'primary';
  const recurrence = document.getElementById('ev-repeat').value || null;
  if (!title || !date) { hint.textContent = 'Please enter a name and a date.'; return; }

  const btn = document.getElementById('ev-save');
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const res = await fetch('/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId, title, date, time, allDay, location, description, recurrence }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add event');
    closeModal();
    toast('✓ Added to your Google Calendar');
    await loadGoogleEvents();
  } catch(e) {
    hint.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Add to calendar';
  }
}

async function addItem(list) {
  const input = document.getElementById(list+'-input');
  const val = input.value.trim();
  if (!val) return;
  if (list === 'grocery') state.groceryItems.push(val);
  else state.todoItems.push(val);
  input.value = '';
  renderLists();
  try { await saveLists(); }
  catch(e) { alert('Could not save to the server. Please try again.'); }
}

function renderAll() {
  renderHeaderRight();
  renderGoogleStatus();
  renderMembers();
  renderToday();
  renderCalendarGrid();
  renderUpcoming();
  renderLists();
  renderMeals();
}
