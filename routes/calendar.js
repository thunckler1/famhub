const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const chrono = require('chrono-node');
const { getOAuthClient, requireAuth } = require('./auth');

const pad = n => String(n).padStart(2, '0');
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const WD = {
  sunday:'SU', sun:'SU', monday:'MO', mon:'MO', tuesday:'TU', tue:'TU', tues:'TU',
  wednesday:'WE', wed:'WE', thursday:'TH', thu:'TH', thur:'TH', thurs:'TH',
  friday:'FR', fri:'FR', saturday:'SA', sat:'SA',
};
const DAY_NAME = { SU:'Sun', MO:'Mon', TU:'Tue', WE:'Wed', TH:'Thu', FR:'Fri', SA:'Sat' };

function matchDays(t) {
  const out = [];
  const re = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)\b/g;
  let m;
  while ((m = re.exec(t))) { const c = WD[m[1]]; if (c && !out.includes(c)) out.push(c); }
  return out;
}

// RRULE UNTIL needs a UTC timestamp; use end-of-day so the date is inclusive
function rruleUntil(d) {
  const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59));
  return `${u.getUTCFullYear()}${pad(u.getUTCMonth()+1)}${pad(u.getUTCDate())}`
    + `T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}${pad(u.getUTCSeconds())}Z`;
}

function recurrenceLabel(freq, interval, byday, count, until) {
  let base;
  if (freq === 'DAILY') base = interval > 1 ? `Every ${interval} days` : 'Daily';
  else if (freq === 'WEEKLY') {
    const weekdays = byday && byday.length === 5 && ['MO','TU','WE','TH','FR'].every(d => byday.includes(d));
    if (weekdays) base = 'Every weekday';
    else if (byday && byday.length) base = (interval > 1 ? `Every ${interval} weeks on ` : 'Weekly on ')
      + byday.map(d => DAY_NAME[d]).join(', ');
    else base = interval > 1 ? `Every ${interval} weeks` : 'Weekly';
  }
  else if (freq === 'MONTHLY') base = interval > 1 ? `Every ${interval} months` : 'Monthly';
  else base = interval > 1 ? `Every ${interval} years` : 'Yearly';
  if (count) base += `, ${count} times`;
  if (until) base += `, until ${until.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}`;
  return base;
}

