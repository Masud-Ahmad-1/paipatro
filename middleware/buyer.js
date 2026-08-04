const crypto = require('crypto');

const BUYER_COOKIE = 'buyer_id';
const BUYER_COOKIE_MAX_AGE = 5 * 365 * 24 * 60 * 60 * 1000; // ৫ বছর

// প্রতিটি ভিজিটরকে একটা বেনামী পরিচয় দেওয়া হয় (কোনো লগইন/অ্যাকাউন্ট ছাড়াই),
// শুধু "এই ভিজিটর কোন কোন লেখা কিনেছে" তা মনে রাখতে। এটা কোনো ব্যক্তিগত তথ্য বহন করে না।
function ensureBuyerId(req, res, next) {
  let buyerId = req.cookies[BUYER_COOKIE];
  if (!buyerId) {
    buyerId = crypto.randomUUID();
    res.cookie(BUYER_COOKIE, buyerId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: BUYER_COOKIE_MAX_AGE,
      path: '/',
    });
  }
  req.buyerId = buyerId;
  next();
}

module.exports = { ensureBuyerId, BUYER_COOKIE };
