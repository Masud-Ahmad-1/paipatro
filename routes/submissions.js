const express = require('express');
const db = require('../db');
const { requireAuthor, requireLogin } = require('../middleware/auth');
const { isValidCategory } = require('../middleware/categories');
const postsRouter = require('./posts');

const router = express.Router();

router.use(async (req, res, next) => {
  try { await db.ensureSchema(); next(); } catch (e) { next(e); }
});

async function validateSubmission(title, excerpt, body, category, subcategory) {
  if (typeof title !== 'string' || !title.trim()) return 'শিরোনাম আবশ্যক।';
  if (title.length > 200) return 'শিরোনাম খুব দীর্ঘ।';
  if (!Array.isArray(body) || body.length === 0 || !body.every(p => typeof p === 'string' && p.trim())) {
    return 'লেখার মূল অংশ আবশ্যক।';
  }
  if (excerpt && typeof excerpt !== 'string') return 'সংক্ষিপ্ত পরিচিতি সঠিক নয়।';
  if (!(await isValidCategory(category || null, subcategory || null))) return 'ক্যাটাগরি/সাব-ক্যাটাগরি সঠিক নয়।';
  return null;
}

// POST /api/submissions — যেকেউ লগইন করা থাকলে লেখা জমা দিতে পারবেন।
// লেখক নিজে জমা দিলে সরাসরি প্রকাশিত হয়ে যায়; অন্য কারও জমা লেখকের অনুমোদনের অপেক্ষায় থাকে।
router.post('/', requireLogin, async (req, res, next) => {
  try {
    const { title, excerpt, body, category, subcategory } = req.body || {};
    const err = await validateSubmission(title, excerpt, body, category, subcategory);
    if (err) return res.status(400).json({ error: err });

    const trimmedBody = body.map(p => p.trim());

    if (req.session.isAuthor) {
      const row = await postsRouter.createPost({ title, excerpt, body: trimmedBody, price: 0, category, subcategory });
      return res.status(201).json({ published: true, ...postsRouter.rowToListItem(row), body: JSON.parse(row.body), locked: false });
    }

    await db.client.execute({
      sql: `INSERT INTO post_submissions (phone, title, excerpt, body, category, subcategory, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [
        req.session.phone, title.trim(),
        (excerpt && excerpt.trim()) || trimmedBody[0].slice(0, 80),
        JSON.stringify(trimmedBody), category || null, subcategory || null, Date.now(),
      ],
    });
    res.status(201).json({ published: false, submitted: true });
  } catch (e) { next(e); }
});

// GET /api/submissions — শুধু লেখক, মুলতুবি জমার তালিকা
router.get('/', requireAuthor, async (req, res, next) => {
  try {
    const status = req.query.status === 'all' ? null : (req.query.status || 'pending');
    const result = status
      ? await db.client.execute({ sql: 'SELECT * FROM post_submissions WHERE status = ? ORDER BY created_at DESC', args: [status] })
      : await db.client.execute('SELECT * FROM post_submissions ORDER BY created_at DESC');

    res.json(result.rows.map(r => ({
      id: r.id,
      phone: r.phone,
      title: r.title,
      excerpt: r.excerpt,
      body: JSON.parse(r.body),
      category: r.category,
      subcategory: r.subcategory,
      status: r.status,
      createdAt: Number(r.created_at),
    })));
  } catch (e) { next(e); }
});

// POST /api/submissions/:id/approve — শুধু লেখক, প্রকাশ করে দেওয়া হয় (ফ্রি হিসেবে; পরে দরকার হলে মূল্য বসিয়ে সম্পাদনা করা যাবে)
router.post('/:id/approve', requireAuthor, async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'SELECT * FROM post_submissions WHERE id = ?', args: [req.params.id] });
    const sub = result.rows[0];
    if (!sub) return res.status(404).json({ error: 'জমাটি পাওয়া যায়নি।' });
    if (sub.status !== 'pending') return res.status(400).json({ error: 'এই জমাটি ইতিমধ্যে প্রক্রিয়াজাত হয়েছে।' });

    const row = await postsRouter.createPost({
      title: sub.title, excerpt: sub.excerpt, body: JSON.parse(sub.body),
      price: 0, category: sub.category, subcategory: sub.subcategory,
    });

    await db.client.execute({
      sql: "UPDATE post_submissions SET status = 'approved', reviewed_at = ? WHERE id = ?",
      args: [Date.now(), req.params.id],
    });

    res.json({ ok: true, postId: row.id });
  } catch (e) { next(e); }
});

// POST /api/submissions/:id/reject — শুধু লেখক
router.post('/:id/reject', requireAuthor, async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'SELECT * FROM post_submissions WHERE id = ?', args: [req.params.id] });
    const sub = result.rows[0];
    if (!sub) return res.status(404).json({ error: 'জমাটি পাওয়া যায়নি।' });
    if (sub.status !== 'pending') return res.status(400).json({ error: 'এই জমাটি ইতিমধ্যে প্রক্রিয়াজাত হয়েছে।' });

    const { note } = req.body || {};
    await db.client.execute({
      sql: "UPDATE post_submissions SET status = 'rejected', reviewed_at = ?, note = ? WHERE id = ?",
      args: [Date.now(), (note || '').slice(0, 200), req.params.id],
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
