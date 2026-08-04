require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const paymentRoutes = require('./routes/payments');
const submissionRoutes = require('./routes/submissions');
const subscriptionRoutes = require('./routes/subscriptions');
const settingsRoutes = require('./routes/settings');
const categoryRoutes = require('./routes/categories');
const subcategoryRoutes = require('./routes/subcategories');
const { ensureBuyerId } = require('./middleware/buyer');

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel/Render-এর মতো প্ল্যাটফর্মে অ্যাপ একটি প্রক্সির পেছনে চলে —
// req.ip সঠিকভাবে পেতে (রেট-লিমিটিং-এর জন্য জরুরি) এটি প্রয়োজন।
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', ensureBuyerId, authRoutes);
app.use('/api/posts', ensureBuyerId, postRoutes);
app.use('/api/payments', ensureBuyerId, paymentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/subcategories', subcategoryRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// অন্য কোনো রুট না মিললে ফ্রন্টএন্ড দিন (SPA fallback) — লোকাল/VPS চালানোর জন্য।
// Vercel-এ public/ সরাসরি স্ট্যাটিক হোস্টিং থেকে সার্ভ হয়, তাই এখানে সাধারণত পৌঁছায় না।
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message = status < 500 ? (err.message || 'অনুরোধটি সম্পন্ন করা যায়নি।') : (err.status ? err.message : 'সার্ভারে একটি সমস্যা হয়েছে।');
  res.status(status).json({ error: message || 'সার্ভারে একটি সমস্যা হয়েছে।' });
});

// লোকালি "node server.js" দিয়ে সরাসরি চালালে সার্ভার চালু হবে (VPS/Render-এর জন্য)।
// Vercel serverless function থেকে ইমপোর্ট করা হলে (api/index.js), শুধু app এক্সপোর্ট হবে —
// listen() কল হবে না, কারণ Vercel নিজেই রিকোয়েস্ট হ্যান্ডলিং সামলায়।
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`পাইপত্র সার্ভার চলছে: http://localhost:${PORT}`);
  });
}

module.exports = app;
