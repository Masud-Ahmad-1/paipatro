const express = require('express');
const db = require('../db');
const { requireAuthor } = require('../middleware/auth');

const router = express.Router();

router.use(async (req, res, next) => {
  try { await db.ensureSchema(); next(); } catch (e) { next(e); }
});

async function fetchTaxonomy() {
  const cats = await db.client.execute('SELECT * FROM categories ORDER BY sort_order, id');
  const subs = await db.client.execute('SELECT * FROM subcategories ORDER BY sort_order, id');
  return cats.rows.map(c => ({
    id: c.id,
    name: c.name,
    subcategories: subs.rows.filter(s => Number(s.category_id) === Number(c.id)).map(s => ({ id: s.id, name: s.name })),
  }));
}

// GET /api/categories — সবার জন্য উন্মুক্ত
router.get('/', async (req, res, next) => {
  try {
    res.json(await fetchTaxonomy());
  } catch (e) { next(e); }
});

// POST /api/categories — শুধু লেখক, নতুন প্রধান ক্যাটাগরি
router.post('/', requireAuthor, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 60) return res.status(400).json({ error: 'ক্যাটাগরির নাম সঠিক নয়।' });

    const maxOrder = await db.client.execute('SELECT MAX(sort_order) as m FROM categories');
    const order = (Number(maxOrder.rows[0].m) || 0) + 1;

    try {
      await db.client.execute({ sql: 'INSERT INTO categories (name, sort_order) VALUES (?, ?)', args: [name, order] });
    } catch (e) {
      if (/unique/i.test(e.message || '')) return res.status(409).json({ error: 'এই নামে ক্যাটাগরি আগেই আছে।' });
      throw e;
    }
    res.status(201).json(await fetchTaxonomy());
  } catch (e) { next(e); }
});

// PUT /api/categories/:id — শুধু লেখক, নাম পরিবর্তন
router.put('/:id', requireAuthor, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 60) return res.status(400).json({ error: 'ক্যাটাগরির নাম সঠিক নয়।' });
    try {
      const result = await db.client.execute({ sql: 'UPDATE categories SET name = ? WHERE id = ?', args: [name, req.params.id] });
      if (Number(result.rowsAffected) === 0) return res.status(404).json({ error: 'ক্যাটাগরি পাওয়া যায়নি।' });
    } catch (e) {
      if (/unique/i.test(e.message || '')) return res.status(409).json({ error: 'এই নামে ক্যাটাগরি আগেই আছে।' });
      throw e;
    }
    res.json(await fetchTaxonomy());
  } catch (e) { next(e); }
});

// DELETE /api/categories/:id — শুধু লেখক (আগে প্রকাশিত লেখায় ক্যাটাগরির নাম টেক্সট হিসেবে থেকে যাবে, বদলাবে না)
router.delete('/:id', requireAuthor, async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'DELETE FROM categories WHERE id = ?', args: [req.params.id] });
    if (Number(result.rowsAffected) === 0) return res.status(404).json({ error: 'ক্যাটাগরি পাওয়া যায়নি।' });
    res.json(await fetchTaxonomy());
  } catch (e) { next(e); }
});

// POST /api/categories/:id/subcategories — শুধু লেখক
router.post('/:id/subcategories', requireAuthor, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 60) return res.status(400).json({ error: 'সাব-ক্যাটাগরির নাম সঠিক নয়।' });

    const cat = await db.client.execute({ sql: 'SELECT id FROM categories WHERE id = ?', args: [req.params.id] });
    if (cat.rows.length === 0) return res.status(404).json({ error: 'ক্যাটাগরি পাওয়া যায়নি।' });

    const maxOrder = await db.client.execute({ sql: 'SELECT MAX(sort_order) as m FROM subcategories WHERE category_id = ?', args: [req.params.id] });
    const order = (Number(maxOrder.rows[0].m) || 0) + 1;

    try {
      await db.client.execute({
        sql: 'INSERT INTO subcategories (category_id, name, sort_order) VALUES (?, ?, ?)',
        args: [req.params.id, name, order],
      });
    } catch (e) {
      if (/unique/i.test(e.message || '')) return res.status(409).json({ error: 'এই নামে সাব-ক্যাটাগরি আগেই আছে।' });
      throw e;
    }
    res.status(201).json(await fetchTaxonomy());
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.fetchTaxonomy = fetchTaxonomy;
