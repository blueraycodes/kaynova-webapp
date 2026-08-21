const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { sendOtpSms } = require('../utils/sms');
const { requireCustomer } = require('../middleware/customerAuth');

const OTP_EXPIRY_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_VERIFY_ATTEMPTS = 5;

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').slice(-10); // last 10 digits
}
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

// ---------- LOGIN PAGE ----------
router.get('/login', (req, res) => {
  if (req.session.customerId) return res.redirect('/account/orders');
  res.render('login', { nextUrl: req.query.next || '/account/orders' });
});

// ---------- SEND OTP ----------
router.post('/login/send-otp', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (phone.length !== 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  }

  const recent = db.prepare(`
    SELECT * FROM otp_codes WHERE phone = ? AND created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT 1
  `).get(phone, `-${RESEND_COOLDOWN_SECONDS} seconds`);

  if (recent) {
    return res.status(429).json({ error: `Please wait a few seconds before requesting another OTP.` });
  }

  const code = generateCode();
  db.prepare(`
    INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, datetime('now', ?))
  `).run(phone, code, `+${OTP_EXPIRY_MINUTES} minutes`);

  sendOtpSms(phone, code).catch((err) => console.error('sendOtpSms failed:', err));

  res.json({ success: true, phone });
});

// ---------- VERIFY OTP ----------
router.post('/login/verify-otp', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = (req.body.code || '').trim();

  const otpRow = db.prepare(`
    SELECT * FROM otp_codes WHERE phone = ? AND used = 0 ORDER BY created_at DESC LIMIT 1
  `).get(phone);

  if (!otpRow) {
    return res.status(400).json({ error: 'No OTP request found. Please request a new OTP.' });
  }
  if (otpRow.attempts >= MAX_VERIFY_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new OTP.' });
  }

  const expired = db.prepare(`SELECT datetime('now') > ? AS isExpired`).get(otpRow.expires_at).isExpired;
  if (expired) {
    return res.status(400).json({ error: 'This OTP has expired. Please request a new one.' });
  }

  if (otpRow.code !== code) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
    return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
  }

  // Success — mark OTP used, find or create the customer
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otpRow.id);

  let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (!customer) {
    const info = db.prepare('INSERT INTO customers (phone) VALUES (?)').run(phone);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  }

  req.session.customerId = customer.id;
  req.session.customerPhone = customer.phone;

  res.json({ success: true });
});

// ---------- LOGOUT ----------
router.post('/logout', (req, res) => {
  delete req.session.customerId;
  delete req.session.customerPhone;
  res.redirect('/');
});

// ---------- MY ACCOUNT: PROFILE ----------
router.get('/account', requireCustomer, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.session.customerId);
  res.render('account-profile', { customer, saved: req.query.saved === '1' });
});

router.post('/account', requireCustomer, (req, res) => {
  const { name, email } = req.body;
  db.prepare('UPDATE customers SET name = ?, email = ? WHERE id = ?').run(name || null, email || null, req.session.customerId);
  res.redirect('/account?saved=1');
});

// ---------- MY ACCOUNT: ORDER HISTORY ----------
router.get('/account/orders', requireCustomer, (req, res) => {
  const orders = db.prepare(`
    SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC
  `).all(req.session.customerPhone);
  res.render('account-orders', { orders });
});

router.get('/account/orders/:orderNumber', requireCustomer, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND phone = ?')
    .get(req.params.orderNumber, req.session.customerPhone);
  if (!order) return res.status(404).render('404');

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const timeline = db.prepare('SELECT * FROM shipment_updates WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

  res.render('account-order-detail', { order, items, timeline });
});

module.exports = router;
