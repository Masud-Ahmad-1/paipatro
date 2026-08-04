// ক্যাটাগরি/সাব-ক্যাটাগরি এখন ডেটাবেসে সংরক্ষিত (categories/subcategories টেবিল) —
// এডমিন যেকোনো সময় নতুন ক্যাটাগরি/সাব-ক্যাটাগরি যোগ বা নাম পরিবর্তন করতে পারেন (routes/categories.js, routes/subcategories.js)।
const db = require('../db');

async function isValidCategory(category, subcategory) {
  if (!category) return !subcategory; // ক্যাটাগরি না থাকলে সাব-ক্যাটাগরিও থাকা উচিত না
  const catResult = await db.client.execute({ sql: 'SELECT id FROM categories WHERE name = ?', args: [category] });
  if (catResult.rows.length === 0) return false;
  if (!subcategory) return true;
  const subResult = await db.client.execute({
    sql: 'SELECT id FROM subcategories WHERE category_id = ? AND name = ?',
    args: [catResult.rows[0].id, subcategory],
  });
  return subResult.rows.length > 0;
}

module.exports = { isValidCategory };
