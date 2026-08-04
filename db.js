const { createClient } = require('@libsql/client');

// Vercel-এ থাকলে TURSO_DATABASE_URL/TURSO_AUTH_TOKEN বাধ্যতামূলক।
// লোকাল ডেভেলপমেন্টে এগুলো না থাকলে একটি লোকাল ফাইলে libSQL চালানো হয় (Turso ছাড়াই টেস্ট করা যায়)।
const url = process.env.TURSO_DATABASE_URL || 'file:local-dev.db';
const authToken = process.env.TURSO_AUTH_TOKEN; // লোকাল ফাইল মোডে অপ্রয়োজনীয়

const client = createClient({ url, authToken });

let migrated = null;
function ensureSchema() {
  if (!migrated) {
    migrated = (async () => {
      await client.batch([
        `CREATE TABLE IF NOT EXISTS posts (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          excerpt TEXT NOT NULL,
          body TEXT NOT NULL,
          date_display TEXT NOT NULL,
          read_time TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          price_bdt INTEGER NOT NULL DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip TEXT NOT NULL,
          attempted_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts (ip, attempted_at)`,
        `CREATE TABLE IF NOT EXISTS purchases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          buyer_id TEXT NOT NULL,
          post_id TEXT NOT NULL,
          payment_id TEXT,
          amount INTEGER NOT NULL,
          paid_at INTEGER NOT NULL,
          UNIQUE(buyer_id, post_id)
        )`,
        `CREATE TABLE IF NOT EXISTS payments (
          payment_id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL,
          buyer_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS bkash_tokens (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          id_token TEXT,
          refresh_token TEXT,
          expires_at INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS manual_payment_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id TEXT NOT NULL,
          buyer_id TEXT NOT NULL,
          sender_number TEXT NOT NULL,
          trx_id TEXT NOT NULL UNIQUE,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          note TEXT,
          created_at INTEGER NOT NULL,
          reviewed_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_manual_requests_status ON manual_payment_requests (status)`,
        `CREATE TABLE IF NOT EXISTS post_views (
          post_id TEXT NOT NULL,
          buyer_id TEXT NOT NULL,
          day TEXT NOT NULL,
          viewed_at INTEGER NOT NULL,
          PRIMARY KEY (post_id, buyer_id, day)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_post_views_post_day ON post_views (post_id, day)`,
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS subscriptions (
          phone TEXT PRIMARY KEY,
          plan TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS subscription_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          plan TEXT NOT NULL,
          sender_number TEXT NOT NULL,
          trx_id TEXT NOT NULL UNIQUE,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          note TEXT,
          created_at INTEGER NOT NULL,
          reviewed_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_subscription_requests_status ON subscription_requests (status)`,
        `CREATE TABLE IF NOT EXISTS post_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          title TEXT NOT NULL,
          excerpt TEXT NOT NULL,
          body TEXT NOT NULL,
          category TEXT,
          subcategory TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          note TEXT,
          created_at INTEGER NOT NULL,
          reviewed_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_post_submissions_status ON post_submissions (status)`,
        `CREATE TABLE IF NOT EXISTS site_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          sort_order INTEGER NOT NULL DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS subcategories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE(category_id, name)
        )`,
      ], 'write');

      // প্রথমবার চালু হলে ডিফল্ট ব্র্যান্ডিং ও ট্যাক্সোনমি বসানো (আগে থেকে থাকলে ছোঁয়া হয় না)
      const settingsCount = await client.execute('SELECT COUNT(*) as c FROM site_settings');
      if (Number(settingsCount.rows[0].c) === 0) {
        await client.batch([
          { sql: "INSERT INTO site_settings (key, value) VALUES ('blog_name', 'পাইপত্র')" },
          { sql: "INSERT INTO site_settings (key, value) VALUES ('tagline', 'ইতিহাস, অর্থনীতি ও শিক্ষা নিয়ে লেখালেখির একটি খাতা')" },
        ], 'write');
      }
      const catCount = await client.execute('SELECT COUNT(*) as c FROM categories');
      if (Number(catCount.rows[0].c) === 0) {
        const defaultTaxonomy = {
          'ইতিহাস': ['দিনলিপি', 'সংস্কৃতি', 'সভ্যতা', 'জীবনী'],
          'অর্থনীতি': ['অর্থশাস্ত্র', 'ইসলাম', 'সমাজতন্ত্র', 'পুঁজিবাদ'],
          'শিক্ষাবিজ্ঞান': ['শিশুশিক্ষা', 'বয়স্ক শিক্ষা', 'সাধারণ শিক্ষা', 'বিশেষায়িত শিক্ষা', 'সিলেবাস', 'দেশেবিদেশে শিক্ষা'],
        };
        let catOrder = 0;
        for (const [catName, subs] of Object.entries(defaultTaxonomy)) {
          const r = await client.execute({
            sql: 'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
            args: [catName, catOrder++],
          });
          const catId = Number(r.lastInsertRowid);
          let subOrder = 0;
          for (const subName of subs) {
            await client.execute({
              sql: 'INSERT INTO subcategories (category_id, name, sort_order) VALUES (?, ?, ?)',
              args: [catId, subName, subOrder++],
            });
          }
        }
      }

      // posts টেবিল আগে থেকেই থাকলে (এই ফিচারের আগে থেকে ব্যবহৃত হলে) price_bdt কলাম যোগ করা।
      // ইতিমধ্যে কলামটি থাকলে "duplicate column" এরর আসবে, সেটা নিরাপদে উপেক্ষা করা হচ্ছে।
      try {
        await client.execute('ALTER TABLE posts ADD COLUMN price_bdt INTEGER NOT NULL DEFAULT 0');
      } catch (e) {
        if (!/duplicate column/i.test(e.message || '')) throw e;
      }

      // login_attempts টেবিলে scope কলাম (লগইন-রেট-লিমিট বনাম রিস্টোর-রেট-লিমিট আলাদা রাখতে)
      try {
        await client.execute("ALTER TABLE login_attempts ADD COLUMN scope TEXT NOT NULL DEFAULT 'login'");
      } catch (e) {
        if (!/duplicate column/i.test(e.message || '')) throw e;
      }

      // ক্যাটাগরি/সাব-ক্যাটাগরি নেভিগেশনের জন্য কলাম যোগ (পুরনো লেখাগুলোয় NULL থাকবে, "সব লেখা"-তে দেখা যাবে)
      try {
        await client.execute('ALTER TABLE posts ADD COLUMN category TEXT');
      } catch (e) {
        if (!/duplicate column/i.test(e.message || '')) throw e;
      }
      try {
        await client.execute('ALTER TABLE posts ADD COLUMN subcategory TEXT');
      } catch (e) {
        if (!/duplicate column/i.test(e.message || '')) throw e;
      }
    })().catch((e) => { migrated = null; throw e; });
  }
  return migrated;
}

module.exports = { client, ensureSchema };