// Detect a repeat pattern in free text -> { rrule, label, consumed[], endPhrase }
function detectRecurrence(text) {
  const t = text.toLowerCase();
  let freq = null, interval = 1, byday = null;
  const consumed = [];

  if (/\bevery week ?days?\b/.test(t) || /\bon weekdays?\b/.test(t) || /\bweekdays\b/.test(t)) {
    freq = 'WEEKLY'; byday = ['MO','TU','WE','TH','FR'];
    consumed.push(/\b(?:every |on )?week ?days?\b/ig);
  } else if (/\bevery other\b/.test(t) || /\bbiweekly\b/.test(t) || /\bfortnightly\b/.test(t) || /\bevery (?:2|two) weeks?\b/.test(t)) {
    freq = 'WEEKLY'; interval = 2;
    const days = matchDays(t); if (days.length) byday = days;
    consumed.push(/\bevery other\b/ig, /\bbiweekly\b/ig, /\bfortnightly\b/ig, /\bevery (?:2|two) weeks?\b/ig);
  } else {
    const m = t.match(/\bevery (\d+) (day|week|month|year)s?\b/);
    if (m) {
      interval = parseInt(m[1], 10);
      freq = { day:'DAILY', week:'WEEKLY', month:'MONTHLY', year:'YEARLY' }[m[2]];
      consumed.push(new RegExp(`\\bevery ${m[1]} ${m[2]}s?\\b`, 'ig'));
    }
  }

  if (!freq) {
    const everyDay = /\bevery\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)\b/.test(t);
    if (everyDay) { freq = 'WEEKLY'; byday = matchDays(t); consumed.push(/\bevery\b/ig, /\band\b/ig); }
    else if (/\b(?:daily|every day|each day)\b/.test(t)) { freq = 'DAILY'; consumed.push(/\b(?:daily|every day|each day)\b/ig); }
    else if (/\b(?:weekly|every week|each week)\b/.test(t)) { freq = 'WEEKLY'; consumed.push(/\b(?:weekly|every week|each week)\b/ig); }
    else if (/\b(?:monthly|every month|each month)\b/.test(t)) { freq = 'MONTHLY'; consumed.push(/\b(?:monthly|every month|each month)\b/ig); }
    else if (/\b(?:yearly|annually|every year|each year)\b/.test(t)) { freq = 'YEARLY'; consumed.push(/\b(?:yearly|annually|every year|each year)\b/ig); }
  }
  if (!freq) return null;

  let until = null, count = null, endPhrase = null;
  const untilM = text.match(/\b(?:until|till|thru|through)\s+(.+?)(?:[.,;]|$)/i);
  if (untilM) {
    const d = chrono.parseDate(untilM[1], new Date(), { forwardDate: true });
    if (d) { until = d; endPhrase = untilM[0]; }
  }
  if (!until) {
    const countM = text.match(/\bfor\s+(\d+)\s+(?:times|occurrences)\b/i)
      || text.match(/\b(\d+)\s+(?:times|occurrences)\b/i)
      || text.match(/\bfor\s+(\d+)\s+(?:days|weeks|months|years)\b/i);
    if (countM) { count = parseInt(countM[1], 10); endPhrase = countM[0]; }
  }

  consumed.push(/\bevery\b/ig, /\beach\b/ig);

  let rrule = 'FREQ=' + freq;
  if (interval > 1) rrule += ';INTERVAL=' + interval;
  if (byday && byday.length) rrule += ';BYDAY=' + byday.join(',');
  if (count) rrule += ';COUNT=' + count;
  if (until) rrule += ';UNTIL=' + rruleUntil(until);

  return { rrule, label: recurrenceLabel(freq, interval, byday, count, until), consumed, endPhrase };
}

// Strip lead-in filler so a full sentence reduces to a clean event title
function cleanTitle(s) {
  let t = s.replace(/\ball[\s-]?day\b/i, '').replace(/\s+/g, ' ').trim();
  // Unambiguous reminder lead-ins
  t = t.replace(/^(?:please\s+)?(?:can you\s+)?(?:remind me to|reminder to|remember to|don'?t forget to|i need to|i have to|i've got|i have (?:a|an)|we have (?:a|an)?|we've got (?:a|an)?|there'?s (?:a|an))\s+/i, '');
  // Action verbs only when followed by an article ("book a …", not "Book club")
  t = t.replace(/^(?:schedule|set up|add|book|make|put in|create)\s+(?:a|an|the)\s+/i, '');
  t = t.replace(/^[\s,–-]+/, '');
  // Strip a run of trailing connector words left behind by removed spans
  t = t.replace(/(?:\b(?:on|at|the|a|an|for|to|with)\b\s*)+$/i, '');
  t = t.replace(/[\s,–-]+$/, '').trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

// Turn free-form pasted text into structured event fields
function parseEvent(text) {
  const rec = detectRecurrence(text);
  // Drop the end-condition phrase before chrono runs, so "until June 1" isn't read as the start date
  let work = rec && rec.endPhrase ? text.replace(rec.endPhrase, ' ') : text;

  const results = chrono.parse(work, new Date(), { forwardDate: true });
  let start = null, end = null, allDay = false, remaining = work;
  if (results.length) {
    // Prefer the result that carries a time (multi-day phrases attach the time to one day)
    const chosen = results.find(r => r.start.isCertain('hour')) || results[0];
    start = chosen.start.date();
    allDay = !chosen.start.isCertain('hour');
    if (chosen.end) end = chosen.end.date();
    // Remove parsed date spans so nothing leaks into the title or location, but keep
    // vague time-of-day words ("Date night", "game night") unless they're the chosen time
    const VAGUE = /^(?:morning|afternoon|evening|night|tonight|noon|midnight)$/i;
    const spans = results
      .filter(r => r === chosen || !VAGUE.test(r.text.trim()))
      .map(r => ({ i: r.index, len: r.text.length }))
      .sort((a, b) => b.i - a.i);
    for (const s of spans) remaining = remaining.slice(0, s.i) + ' ' + remaining.slice(s.i + s.len);
    remaining = remaining.replace(/\s+/g, ' ').trim();
  }

  let location = null;
  const locMatch = remaining.match(/\b(?:at|@)\s+(.+)$/i);
  if (locMatch) {
    location = locMatch[1].trim().replace(/[.,;]+$/, '');
    remaining = remaining.slice(0, locMatch.index).trim();
  }

  if (rec) for (const re of rec.consumed) remaining = remaining.replace(re, ' ');

  let title = cleanTitle(remaining);
  if (!title) title = location || text.trim().slice(0, 60) || 'New event';

  return { title, location, start, end, allDay, recurrence: rec ? { rrule: rec.rrule, label: rec.label } : null };
}

function getAuthenticatedClient(req) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials(req.session.tokens);
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) req.session.tokens.refresh_token = tokens.refresh_token;
    req.session.tokens.access_token = tokens.access_token;
    req.session.tokens.expiry_date = tokens.expiry_date;
  });
  return oauth2Client;
}

