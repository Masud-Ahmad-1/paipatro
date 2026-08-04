const express = require('express');
const db = require('../db');
const { requireAuthor } = require('../middleware/auth');
const { fetchTaxonomy } = require('./categories');

const router = express.Router();

router.use(async (req, res, next) => {
  try { await db.ensureSchema(); next(); } catch (e) { next(e); }
});

// PUT /api/subcategories/:id — শুধু লেখক, নাম পরিবর্তন
router.put('/:id', requireAuthor, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 60) return res.status(400).json({ error: 'সাব-ক্যাটাগরির নাম সঠিক নয়।' });
    try {
      const result = await db.client.execute({ sql: 'UPDATE subcategories SET name = ? WHERE id = ?', args: [name, req.params.id] });
      if (Number(result.rowsAffected) === 0) return res.status(404).json({ error: 'সাব-ক্যাটাগরি পাওয়া যায়নি।' });
    } catch (e) {
      if (/unique/i.test(e.message || '')) return res.status(409).json({ error: 'এই নামে সাব-ক্যাটাগরি আগেই আছে।' });
      throw e;
    }
    res.json(await fetchTaxonomy());
  } catch (e) { next(e); }
});

// DELETE /api/subcategories/:id — শুধু লেখক
router.delete('/:id', requireAuthor, async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'DELETE FROM subcategories WHERE id = ?', args: [req.params.id] });
    if (Number(result.rowsAffected) === 0) return res.status(404).json({ error: 'সাব-ক্যাটাগরি পাওয়া যায়নি।' });
    res.json(await fetchTaxonomy());
  } catch (e) { next(e); }
});

module.exports = router;
