const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'session';
const TOKEN_TTL = '30d';

if (!JWT_SECRET) {
  console.error('মারাত্মক ভুল: .env ফাইলে JWT_SECRET সেট করা নেই। সার্ভার বন্ধ করা হচ্ছে।');
  process.exit(1);
}

function normalizeAuthorPhone() {
  const raw = String(process.env.AUTHOR_PHONE || '').replace(/\D/g, '');
  if (raw.startsWith('880') && raw.length === 13) return '0' + raw.slice(3);
  return raw;
}

function issueToken({ userId, phone }) {
  const isAuthor = !!phone && phone === normalizeAuthorPhone();
  return jwt.sign({ userId, phone, isAuthor }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,          // জাভাস্ক্রিপ্ট থেকে পড়া যাবে না (XSS প্রতিরোধ)
    secure: process.env.NODE_ENV === 'production', // HTTPS-এ বাধ্যতামূলক
    sameSite: 'lax',         // CSRF ঝুঁকি কমায়
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// রিকোয়েস্ট থেকে সেশন পড়ে {userId, phone, isAuthor} রিটার্ন করে, না থাকলে/অবৈধ হলে null
function getSession(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function requireLogin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'অনুগ্রহ করে প্রথমে লগইন করুন।' });
  req.session = session;
  next();
}

function requireAuthor(req, res, next) {
  const session = getSession(req);
  if (!session || !session.isAuthor) {
    return res.status(401).json({ error: 'অননুমোদিত — অনুগ্রহ করে লেখক হিসেবে লগইন করুন।' });
  }
  req.session = session;
  next();
}

module.exports = {
  issueToken, setAuthCookie, clearAuthCookie, getSession,
  requireLogin, requireAuthor, normalizeAuthorPhone, COOKIE_NAME,
};
