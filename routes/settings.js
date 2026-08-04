const express = require('express');
const db = require('../db');
const { requireAuthor } = require('../middleware/auth');

const router = express.Router();

router.use(async (req, res, next) => {
  try { await db.ensureSchema(); next(); } catch (e) { next(e); }
});

// GET /api/settings — সবার জন্য উন্মুক্ত (ব্লগের নাম/ট্যাগলাইন)
router.get('/', async (req, res, next) => {
  try {
    const result = await db.client.execute('SELECT key, value FROM site_settings');
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ blogName: settings.blog_name || 'পাইপত্র', tagline: settings.tagline || '' });
  } catch (e) { next(e); }
});

// PUT /api/settings — শুধু লেখক
router.put('/', requireAuthor, async (req, res, next) => {
  try {
    const { blogName, tagline } = req.body || {};
    if (blogName !== undefined) {
      if (!blogName.trim() || blogName.length > 60) return res.status(400).json({ error: 'ব্লগের নাম সঠিক নয় (১-৬০ অক্ষর)।' });
      await db.client.execute({
        sql: `INSERT INTO site_settings (key, value) VALUES ('blog_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [blogName.trim()],
      });
    }
    if (tagline !== undefined) {
      if (tagline.length > 200) return res.status(400).json({ error: 'ট্যাগলাইন খুব দীর্ঘ (সর্বোচ্চ ২০০ অক্ষর)।' });
      await db.client.execute({
        sql: `INSERT INTO site_settings (key, value) VALUES ('tagline', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [tagline.trim()],
      });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
