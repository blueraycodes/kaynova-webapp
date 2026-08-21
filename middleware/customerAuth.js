function requireCustomer(req, res, next) {
  if (req.session && req.session.customerId) {
    return next();
  }
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

module.exports = { requireCustomer };
