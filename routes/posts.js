const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuthor, getSession } = require('../middleware/auth');
const { dayBucket, monthBucket } = require('../middleware/dateBucket');
const { isValidCategory } = require('../middleware/categories');
const { formatBnDate, estimateReadTime } = require('../middleware/postFormat');

const router = express.Router();

function rowToListItem(row) {
  const price = Number(row.price_bdt) || 0;
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    date: row.date_display,
    readTime: row.read_time,
    price,
    isPaid: price > 0,
    category: row.category || null,
    subcategory: row.subcategory || null,
    totalViews: row.total_views !== undefined ? Number(row.total_views) : undefined,
    viewsToday: row.views_today !== undefined ? Number(row.views_today) : undefined,
    viewsMonth: row.views_month !== undefined ? Number(row.views_month) : undefined,
  };
}

async function validateInput(title, excerpt, body, price, category, subcategory) {
  if (typeof title !== 'string' || !title.trim()) return 'শিরোনাম আবশ্যক।';
  if (title.length > 200) return 'শিরোনাম খুব দীর্ঘ।';
  if (!Array.isArray(body) || body.length === 0 || !body.every(p => typeof p === 'string' && p.trim())) {
    return 'লেখার মূল অংশ আবশ্যক।';
  }
  if (excerpt && typeof excerpt !== 'string') return 'সংক্ষিপ্ত পরিচিতি সঠিক নয়।';
  if (price !== undefined && price !== null && price !== '') {
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return 'মূল্য সঠিক নয় (০ থেকে ১,০০,০০০ টাকার মধ্যে দিন)।';
  }
  if (!(await isValidCategory(category || null, subcategory || null))) return 'ক্যাটাগরি/সাব-ক্যাটাগরি সঠিক নয়।';
  return null;
}