// Get list of all calendars
router.get('/calendars', requireAuth, async (req, res) => {
  try {
    const auth = getAuthenticatedClient(req);
    const calendar = google.calendar({ version: 'v3', auth });
    const response = await calendar.calendarList.list();
    const calendars = response.data.items.map(cal => ({
      id: cal.id,
      name: cal.summary,
      color: cal.backgroundColor || '#4285F4',
      primary: cal.primary || false,
      writable: cal.accessRole === 'owner' || cal.accessRole === 'writer',
    }));
    res.json({ calendars });
  } catch (err) {
    console.error('Failed to fetch calendars:', err.message);
    res.status(500).json({ error: 'Failed to fetch calendars' });
  }
});

// Get all events from all calendars merged
router.get('/all-events', requireAuth, async (req, res) => {
  try {
    const auth = getAuthenticatedClient(req);
    const calendar = google.calendar({ version: 'v3', auth });
    const days = parseInt(req.query.days) || 60;
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + days);

    const calListResponse = await calendar.calendarList.list();
    const calendars = calListResponse.data.items;

    const allEventPromises = calendars.map(async (cal) => {
      try {
        const evResponse = await calendar.events.list({
          calendarId: cal.id,
          timeMin: now.toISOString(),
          timeMax: future.toISOString(),
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
        });
        return evResponse.data.items.map(event => ({
          id: event.id,
          title: event.summary || '(No title)',
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date,
          allDay: !event.start.dateTime,
          location: event.location || null,
          calendarName: cal.summary,
          calendarColor: cal.backgroundColor || '#4285F4',
          source: 'google',
        }));
      } catch { return []; }
    });

    const allEvents = (await Promise.all(allEventPromises))
      .flat()
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({ events: allEvents, totalCalendars: calendars.length });
  } catch (err) {
    console.error('Failed to fetch events:', err.message);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Parse pasted text into a draft event (preview only — no Google access, no auth needed)
router.post('/parse-event', (req, res) => {
  const text = ((req.body && req.body.text) || '').toString();
  if (!text.trim()) return res.status(400).json({ error: 'No text provided' });
  const p = parseEvent(text);
  res.json({
    foundDate: !!p.start,
    parsed: {
      title: p.title,
      location: p.location,
      date: p.start ? localDate(p.start) : null,
      time: p.start && !p.allDay ? localTime(p.start) : null,
      endTime: p.end && !p.allDay ? localTime(p.end) : null,
      allDay: p.allDay,
      recurrence: p.recurrence,
    },
  });
});

// Create an event in Google Calendar
router.post('/events', requireAuth, async (req, res) => {
  const {
    calendarId = 'primary', title, date, time, endTime, allDay, location, description, recurrence,
  } = req.body || {};
  if (!title || !date) {
    return res.status(400).json({ error: 'Title and date are required' });
  }
  try {
    const auth = getAuthenticatedClient(req);
    const calendar = google.calendar({ version: 'v3', auth });

    let start, end;
    if (allDay || !time) {
      const next = new Date(`${date}T00:00:00`);
      next.setDate(next.getDate() + 1);
      start = { date };
      end = { date: localDate(next) };
    } else {
      let endStr = endTime;
      if (!endStr) {
        const d = new Date(`${date}T${time}:00`);
        d.setHours(d.getHours() + 1);
        endStr = localTime(d);
      }
      start = { dateTime: new Date(`${date}T${time}:00`).toISOString() };
      end = { dateTime: new Date(`${date}T${endStr}:00`).toISOString() };
    }

    const result = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: title,
        location: location || undefined,
        description: description || undefined,
        start,
        end,
        recurrence: recurrence ? ['RRULE:' + String(recurrence).replace(/^RRULE:/i, '')] : undefined,
      },
    });
    res.json({ event: { id: result.data.id, htmlLink: result.data.htmlLink } });
  } catch (err) {
    console.error('Failed to create event:', err.message);
    const insufficient = /insufficient|permission|forbidden|403|scope/i.test(err.message);
    res.status(insufficient ? 403 : 500).json({
      error: insufficient
        ? 'Calendar write access not granted. Please Disconnect and sign in with Google again to allow adding events.'
        : 'Failed to create event',
    });
  }
});

