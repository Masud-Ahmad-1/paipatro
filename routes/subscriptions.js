const express = require('express');
const db = require('../db');
const { requireAuthor, requireLogin } = require('../middleware/auth');
const { isRateLimited, recordAttempt } = require('../middleware/rateLimit');
const { normalizeBdPhone } = require('../middleware/restore');
const { PLANS } = require('../middleware/plans');

const router = express.Router();

router.use(async (req, res, next) => {
  try { await db.ensureSchema(); next(); } catch (e) { next(e); }
});

// GET /api/subscriptions/plans — সবার জন্য উন্মুক্ত
router.get('/plans', (req, res) => {
  res.json({ plans: PLANS, sendMoneyNumber: process.env.BKASH_SEND_MONEY_NUMBER || null });
});

// GET /api/subscriptions/me — লগইন করা থাকলে বর্তমান সাবস্ক্রিপশনের অবস্থা
router.get('/me', requireLogin, async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'SELECT * FROM subscriptions WHERE phone = ?', args: [req.session.phone] });
    const sub = result.rows[0];
    const active = sub && Number(sub.expires_at) > Date.now();
    res.json({
      active: !!active,
      plan: active ? sub.plan : null,
      expiresAt: active ? Number(sub.expires_at) : null,
    });
  } catch (e) { next(e); }
});

// POST /api/subscriptions/submit — {plan, senderNumber, trxId}
router.post('/submit', requireLogin, async (req, res, next) => {
  try {
    const { plan, senderNumber, trxId } = req.body || {};
    if (!PLANS[plan]) return res.status(400).json({ error: 'সঠিক প্ল্যান বেছে নিন।' });

    const phone = normalizeBdPhone(senderNumber);
    if (phone.length < 10 || phone.length > 14) return res.status(400).json({ error: 'সঠিক bKash নম্বর দিন।' });

    const trx = String(trxId || '').trim().toUpperCase();
    if (!trx || trx.length < 4 || trx.length > 30) return res.status(400).json({ error: 'সঠিক ট্রানজেকশন আইডি (TrxID) দিন।' });

    try {
      await db.client.execute({
        sql: `INSERT INTO subscription_requests (phone, plan, sender_number, trx_id, amount, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        args: [req.session.phone, plan, phone, trx, PLANS[plan].amount, Date.now()],
      });
    } catch (e) {
      if (/unique/i.test(e.message || '')) {
        return res.status(409).json({ error: 'এই ট্রানজেকশন আইডি (TrxID) আগেই ব্যবহার করা হয়েছে।' });
      }
      throw e;
    }

    res.status(201).json({ submitted: true });
  } catch (e) { next(e); }
});

// GET /api/subscriptions/requests — শুধু লেখক
router.get('/requests', requireAuthor, async (req, res, next) => {
  try {
    const status = req.query.status === 'all' ? null : (req.query.status || 'pending');
    const result = status
      ? await db.client.execute({ sql: 'SELECT * FROM subscription_requests WHERE status = ? ORDER BY created_at DESC', args: [status] })
      : await db.client.execute('SELECT * FROM subscription_requests ORDER BY created_at DESC');

    res.json(result.rows.map(r => ({
      id: r.id,
      phone: r.phone,
      plan: r.plan,
      planLabel: PLANS[r.plan]?.label || r.plan,
      senderNumber: r.sender_number,
      trxId: r.trx_id,
      amount: Number(r.amount),
      status: r.status,
      createdAt: Number(r.created_at),
    })));
  } catch (e) { next(e); }
});

// POST /api/subscriptions/:id/approve — শুধু লেখক; বর্তমান মেয়াদ সক্রিয় থাকলে তার শেষ থেকে নতুন মেয়াদ যোগ হয়
router.post('/:id/approve', requireAuthor, async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'SELECT * FROM subscription_requests WHERE id = ?', args: [req.params.id] });
    const reqRow = result.rows[0];
    if (!reqRow) return res.status(404).json({ error: 'অনুরোধটি পাওয়া যায়নি।' });
    if (reqRow.status !== 'pending') return res.status(400).json({ error: 'এই অনুরোধটি ইতিমধ্যে প্রক্রিয়াজাত হয়েছে।' });

    const plan = PLANS[reqRow.plan];
    if (!plan) return res.status(400).json({ error: 'অজানা প্ল্যান।' });

    const existing = await db.client.execute({ sql: 'SELECT * FROM subscriptions WHERE phone = ?', args: [reqRow.phone] });
    const now = Date.now();
    const currentExpiry = existing.rows[0] ? Number(existing.rows[0].expires_at) : 0;
    const startFrom = currentExpiry > now ? currentExpiry : now; // চলমান মেয়াদ থাকলে তার পরে যোগ হবে, নাহলে আজ থেকে
    const newExpiry = startFrom + plan.days * 24 * 60 * 60 * 1000;

    await db.client.batch([
      {
        sql: "UPDATE subscription_requests SET status = 'approved', reviewed_at = ? WHERE id = ?",
        args: [now, req.params.id],
      },
      {
        sql: `INSERT INTO subscriptions (phone, plan, started_at, expires_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(phone) DO UPDATE SET plan = excluded.plan, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
        args: [reqRow.phone, reqRow.plan, existing.rows[0] ? Number(existing.rows[0].started_at) : now, newExpiry, now],
      },
    ], 'write');

    res.json({ ok: true, expiresAt: newExpiry });
  } catch (e) { next(e); }
});

// POST /api/subscriptions/:id/reject — শুধু লেখক
router.post('/:id/reject', requireAuthor, async (req, res, next) => {
  try {
    const result = await db.client.execute({ sql: 'SELECT * FROM subscription_requests WHERE id = ?', args: [req.params.id] });
    const reqRow = result.rows[0];
    if (!reqRow) return res.status(404).json({ error: 'অনুরোধটি পাওয়া যায়নি।' });
    if (reqRow.status !== 'pending') return res.status(400).json({ error: 'এই অনুরোধটি ইতিমধ্যে প্রক্রিয়াজাত হয়েছে।' });

    const { note } = req.body || {};
    await db.client.execute({
      sql: "UPDATE subscription_requests SET status = 'rejected', reviewed_at = ?, note = ? WHERE id = ?",
      args: [Date.now(), (note || '').slice(0, 200), req.params.id],
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/subscriptions/subscribers — শুধু লেখক, বর্তমানে সক্রিয় সাবস্ক্রাইবারদের তালিকা
router.get('/subscribers', requireAuthor, async (req, res, next) => {
  try {
    const result = await db.client.execute({
      sql: 'SELECT * FROM subscriptions WHERE expires_at > ? ORDER BY expires_at DESC',
      args: [Date.now()],
    });
    res.json(result.rows.map(r => ({
      phone: r.phone,
      plan: r.plan,
      planLabel: PLANS[r.plan]?.label || r.plan,
      startedAt: Number(r.started_at),
      expiresAt: Number(r.expires_at),
    })));
  } catch (e) { next(e); }
});

module.exports = router;
