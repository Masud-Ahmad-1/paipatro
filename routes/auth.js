const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { issueToken, setAuthCookie, clearAuthCookie, getSession, normalizeAuthorPhone } = require('../middleware/auth');
const { isRateLimited, recordAttempt } = require('../middleware/rateLimit');
const { normalizeBdPhone, restorePurchasesByPhone } = require('../middleware/restore');

const router = express.Router();

function validatePhonePassword(phone, password) {
  if (!phone || phone.length < 10 || phone.length > 14) return 'সঠিক ফোন নম্বর দিন।';
  if (!password || typeof password !== 'string' || password.length < 8) return 'পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে।';
  return null;
}

// POST /api/auth/register — যেকেউ (লেখক বা পাঠক) নতুন অ্যাকাউন্ট খুলতে পারবেন
router.post('/register', async (req, res, next) => {
  try {
    await db.ensureSchema();
    const ip = req.ip || 'unknown';
    if (await isRateLimited(ip, 'login')) {
      return res.status(429).json({ error: 'অনেকবার চেষ্টা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।' });
    }

    const phone = normalizeBdPhone(req.body?.phone);
    const password = req.body?.password;
    const err = validatePhonePassword(phone, password);
    if (err) return res.status(400).json({ error: err });

    const existing = await db.client.execute({ sql: 'SELECT id FROM users WHERE phone = ?', args: [phone] });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'এই নম্বর দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট আছে। লগইন করুন।' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.client.execute({
      sql: 'INSERT INTO users (phone, password_hash, created_at) VALUES (?, ?, ?)',
      args: [phone, passwordHash, Date.now()],
    });
    const userId = Number(result.lastInsertRowid);

    const token = issueToken({ userId, phone });
    setAuthCookie(res, token);

    // এই ফোন নম্বরে আগে (অ্যাকাউন্ট খোলার আগে) কোনো অনুমোদিত কেনাকাটা থাকলে সেটা এখনই যুক্ত করে দেওয়া
    if (req.buyerId) await restorePurchasesByPhone(phone, req.buyerId).catch(() => {});

    res.status(201).json({ ok: true, isAuthor: phone === normalizeAuthorPhone() });
  } catch (e) { next(e); }
});

// POST /api/auth/login — ফোন + পাসওয়ার্ড দিয়ে
router.post('/login', async (req, res, next) => {
  try {
    await db.ensureSchema();
    const ip = req.ip || 'unknown';
    if (await isRateLimited(ip, 'login')) {
      return res.status(429).json({ error: 'অনেকবার ভুল চেষ্টা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।' });
    }

    const phone = normalizeBdPhone(req.body?.phone);
    const password = req.body?.password;
    if (!phone || !password) {
      return res.status(400).json({ error: 'ফোন নম্বর ও পাসওয়ার্ড আবশ্যক।' });
    }

    const result = await db.client.execute({ sql: 'SELECT * FROM users WHERE phone = ?', args: [phone] });
    const user = result.rows[0];
    if (!user) {
      await recordAttempt(ip, 'login');
      return res.status(401).json({ error: 'এই নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি। নতুন অ্যাকাউন্ট খুলুন।' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await recordAttempt(ip, 'login');
      return res.status(401).json({ error: 'পাসওয়ার্ড সঠিক নয়।' });
    }

    const token = issueToken({ userId: user.id, phone });
    setAuthCookie(res, token);

    if (req.buyerId) await restorePurchasesByPhone(phone, req.buyerId).catch(() => {});

    res.json({ ok: true, isAuthor: phone === normalizeAuthorPhone() });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ loggedIn: false, isAuthor: false });
  res.json({ loggedIn: true, isAuthor: !!session.isAuthor, phone: session.phone });
});

module.exports = router;
