// bKash Tokenized Checkout ইন্টিগ্রেশন
//
// ⚠️ গুরুত্বপূর্ণ: এই মডিউলটি bKash-এর অফিসিয়াল ডকুমেন্টেশন (developer.bka.sh/reference,
// "Tokenized Checkout") অনুযায়ী লেখা হয়েছে, কিন্তু bKash-এর সার্ভারে সরাসরি সংযোগ করে
// টেস্ট করা সম্ভব হয়নি (নেটওয়ার্ক সীমাবদ্ধতার কারণে)। লাইভ করার আগে অবশ্যই
// sandbox-এ পুরো ফ্লো নিজে টেস্ট করে নিন। এন্ডপয়েন্ট/রেসপন্স গঠনে সামান্য
// পার্থক্য থাকলে developer.bka.sh/reference দেখে এই ফাইলটা মিলিয়ে নিন।

const db = require('../db');

const BASE_URL = process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
const USERNAME = process.env.BKASH_USERNAME;
const PASSWORD = process.env.BKASH_PASSWORD;
const APP_KEY = process.env.BKASH_APP_KEY;
const APP_SECRET = process.env.BKASH_APP_SECRET;

function assertConfigured() {
  if (!USERNAME || !PASSWORD || !APP_KEY || !APP_SECRET) {
    const err = new Error('bKash কনফিগার করা হয়নি — BKASH_USERNAME, BKASH_PASSWORD, BKASH_APP_KEY, BKASH_APP_SECRET এনভায়রনমেন্ট ভেরিয়েবল দিন।');
    err.status = 500;
    throw err;
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data && (data.errorMessage || data.message)) || `bKash API ব্যর্থ: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function grantToken() {
  const data = await fetchJson(`${BASE_URL}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username: USERNAME,
      password: PASSWORD,
    },
    body: JSON.stringify({ app_key: APP_KEY, app_secret: APP_SECRET }),
  });
  return data; // { id_token, refresh_token, expires_in, ... }
}

async function refreshToken(refresh_token) {
  const data = await fetchJson(`${BASE_URL}/tokenized/checkout/token/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username: USERNAME,
      password: PASSWORD,
    },
    body: JSON.stringify({ app_key: APP_KEY, app_secret: APP_SECRET, refresh_token }),
  });
  return data;
}

// id_token DB-তে ক্যাশ করে রাখা হয় (bkash_tokens টেবিলে, একটাই সারি) —
// সার্ভারলেস পরিবেশে প্রতিটি ইনভোকেশন আলাদা মেমরিতে চলে বলে in-memory ক্যাশ কাজ করবে না।
async function getValidToken() {
  assertConfigured();
  await db.ensureSchema();

  const result = await db.client.execute('SELECT * FROM bkash_tokens WHERE id = 1');
  const row = result.rows[0];
  const now = Date.now();
  const SAFETY_MARGIN = 60 * 1000; // মেয়াদ শেষ হওয়ার ১ মিনিট আগেই রিফ্রেশ করা

  if (row && row.id_token && Number(row.expires_at) > now + SAFETY_MARGIN) {
    return row.id_token;
  }

  let tokenData;
  if (row && row.refresh_token) {
    try {
      tokenData = await refreshToken(row.refresh_token);
    } catch (e) {
      tokenData = await grantToken(); // রিফ্রেশ ব্যর্থ হলে নতুন করে গ্রান্ট করা
    }
  } else {
    tokenData = await grantToken();
  }

  const expiresAt = now + (Number(tokenData.expires_in || 3600) * 1000);
  await db.client.execute({
    sql: `INSERT INTO bkash_tokens (id, id_token, refresh_token, expires_at) VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET id_token = excluded.id_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`,
    args: [tokenData.id_token, tokenData.refresh_token, expiresAt],
  });

  return tokenData.id_token;
}

async function createPayment({ amount, merchantInvoiceNumber, payerReference, callbackURL }) {
  const idToken = await getValidToken();
  return fetchJson(`${BASE_URL}/tokenized/checkout/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      authorization: idToken,
      'x-app-key': APP_KEY,
    },
    body: JSON.stringify({
      mode: '0011',
      payerReference: String(payerReference).slice(0, 20) || '01',
      callbackURL,
      amount: String(amount),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber,
    }),
  });
}

async function executePayment(paymentID) {
  const idToken = await getValidToken();
  return fetchJson(`${BASE_URL}/tokenized/checkout/execute/${encodeURIComponent(paymentID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      authorization: idToken,
      'x-app-key': APP_KEY,
    },
  });
}

module.exports = { createPayment, executePayment };
