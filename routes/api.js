const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const razorpayIsConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const razorpay = razorpayIsConfigured
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  : null;

const SHIPPING_FEE = 49; // flat shipping fee; set to 0 to enable free shipping logic yourself
const FREE_SHIPPING_THRESHOLD = 999;

// ---------- GET LIVE PRODUCT DATA FOR CART (price/stock re-validation) ----------
router.post('/cart/validate', (req, res) => {
  const { items } = req.body; // [{ productId, quantity }]
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  const result = [];
  let subtotal = 0;

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.productId);
    if (!product) continue;
    const quantity = Math.max(1, Math.min(item.quantity, product.stock));
    const lineTotal = product.price * quantity;
    subtotal += lineTotal;
    result.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      image_url: product.image_url,
      quantity,
      lineTotal,
      stock: product.stock,
    });
  }

  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD || subtotal === 0 ? 0 : SHIPPING_FEE;
  const total = subtotal + shipping;

  res.json({ items: result, subtotal, shipping, total });
});

// ---------- CREATE RAZORPAY ORDER ----------
router.post('/create-order', async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(503).json({ error: 'Payment gateway is not configured. Add Razorpay keys in .env to enable checkout.' });
    }

    const { customer, items } = req.body;
    if (!customer || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing customer details or cart items' });
    }

    // Re-validate prices/stock server-side (never trust client-sent totals)
    let subtotal = 0;
    const validatedItems = [];
    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.productId);
      if (!product) continue;
      if (product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
      }
      const lineTotal = product.price * item.quantity;
      subtotal += lineTotal;
      validatedItems.push({ product, quantity: item.quantity, lineTotal });
    }

    if (validatedItems.length === 0) {
      return res.status(400).json({ error: 'No valid items in cart' });
    }

    const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
    const total = Math.round((subtotal + shipping) * 100) / 100; // 2 decimal places
    const amountInPaise = Math.round(total * 100);

    const orderNumber = 'ORD' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 900 + 100);

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: orderNumber,
      notes: { orderNumber },
    });

    // Store a pending order in DB
    const insertOrder = db.prepare(`
      INSERT INTO orders
        (order_number, customer_name, email, phone, address_line, city, state, pincode,
         subtotal, shipping_fee, total_amount, payment_status, razorpay_order_id, order_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'placed')
    `);
    const info = insertOrder.run(
      orderNumber,
      customer.name,
      customer.email,
      customer.phone,
      customer.address,
      customer.city,
      customer.state,
      customer.pincode,
      subtotal,
      shipping,
      total,
      razorpayOrder.id
    );

    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    validatedItems.forEach((vi) => {
      insertItem.run(orderId, vi.product.id, vi.product.name, vi.product.price, vi.quantity);
    });

    res.json({
      razorpayOrderId: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      orderNumber,
      customer,
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
});

// ---------- VERIFY PAYMENT (called from checkout page after Razorpay success handler) ----------
router.post('/verify-payment', (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ error: 'Payment gateway is not configured. Add Razorpay keys in .env to verify payments.' });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').get(razorpay_order_id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run('failed', order.id);
      return res.status(400).json({ error: 'Payment verification failed. Signature mismatch.' });
    }

    // Mark paid, decrement stock, create first shipment tracking entry
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE orders SET payment_status = 'paid', razorpay_payment_id = ?, razorpay_signature = ?, order_status = 'confirmed'
        WHERE id = ?
      `).run(razorpay_payment_id, razorpay_signature, order.id);

      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      const decrementStock = db.prepare('UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?');
      items.forEach((it) => {
        if (it.product_id) decrementStock.run(it.quantity, it.product_id);
      });

      db.prepare(`
        INSERT INTO shipment_updates (order_id, status, note) VALUES (?, 'Order Confirmed', 'Payment received. Your order is being prepared.')
      `).run(order.id);
    });
    tx();

    res.json({ success: true, orderNumber: order.order_number });
  } catch (err) {
    console.error('verify-payment error:', err);
    res.status(500).json({ error: 'Payment verification failed due to a server error.' });
  }
});

// ---------- COD-FREE: mark order failed if user abandons checkout ----------
router.post('/order-failed', (req, res) => {
  const { razorpay_order_id } = req.body;
  if (razorpay_order_id) {
    db.prepare(`UPDATE orders SET payment_status = 'failed' WHERE razorpay_order_id = ?`).run(razorpay_order_id);
  }
  res.json({ ok: true });
});

module.exports = router;
