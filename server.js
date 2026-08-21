require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
}));

// Make some globals available to all views
const db = require('./db/database');
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  if (req.session.customerId) {
    res.locals.customer = db.prepare('SELECT id, phone, name, email FROM customers WHERE id = ?').get(req.session.customerId) || null;
  } else {
    res.locals.customer = null;
  }
  next();
});

// Routes
app.use('/', require('./routes/customerAuth'));
app.use('/', require('./routes/store'));
app.use('/api', require('./routes/api'));
app.use('/admin', require('./routes/admin'));

// 404 handler
app.use((req, res) => {
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`\n🚀 Store running at        http://localhost:${PORT}`);
  console.log(`🔐 Admin panel at          http://localhost:${PORT}/admin/login`);
  console.log(`📦 Track an order at       http://localhost:${PORT}/track\n`);
});
