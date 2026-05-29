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

const MEMBER_COLORS = {
  dad:'#534ab7', mom:'#d4537e', jake:'#1d9e75',
  emma:'#d85a30', liam:'#378add', sofia:'#ba7517',
  gp1:'#888780', gp2:'#639922',
};

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected') === 'true') history.replaceState({}, '', '/');
  await checkGoogleStatus();
  renderAll();
  const saved = localStorage.getItem('famhub-lists');
  if (saved) {
    const data = JSON.parse(saved);
    state.groceryItems = data.grocery || state.groceryItems;
    state.todoItems = data.todo || state.todoItems;
  }
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
  } catch(e) { console.warn(e.message); }
}

async function loadGoogleEvents() {
  document.getElementById('loading-events').style.display = 'block';
  try {
    const res = await fetch('/api/all-events?days=60');
    const data = await res.json();
    state.googleEvents = data.events || [];
    renderCalendarGrid();
    renderUpcoming();
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
      const color = ev.calendarColor || MEMBER_COLORS[ev.member] || '#534ab7';
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
    ...state.localEvents.map(e => ({...e, startStr: e.date+'T'+(e.time||'00:00'), color: MEMBER_COLORS[e.member]||'#534ab7'})),
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
  ['calendar','lists','meals'].forEach(v => {
    document.getElementById('view-'+v).style.display = v === name ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach((btn,i) => {
    btn.classList.toggle('active', ['calendar','lists','meals'][i] === name);
  });
}

function changeMonth(dir) {
  state.currentDate.setMonth(state.currentDate.getMonth() + dir);
  renderCalendarGrid();
}

function goToday() { state.currentDate = new Date(); renderCalendarGrid(); }

function showAddEvent() {
  document.getElementById('ev-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('modal').style.display = 'flex';
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }

function saveEvent() {
  const title = document.getElementById('ev-title').value.trim();
  const date = document.getElementById('ev-date').value;
  const time = document.getElementById('ev-time').value;
  const member = document.getElementById('ev-member').value;
  const notes = document.getElementById('ev-notes').value;
  if (!title || !date) return;
  state.localEvents.push({id: Date.now(), title, date, time, member, notes});
  closeModal();
  document.getElementById('ev-title').value = '';
  document.getElementById('ev-notes').value = '';
  renderCalendarGrid();
  renderUpcoming();
}

function addItem(list) {
  const input = document.getElementById(list+'-input');
  const val = input.value.trim();
  if (!val) return;
  if (list === 'grocery') state.groceryItems.push(val);
  else state.todoItems.push(val);
  input.value = '';
  localStorage.setItem('famhub-lists', JSON.stringify({grocery: state.groceryItems, todo: state.todoItems}));
  renderLists();
}

function renderAll() {
  renderHeaderRight();
  renderGoogleStatus();
  renderCalendarGrid();
  renderUpcoming();
  renderLists();
  renderMeals();
}
