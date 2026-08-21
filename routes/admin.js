const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// ---------- FILE UPLOAD (product images) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_')),
});
const upload = multer({ storage });

// ================= AUTH =================
router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  res.render('admin/login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.render('admin/login', { error: 'Invalid username or password' });
  }
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.redirect('/admin/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// All routes below require admin login
router.use(requireAdmin);

// ================= DASHBOARD =================
router.get('/dashboard', (req, res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  const totalOrders = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const paidOrders = db.prepare(`SELECT COUNT(*) c FROM orders WHERE payment_status = 'paid'`).get().c;
  const revenue = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) r FROM orders WHERE payment_status = 'paid'`).get().r;
  const pendingShipments = db.prepare(`
    SELECT COUNT(*) c FROM orders WHERE payment_status = 'paid' AND order_status NOT IN ('delivered','cancelled','returned')
  `).get().c;
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8').all();

  res.render('admin/dashboard', {
    totalProducts, totalOrders, paidOrders, revenue, pendingShipments, recentOrders,
    adminUsername: req.session.adminUsername,
  });
});

// ================= PRODUCTS =================
router.get('/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    ORDER BY p.created_at DESC
  `).all();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/products', { products, categories, adminUsername: req.session.adminUsername });
});

router.get('/products/new', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/product-form', { product: null, categories, adminUsername: req.session.adminUsername });
});

router.post('/products/new', upload.single('image_file'), (req, res) => {
  const { name, description, price, stock, category_id, image_url } = req.body;
  const finalImage = req.file ? '/uploads/' + req.file.filename : (image_url || '');
  db.prepare(`
    INSERT INTO products (name, description, price, image_url, stock, category_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, description, parseFloat(price), finalImage, parseInt(stock, 10), category_id || null);
  res.redirect('/admin/products');
});

router.get('/products/:id/edit', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).send('Product not found');
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/product-form', { product, categories, adminUsername: req.session.adminUsername });
});

router.post('/products/:id/edit', upload.single('image_file'), (req, res) => {
  const { name, description, price, stock, category_id, image_url, active } = req.body;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  const finalImage = req.file ? '/uploads/' + req.file.filename : (image_url || existing.image_url);
  db.prepare(`
    UPDATE products SET name=?, description=?, price=?, image_url=?, stock=?, category_id=?, active=?
    WHERE id = ?
  `).run(name, description, parseFloat(price), finalImage, parseInt(stock, 10), category_id || null, active ? 1 : 0, req.params.id);
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.redirect('/admin/products');
});

// ================= CATEGORIES =================
router.post('/categories/new', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/admin/products');
  try {
    db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
  } catch (e) { /* ignore duplicates */ }
  res.redirect('/admin/products');
});

router.post('/categories/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  const name = (req.body.name || '').trim();
  if (!id || !name) return res.redirect('/admin/products');
  try {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
  } catch (e) { /* ignore duplicates */ }
  res.redirect('/admin/products');
});

router.post('/categories/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.redirect('/admin/products');

  try {
    db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  } catch (e) {
    console.error('Delete category error:', e);
  }

  res.redirect('/admin/products');
});

// ================= ORDERS & CONSIGNMENT TRACKING =================
router.get('/orders', (req, res) => {
  const { status, payment } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND order_status = ?'; params.push(status); }
  if (payment) { sql += ' AND payment_status = ?'; params.push(payment); }
  sql += ' ORDER BY created_at DESC';
  const orders = db.prepare(sql).all(...params);
  res.render('admin/orders', { orders, status: status || '', payment: payment || '', adminUsername: req.session.adminUsername });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).send('Order not found');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const timeline = db.prepare('SELECT * FROM shipment_updates WHERE order_id = ? ORDER BY created_at ASC').all(order.id);
  res.render('admin/order-detail', { order, items, timeline, adminUsername: req.session.adminUsername });
});

const ORDER_STATUSES = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'];

router.post('/orders/:id/status', (req, res) => {
  const { order_status, tracking_number, courier_name, location, note } = req.body;
  if (!ORDER_STATUSES.includes(order_status)) return res.status(400).send('Invalid status');

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE orders SET order_status = ?, tracking_number = COALESCE(NULLIF(?, ''), tracking_number),
      courier_name = COALESCE(NULLIF(?, ''), courier_name) WHERE id = ?
    `).run(order_status, tracking_number, courier_name, req.params.id);

    const statusLabel = order_status.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    db.prepare(`
      INSERT INTO shipment_updates (order_id, status, location, note) VALUES (?, ?, ?, ?)
    `).run(req.params.id, statusLabel, location || null, note || null);
  });
  tx();

  res.redirect('/admin/orders/' + req.params.id);
});

module.exports = router;
