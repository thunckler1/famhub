const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FAMILY_FILE = path.join(DATA_DIR, 'family.json');

const DEFAULT_MEMBERS = [
  { key: 'dad', name: 'Dad', color: '#534ab7' },
  { key: 'mom', name: 'Mom', color: '#d4537e' },
  { key: 'jake', name: 'Jake', color: '#1d9e75' },
  { key: 'emma', name: 'Emma', color: '#d85a30' },
  { key: 'liam', name: 'Liam', color: '#378add' },
  { key: 'sofia', name: 'Sofia', color: '#ba7517' },
  { key: 'gp1', name: 'Grandma & Grandpa J', color: '#888780' },
  { key: 'gp2', name: 'Grandma & Grandpa M', color: '#639922' },
];

function readMembers() {
  try {
    const data = JSON.parse(fs.readFileSync(FAMILY_FILE, 'utf8'));
    if (Array.isArray(data) && data.length) return data;
  } catch { /* no file yet or unreadable — fall back to defaults */ }
  return DEFAULT_MEMBERS;
}

function writeMembers(members) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FAMILY_FILE, JSON.stringify(members, null, 2));
}

// Get the shared family roster
router.get('/family', requireAuth, (req, res) => {
  res.json({ members: readMembers() });
});

// Replace the shared family roster
router.put('/family', requireAuth, (req, res) => {
  const incoming = req.body && req.body.members;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'members must be an array' });
  }
  const cleaned = incoming
    .filter(m => m && typeof m.name === 'string')
    .map((m, i) => ({
      key: String(m.key || `m${i}`),
      name: m.name.trim().slice(0, 60),
      color: /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : '#534ab7',
    }))
    .filter(m => m.name);
  if (!cleaned.length) {
    return res.status(400).json({ error: 'at least one member required' });
  }
  try {
    writeMembers(cleaned);
    res.json({ members: cleaned });
  } catch (err) {
    console.error('Failed to save family:', err.message);
    res.status(500).json({ error: 'Failed to save family' });
  }
});

module.exports = router;