// posts টেবিলে সরাসরি একটা নতুন লেখা ঢোকানো — routes/submissions.js-ও এটা পুনরায় ব্যবহার করে
// (লেখক নিজে জমা দিলে সরাসরি প্রকাশ, বা অন্য কারও জমা অনুমোদনের সময়)
async function createPost({ title, excerpt, body, price, category, subcategory }) {
  const trimmedBody = body.map(p => p.trim());
  const id = 'post-' + nanoid(10);
  const dateDisplay = formatBnDate(new Date());
  const readTime = estimateReadTime(trimmedBody);
  const finalExcerpt = (excerpt && excerpt.trim()) || trimmedBody[0].slice(0, 80);
  const priceBdt = price ? Math.round(Number(price)) : 0;

  await db.client.execute({
    sql: `INSERT INTO posts (id, title, excerpt, body, date_display, read_time, created_at, price_bdt, category, subcategory)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, title.trim(), finalExcerpt, JSON.stringify(trimmedBody), dateDisplay, readTime, Date.now(), priceBdt, category || null, subcategory || null],
  });

  const result = await db.client.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [id] });
  return result.rows[0];
}

async function recordView(postId, buyerId) {
  try {
    const today = dayBucket();
    await db.client.execute({
      sql: `INSERT INTO post_views (post_id, buyer_id, day, viewed_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(post_id, buyer_id, day) DO NOTHING`,
      args: [postId, buyerId, today, Date.now()],
    });
  } catch (e) {
    console.error('view logging failed', e); // ভিউ-লগিং ব্যর্থ হলেও পাঠকের অভিজ্ঞতা ব্যাহত হওয়া উচিত না
  }
}

// এই ফোন নম্বরের বর্তমানে সক্রিয় সাবস্ক্রিপশন আছে কিনা
async function hasActiveSubscription(phone) {
  if (!phone) return false;
  const result = await db.client.execute({
    sql: 'SELECT 1 FROM subscriptions WHERE phone = ? AND expires_at > ?',
    args: [phone, Date.now()],
  });
  return result.rows.length > 0;
}

// প্রতিটি রিকোয়েস্টের আগে স্কিমা আছে কিনা নিশ্চিত করা (idempotent, ওয়ার্ম ইনভোকেশনে ক্যাশড)
router.use(async (req, res, next) => {
  try { await db.ensureSchema(); next(); } catch (e) { next(e); }
});

// GET /api/posts — সবার জন্য উন্মুক্ত (শুধু তালিকা, মূল লেখা নয়) — সাথে ভিউ-কাউন্ট (লেখকের UI-তে দেখানো হয়)
router.get('/', async (req, res, next) => {
  try {
    const today = dayBucket();
    const month = monthBucket();
    const result = await db.client.execute({
      sql: `SELECT p.*,
              (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id) AS total_views,
              (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id AND v.day = ?) AS views_today,
              (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id AND substr(v.day,1,7) = ?) AS views_month
            FROM posts p ORDER BY p.created_at DESC`,
      args: [today, month],
    });
    res.json(result.rows.map(rowToListItem));
  } catch (e) { next(e); }
});

// GET /api/posts/search?q=... — সার্চ
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim().slice(0, 200);
    if (!q) return res.json([]);
    const pattern = '%' + q.replace(/[%_]/g, c => c === '%' ? '\\%' : '\\_') + '%';
    const today = dayBucket();
    const month = monthBucket();
    const result = await db.client.execute({
      sql: `SELECT p.*,
              (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id) AS total_views,
              (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id AND v.day = ?) AS views_today,
              (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id AND substr(v.day,1,7) = ?) AS views_month
            FROM posts p
            WHERE p.title LIKE ? OR p.excerpt LIKE ?
            ORDER BY p.created_at DESC LIMIT 50`,
      args: [today, month, pattern, pattern],
    });
    res.json(result.rows.map(rowToListItem));
  } catch (e) { next(e); }
});

// GET /api/posts/:id — ফ্রি হলে সম্পূর্ণ, পেইড হলে কেনা/সাবস্ক্রিপশন থাকলেই সম্পূর্ণ, নাহলে শুধু প্রিভিউ
router.get('/:id', async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [req.params.id] });
    if (result.rows.length === 0) return res.status(404).json({ error: 'লেখাটি পাওয়া যায়নি।' });
    const row = result.rows[0];
    const price = Number(row.price_bdt) || 0;

    const base = rowToListItem(row);
    recordView(row.id, req.buyerId); // fire-and-forget, রেসপন্সের গতি কমাবে না

    const session = getSession(req);
    if (price === 0 || session?.isAuthor) {
      return res.json({ ...base, body: JSON.parse(row.body), locked: false });
    }

    if (session?.phone && await hasActiveSubscription(session.phone)) {
      return res.json({ ...base, body: JSON.parse(row.body), locked: false });
    }

    const purchase = await db.client.execute({
      sql: 'SELECT 1 FROM purchases WHERE buyer_id = ? AND post_id = ?',
      args: [req.buyerId, row.id],
    });
    const unlocked = purchase.rows.length > 0;

    if (unlocked) {
      return res.json({ ...base, body: JSON.parse(row.body), locked: false });
    }
    res.json({ ...base, body: null, locked: true });
  } catch (e) { next(e); }
});

// GET /api/posts/:id/stats — শুধু লেখক, দৈনিক/মাসিক ভিউ ব্রেকডাউন
router.get('/:id/stats', requireAuthor, async (req, res, next) => {
  try {
    const postResult = await db.client.execute({ sql: 'SELECT id, title FROM posts WHERE id = ?', args: [req.params.id] });
    if (postResult.rows.length === 0) return res.status(404).json({ error: 'লেখাটি পাওয়া যায়নি।' });

    const totalResult = await db.client.execute({ sql: 'SELECT COUNT(*) as c FROM post_views WHERE post_id = ?', args: [req.params.id] });
    const dailyResult = await db.client.execute({
      sql: `SELECT day, COUNT(*) as c FROM post_views WHERE post_id = ? GROUP BY day ORDER BY day DESC LIMIT 14`,
      args: [req.params.id],
    });
    const monthlyResult = await db.client.execute({
      sql: `SELECT substr(day,1,7) as month, COUNT(*) as c FROM post_views WHERE post_id = ? GROUP BY month ORDER BY month DESC LIMIT 6`,
      args: [req.params.id],
    });

    res.json({
      postId: req.params.id,
      postTitle: postResult.rows[0].title,
      total: Number(totalResult.rows[0].c),
      today: dayBucket(),
      thisMonth: monthBucket(),
      daily: dailyResult.rows.map(r => ({ date: r.day, count: Number(r.c) })),
      monthly: monthlyResult.rows.map(r => ({ month: r.month, count: Number(r.c) })),
    });
  } catch (e) { next(e); }
});

// POST /api/posts — শুধু লেখক (সরাসরি প্রকাশ)। অন্য যে-কেউ লেখা জমা দিতে চাইলে POST /api/submissions ব্যবহার করবে।
router.post('/', requireAuthor, async (req, res, next) => {
  try {
    const { title, excerpt, body, price, category, subcategory } = req.body || {};
    const err = await validateInput(title, excerpt, body, price, category, subcategory);
    if (err) return res.status(400).json({ error: err });

    const row = await createPost({ title, excerpt, body, price, category, subcategory });
    res.status(201).json({ ...rowToListItem(row), body: JSON.parse(row.body), locked: false });
  } catch (e) { next(e); }
});

// PUT /api/posts/:id — শুধু লেখক
router.put('/:id', requireAuthor, async (req, res, next) => {
  try {
    const existing = await db.client.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [req.params.id] });
    if (existing.rows.length === 0) return res.status(404).json({ error: 'লেখাটি পাওয়া যায়নি।' });

    const { title, excerpt, body, price, category, subcategory } = req.body || {};
    const err = await validateInput(title, excerpt, body, price, category, subcategory);
    if (err) return res.status(400).json({ error: err });

    const trimmedBody = body.map(p => p.trim());
    const readTime = estimateReadTime(trimmedBody);
    const finalExcerpt = (excerpt && excerpt.trim()) || trimmedBody[0].slice(0, 80);
    const priceBdt = price ? Math.round(Number(price)) : 0;

    await db.client.execute({
      sql: 'UPDATE posts SET title = ?, excerpt = ?, body = ?, read_time = ?, price_bdt = ?, category = ?, subcategory = ? WHERE id = ?',
      args: [title.trim(), finalExcerpt, JSON.stringify(trimmedBody), readTime, priceBdt, category || null, subcategory || null, req.params.id],
    });

    const result = await db.client.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [req.params.id] });
    res.json({ ...rowToListItem(result.rows[0]), body: trimmedBody, locked: false });
  } catch (e) { next(e); }
});

// DELETE /api/posts/:id — শুধু লেখক
router.delete('/:id', requireAuthor, async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'DELETE FROM posts WHERE id = ?', args: [req.params.id] });
    if (Number(result.rowsAffected) === 0) return res.status(404).json({ error: 'লেখাটি পাওয়া যায়নি।' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.createPost = createPost;
module.exports.validateInput = validateInput;
module.exports.rowToListItem = rowToListItem;
