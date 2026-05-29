const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Shared middleware: require a signed-in Google session
function requireAuth(req, res, next) {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'Not connected to Google Calendar' });
  }
  next();
}

// Redirect to Google login
router.get('/google', (req, res) => {
  const oauth2Client = getOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    prompt: 'consent',
  });
  res.redirect(authUrl);
});

// Google sends user back here after login
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=auth_failed');

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    req.session.tokens = tokens;
    req.session.user = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      connectedAt: new Date().toISOString(),
    };

    console.log(`✅ ${userInfo.name} connected Google Calendar`);
    res.redirect('/?connected=true');
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    res.redirect('/?error=token_failed');
  }
});

// Check connection status
router.get('/status', (req, res) => {
  if (req.session.tokens && req.session.user) {
    res.json({ connected: true, user: req.session.user });
  } else {
    res.json({ connected: false });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
module.exports.getOAuthClient = getOAuthClient;
module.exports.requireAuth = requireAuth;