// Google Places autocomplete suggestions for the location field
router.get('/places', requireAuth, async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.json({ available: false, reason: 'no_key', predictions: [] });

  const q = ((req.query.q) || '').toString().trim();
  if (q.length < 3) return res.json({ available: true, predictions: [] });

  try {
    let url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json'
      + '?input=' + encodeURIComponent(q) + '&key=' + key;
    if (req.query.sessiontoken) url += '&sessiontoken=' + encodeURIComponent(req.query.sessiontoken);
    const r = await fetch(url);
    const d = await r.json();
    if (d.status !== 'OK' && d.status !== 'ZERO_RESULTS') {
      console.error('Places autocomplete:', d.status, d.error_message || '');
      return res.json({ available: true, predictions: [], status: d.status, error: d.error_message });
    }
    res.json({
      available: true,
      predictions: (d.predictions || []).slice(0, 5).map(p => ({ description: p.description, placeId: p.place_id })),
    });
  } catch (err) {
    console.error('Places lookup failed:', err.message);
    res.status(500).json({ available: true, predictions: [], error: 'lookup_failed' });
  }
});

// Live driving time from origin to a destination, traffic-aware
router.get('/travel', requireAuth, async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.json({ available: false, reason: 'no_key' });

  const { origin, destination } = req.query;
  if (!origin || !destination) {
    return res.status(400).json({ error: 'origin and destination are required' });
  }
  try {
    const url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
      + `?origins=${encodeURIComponent(origin)}`
      + `&destinations=${encodeURIComponent(destination)}`
      + '&mode=driving&departure_time=now&key=' + key;
    const r = await fetch(url);
    const data = await r.json();
    const el = data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0];
    if (!el || el.status !== 'OK') {
      return res.json({ available: true, ok: false, status: (el && el.status) || data.status });
    }
    const dur = el.duration_in_traffic || el.duration;
    res.json({
      available: true,
      ok: true,
      durationSec: dur.value,
      durationText: dur.text,
      distanceText: el.distance && el.distance.text,
    });
  } catch (err) {
    console.error('Travel lookup failed:', err.message);
    res.status(500).json({ available: true, ok: false, error: 'lookup_failed' });
  }
});

module.exports = router;
