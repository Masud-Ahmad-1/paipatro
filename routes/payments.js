const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const bkash = require('../middleware/bkash');
const { requireAuthor, requireLogin } = require('../middleware/auth');
const { isRateLimited, recordAttempt } = require('../middleware/rateLimit');
const { normalizeBdPhone, restorePurchasesByPhone } = require('../middleware/restore');

const router = express.Router();

function siteBaseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

// POST /api/payments/bkash/create — নির্দিষ্ট একটি লেখার জন্য পেমেন্ট শুরু করা
router.post('/bkash/create', async (req, res, next) => {
  try {
    await db.ensureSchema();
    const { postId } = req.body || {};
    if (!postId) return res.status(400).json({ error: 'postId আবশ্যক।' });

    const postResult = await db.client.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [postId] });
    const post = postResult.rows[0];
    if (!post) return res.status(404).json({ error: 'লেখাটি পাওয়া যায়নি।' });

    const price = Number(post.price_bdt);
    if (!price || price <= 0) return res.status(400).json({ error: 'এই লেখাটি ইতিমধ্যে ফ্রি।' });

    // ইতিমধ্যে কেনা থাকলে আবার পেমেন্ট শুরু করার দরকার নেই
    const already = await db.client.execute({
      sql: 'SELECT 1 FROM purchases WHERE buyer_id = ? AND post_id = ?',
      args: [req.buyerId, postId],
    });
    if (already.rows.length > 0) {
      return res.json({ alreadyPurchased: true });
    }

    const merchantInvoiceNumber = 'INV-' + nanoid(10);
    const callbackURL = `${siteBaseUrl(req)}/api/payments/bkash/callback`;

    const payment = await bkash.createPayment({
      amount: price,
      merchantInvoiceNumber,
      payerReference: req.buyerId,
      callbackURL,
    });

    if (!payment.paymentID || !payment.bkashURL) {
      return res.status(502).json({ error: 'bKash থেকে বৈধ রেসপন্স পাওয়া যায়নি।' });
    }

    await db.client.execute({
      sql: `INSERT INTO payments (payment_id, post_id, buyer_id, amount, status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)`,
      args: [payment.paymentID, postId, req.buyerId, price, Date.now()],
    });

    res.json({ bkashURL: payment.bkashURL, paymentID: payment.paymentID });
  } catch (e) {
    next(e);
  }
});

// GET /api/payments/bkash/callback — bKash এখানে ইউজারের ব্রাউজারকে রিডাইরেক্ট করে পেমেন্টের পর
router.get('/bkash/callback', async (req, res, next) => {
  try {
    await db.ensureSchema();
    const { paymentID, status } = req.query;
    const base = siteBaseUrl(req);

    if (!paymentID) {
      return res.redirect(`${base}/?payment=failed`);
    }

    const paymentResult = await db.client.execute({ sql: 'SELECT * FROM payments WHERE payment_id = ?', args: [paymentID] });
    const paymentRow = paymentResult.rows[0];
    if (!paymentRow) {
      return res.redirect(`${base}/?payment=failed`);
    }

    if (status !== 'success') {
      await db.client.execute({
        sql: "UPDATE payments SET status = ? WHERE payment_id = ?",
        args: [status === 'cancel' ? 'cancelled' : 'failed', paymentID],
      });
      return res.redirect(`${base}/?post=${encodeURIComponent(paymentRow.post_id)}&payment=failed`);
    }

    const result = await bkash.executePayment(paymentID);

    if (result.transactionStatus === 'Completed') {
      await db.client.batch([
        {
          sql: "UPDATE payments SET status = 'completed' WHERE payment_id = ?",
          args: [paymentID],
        },
        {
          sql: `INSERT INTO purchases (buyer_id, post_id, payment_id, amount, paid_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(buyer_id, post_id) DO NOTHING`,
          args: [paymentRow.buyer_id, paymentRow.post_id, paymentID, paymentRow.amount, Date.now()],
        },
      ], 'write');
      return res.redirect(`${base}/?post=${encodeURIComponent(paymentRow.post_id)}&payment=success`);
    }

    await db.client.execute({
      sql: "UPDATE payments SET status = 'failed' WHERE payment_id = ?",
      args: [paymentID],
    });
    res.redirect(`${base}/?post=${encodeURIComponent(paymentRow.post_id)}&payment=failed`);
  } catch (e) {
    next(e);
  }
});

