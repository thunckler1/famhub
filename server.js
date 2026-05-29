require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const calendarRoutes = require('./routes/calendar');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Trust Cloudflare's proxy headers
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'famhub-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,       // required since we're behind Cloudflare HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
  }
}));

app.use('/auth', authRoutes);
app.use('/api', calendarRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ FamHub running at http://localhost:${PORT}`);
  console.log(`   Public URL: https://hunck.ai\n`);
});
