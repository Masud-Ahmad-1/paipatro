const db = require('../db');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

async function isRateLimited(ip, scope = 'login') {
  await db.ensureSchema();
  const windowStart = Date.now() - WINDOW_MS;
  const result = await db.client.execute({
    sql: 'SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND scope = ? AND attempted_at > ?',
    args: [ip, scope, windowStart],
  });
  const count = Number(result.rows[0].c);
  return count >= MAX_ATTEMPTS;
}

async function recordAttempt(ip, scope = 'login') {
  await db.ensureSchema();
  await db.client.execute({
    sql: 'INSERT INTO login_attempts (ip, scope, attempted_at) VALUES (?, ?, ?)',
    args: [ip, scope, Date.now()],
  });
  // পুরনো এন্ট্রি পরিষ্কার রাখা (২৪ ঘণ্টার বেশি পুরনো)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  await db.client.execute({
    sql: 'DELETE FROM login_attempts WHERE attempted_at < ?',
    args: [cutoff],
  });
}

module.exports = { isRateLimited, recordAttempt };