// ==================================================================
// Manual "Send Money" ভেরিফিকেশন ফ্লো
// bKash Merchant/PGW অ্যাকাউন্ট না থাকা পর্যন্ত এটাই মূল পেমেন্ট পদ্ধতি —
// পাঠক ব্যক্তিগত bKash নম্বরে Send Money করবে, তারপর ট্রানজেকশন আইডি জমা দেবে,
// লেখক নিজের bKash অ্যাপে মিলিয়ে দেখে ম্যানুয়ালি অনুমোদন করবেন।
// ==================================================================



// GET /api/payments/manual/config — সবার জন্য উন্মুক্ত, শুধু bKash নম্বরটা দেখানোর জন্য
router.get('/manual/config', (req, res) => {
  res.json({ sendMoneyNumber: process.env.BKASH_SEND_MONEY_NUMBER || null });
});

// POST /api/payments/manual/submit — পাঠক TrxID জমা দেন
router.post('/manual/submit', async (req, res, next) => {
  try {
    await db.ensureSchema();
    const { postId, senderNumber, trxId } = req.body || {};

    if (!postId) return res.status(400).json({ error: 'postId আবশ্যক।' });
    const phone = normalizeBdPhone(senderNumber);
    if (phone.length < 10 || phone.length > 14) {
      return res.status(400).json({ error: 'সঠিক bKash নম্বর দিন।' });
    }
    const trx = String(trxId || '').trim().toUpperCase();
    if (!trx || trx.length < 4 || trx.length > 30) {
      return res.status(400).json({ error: 'সঠিক ট্রানজেকশন আইডি (TrxID) দিন।' });
    }

    const postResult = await db.client.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [postId] });
    const post = postResult.rows[0];
    if (!post) return res.status(404).json({ error: 'লেখাটি পাওয়া যায়নি।' });

    const price = Number(post.price_bdt);
    if (!price || price <= 0) return res.status(400).json({ error: 'এই লেখাটি ইতিমধ্যে ফ্রি।' });

    const already = await db.client.execute({
      sql: 'SELECT 1 FROM purchases WHERE buyer_id = ? AND post_id = ?',
      args: [req.buyerId, postId],
    });
    if (already.rows.length > 0) return res.json({ alreadyPurchased: true });

    try {
      await db.client.execute({
        sql: `INSERT INTO manual_payment_requests (post_id, buyer_id, sender_number, trx_id, amount, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        args: [postId, req.buyerId, phone, trx, price, Date.now()],
      });
    } catch (e) {
      if (/unique/i.test(e.message || '')) {
        return res.status(409).json({ error: 'এই ট্রানজেকশন আইডি (TrxID) আগেই ব্যবহার করা হয়েছে।' });
      }
      throw e;
    }

    res.status(201).json({ submitted: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/payments/manual/requests — শুধু লেখক, মুলতুবি/সব অনুরোধের তালিকা
router.get('/manual/requests', requireAuthor, async (req, res, next) => {
  try {
    await db.ensureSchema();
    const status = req.query.status === 'all' ? null : (req.query.status || 'pending');
    const sql = status
      ? `SELECT r.*, p.title AS post_title FROM manual_payment_requests r
         JOIN posts p ON p.id = r.post_id WHERE r.status = ? ORDER BY r.created_at DESC`
      : `SELECT r.*, p.title AS post_title FROM manual_payment_requests r
         JOIN posts p ON p.id = r.post_id ORDER BY r.created_at DESC`;
    const result = status
      ? await db.client.execute({ sql, args: [status] })
      : await db.client.execute(sql);

    res.json(result.rows.map(r => ({
      id: r.id,
      postId: r.post_id,
      postTitle: r.post_title,
      senderNumber: r.sender_number,
      trxId: r.trx_id,
      amount: r.amount,
      status: r.status,
      createdAt: Number(r.created_at),
    })));
  } catch (e) { next(e); }
});

// POST /api/payments/manual/:id/approve — শুধু লেখক
router.post('/manual/:id/approve', requireAuthor, async (req, res, next) => {
  try {
    await db.ensureSchema();
    const result = await db.client.execute({ sql: 'SELECT * FROM manual_payment_requests WHERE id = ?', args: [req.params.id] });
    const reqRow = result.rows[0];
    if (!reqRow) return res.status(404).json({ error: 'অনুরোধটি পাওয়া যায়নি।' });
    if (reqRow.status !== 'pending') return res.status(400).json({ error: 'এই অনুরোধটি ইতিমধ্যে প্রক্রিয়াজাত হয়েছে।' });

    await db.client.batch([
      {
        sql: "UPDATE manual_payment_requests SET status = 'approved', reviewed_at = ? WHERE id = ?",
        args: [Date.now(), req.params.id],
      },
      {
        sql: `INSERT INTO purchases (buyer_id, post_id, payment_id, amount, paid_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(buyer_id, post_id) DO NOTHING`,
        args: [reqRow.buyer_id, reqRow.post_id, reqRow.trx_id, reqRow.amount, Date.now()],
      },
    ], 'write');

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/payments/manual/:id/reject — শুধু লেখক
router.post('/manual/:id/reject', requireAuthor, async (req, res, next) => {
  try {
    await db.ensureSchema();
    const result = await db.client.execute({ sql: 'SELECT * FROM manual_payment_requests WHERE id = ?', args: [req.params.id] });
    const reqRow = result.rows[0];
    if (!reqRow) return res.status(404).json({ error: 'অনুরোধটি পাওয়া যায়নি।' });
    if (reqRow.status !== 'pending') return res.status(400).json({ error: 'এই অনুরোধটি ইতিমধ্যে প্রক্রিয়াজাত হয়েছে।' });

    const { note } = req.body || {};
    await db.client.execute({
      sql: "UPDATE manual_payment_requests SET status = 'rejected', reviewed_at = ?, note = ? WHERE id = ?",
      args: [Date.now(), (note || '').slice(0, 200), req.params.id],
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ==================================================================
// "আমার কেনা লেখা" ও ব্রাউজার-বদল রিকভারি
// ==================================================================

// GET /api/payments/purchases — শুধু লগইন করা থাকলে (লেখক বা পাঠক, যে কেউ), বর্তমান অ্যাকাউন্টের কেনা লেখার তালিকা
router.get('/purchases', requireLogin, async (req, res, next) => {
  try {
    await db.ensureSchema();
    const result = await db.client.execute({
      sql: `SELECT pu.post_id, pu.amount, pu.paid_at, p.title, p.excerpt, p.date_display, p.read_time
            FROM purchases pu JOIN posts p ON p.id = pu.post_id
            WHERE pu.buyer_id = ? ORDER BY pu.paid_at DESC`,
      args: [req.buyerId],
    });
    res.json(result.rows.map(r => ({
      postId: r.post_id,
      title: r.title,
      excerpt: r.excerpt,
      date: r.date_display,
      readTime: r.read_time,
      amount: Number(r.amount),
      paidAt: Number(r.paid_at),
    })));
  } catch (e) { next(e); }
});

// POST /api/payments/restore — ফোন নম্বর দিয়ে আগের ব্রাউজারে কেনা লেখা এই ব্রাউজারে ফিরিয়ে আনা।
// লগইন করা থাকলে সাধারণত এটা লাগবে না (লগইনের সময় স্বয়ংক্রিয়ভাবেই হয়ে যায়) — অতিরিক্ত/ব্যাকআপ পথ হিসেবে রাখা হলো।
router.post('/restore', async (req, res, next) => {
  try {
    await db.ensureSchema();
    const ip = req.ip || 'unknown';
    if (await isRateLimited(ip, 'restore')) {
      return res.status(429).json({ error: 'অনেকবার চেষ্টা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।' });
    }
    await recordAttempt(ip, 'restore');

    const phone = normalizeBdPhone(req.body?.phone);
    if (phone.length < 10 || phone.length > 14) {
      return res.status(400).json({ error: 'সঠিক bKash নম্বর দিন।' });
    }

    const { restoredCount, totalFound } = await restorePurchasesByPhone(phone, req.buyerId);
    res.json({ restoredCount, totalFound });
  } catch (e) { next(e); }
});

module.exports = router;
