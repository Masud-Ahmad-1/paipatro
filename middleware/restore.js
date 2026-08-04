const db = require('../db');

// +৮৮০/৮৮০ কান্ট্রি কোড থাকলে সরিয়ে স্থানীয় ফরম্যাটে (0-দিয়ে শুরু) আনা হচ্ছে,
// যাতে "+8801755512345" আর "01755512345" একই নম্বর হিসেবে মেলে
function normalizeBdPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('880') && digits.length === 13) {
    digits = '0' + digits.slice(3);
  }
  return digits;
}

// এই ফোন নম্বর দিয়ে অনুমোদিত (approved) যত ম্যানুয়াল পেমেন্ট আছে, সেগুলো
// বর্তমান buyer_id-এর সাথে যুক্ত করে দেওয়া — লগইন করলে বা ম্যানুয়ালি "ফিরিয়ে আনুন" চাপলে দুই জায়গা থেকেই ব্যবহৃত হয়।
async function restorePurchasesByPhone(phone, buyerId) {
  await db.ensureSchema();
  const approved = await db.client.execute({
    sql: `SELECT DISTINCT post_id, trx_id, amount FROM manual_payment_requests
          WHERE sender_number = ? AND status = 'approved'`,
    args: [phone],
  });

  let restoredCount = 0;
  for (const row of approved.rows) {
    const result = await db.client.execute({
      sql: `INSERT INTO purchases (buyer_id, post_id, payment_id, amount, paid_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(buyer_id, post_id) DO NOTHING`,
      args: [buyerId, row.post_id, row.trx_id, row.amount, Date.now()],
    });
    if (Number(result.rowsAffected) > 0) restoredCount++;
  }
  return { restoredCount, totalFound: approved.rows.length };
}

module.exports = { normalizeBdPhone, restorePurchasesByPhone };
