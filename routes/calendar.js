const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const chrono = require('chrono-node');
const { getOAuthClient, requireAuth } = require('./auth');

const pad = n => String(n).padStart(2, '0');
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Turn free-form pasted text into structured event fields
function parseEvent(text) {
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  let start = null, end = null, allDay = false, remaining = text;
  if (results.length) {
    const r = results[0];
    start = r.start.date();
    allDay = !r.start.isCertain('hour');
    if (r.end) end = r.end.date();
    remaining = (text.slice(0, r.index) + ' ' + text.slice(r.index + r.text.length))
      .replace(/\s+/g, ' ').trim();
  }
  let location = null;
  const locMatch = remaining.match(/\b(?:at|@)\s+(.+)$/i);
  if (locMatch) {
    location = locMatch[1].trim().replace(/[.,;]+$/, '');
    remaining = remaining.slice(0, locMatch.index).trim();
  }
  let title = remaining.replace(/\ball[\s-]?day\b/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,–-]+|[\s,–-]+$/g, '')
    .replace(/\b(?:on|at|the)\s*$/i, '').trim();
  if (!title) title = location || text.trim().slice(0, 60) || 'New event';
  return { title, location, start, end, allDay };
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
    },
  });
});

// Create an event in Google Calendar
router.post('/events', requireAuth, async (req, res) => {
  const {
    calendarId = 'primary', title, date, time, endTime, allDay, location, description,
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
