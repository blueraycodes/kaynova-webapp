const express = require('express');
const router = express.Router();
const db = require('../db/database');

// ---------- HOME / PRODUCT LISTING ----------
router.get('/', (req, res) => {
  const { category, q } = req.query;
  let sql = `SELECT p.*, c.name AS category_name FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.active = 1`;
  const params = [];

  if (category) {
    sql += ' AND c.name = ?';
    params.push(category);
  }
  if (q) {
    sql += ' AND p.name LIKE ?';
    params.push(`%${q}%`);
  }
  sql += ' ORDER BY p.created_at DESC';

  const products = db.prepare(sql).all(...params);
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('home', { products, categories, activeCategory: category || '', q: q || '' });
});

// ---------- PRODUCT DETAIL ----------
router.get('/product/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);
  if (!product) return res.status(404).render('404');
  res.render('product', { product });
});

// ---------- CART PAGE (cart itself is managed client-side in localStorage) ----------
router.get('/cart', (req, res) => {
  res.render('cart');
});

// ---------- CHECKOUT PAGE ----------
router.get('/checkout', (req, res) => {
  res.render('checkout', { razorpayKeyId: process.env.RAZORPAY_KEY_ID, customer: res.locals.customer });
});

// ---------- ORDER SUCCESS PAGE ----------
router.get('/order-success/:orderNumber', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(req.params.orderNumber);
  if (!order) return res.status(404).render('404');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('order-success', { order, items });
});

// ---------- CONSIGNMENT / SHIPMENT TRACKING ----------
router.get('/track', (req, res) => {
  res.render('track', { order: null, items: null, timeline: null, error: null, submitted: false });
});

router.post('/track', (req, res) => {
  const { identifier } = req.body; // order number OR tracking number
  const order = db.prepare(`
    SELECT * FROM orders WHERE order_number = ? OR tracking_number = ?
  `).get(identifier, identifier);

  if (!order) {
    return res.render('track', { order: null, items: null, timeline: null, error: 'No order found for that Order ID / Tracking Number.', submitted: true });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const timeline = db.prepare('SELECT * FROM shipment_updates WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

  res.render('track', { order, items, timeline, error: null, submitted: true });
});

module.exports = router;
