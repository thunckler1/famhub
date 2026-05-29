const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LISTS_FILE = path.join(DATA_DIR, 'lists.json');

const DEFAULT_LISTS = {
  grocery: ['Milk × 2', 'Bread', 'Apples', 'Soccer snacks for Jake'],
  todo: ['Book camping site', 'Call Grandma J', 'Get Sofia new shoes'],
};

function readLists() {
  try {
    const data = JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8'));
    return {
      grocery: Array.isArray(data.grocery) ? data.grocery : DEFAULT_LISTS.grocery,
      todo: Array.isArray(data.todo) ? data.todo : DEFAULT_LISTS.todo,
    };
  } catch { /* no file yet or unreadable — fall back to defaults */ }
  return DEFAULT_LISTS;
}

function writeLists(lists) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LISTS_FILE, JSON.stringify(lists, null, 2));
}

const cleanItems = arr => Array.isArray(arr)
  ? arr.filter(x => typeof x === 'string').map(x => x.trim().slice(0, 200)).filter(Boolean)
  : [];

// Get the shared grocery / to-do lists
router.get('/lists', requireAuth, (req, res) => {
  res.json(readLists());
});

// Replace the shared grocery / to-do lists
router.put('/lists', requireAuth, (req, res) => {
  const body = req.body || {};
  const lists = { grocery: cleanItems(body.grocery), todo: cleanItems(body.todo) };
  try {
    writeLists(lists);
    res.json(lists);
  } catch (err) {
    console.error('Failed to save lists:', err.message);
    res.status(500).json({ error: 'Failed to save lists' });
  }
});

module.exports = router;
