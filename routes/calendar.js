const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { getOAuthClient } = require('./auth');

function requireAuth(req, res, next) {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'Not connected to Google Calendar' });
  }
  next();
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

module.exports = router;
