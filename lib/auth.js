const crypto = require('crypto');
const db = require('./db');

function hashPassword(plain) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(plain, hash, salt) {
  const attempt = crypto.scryptSync(plain, salt, 64);
  return crypto.timingSafeEqual(attempt, Buffer.from(hash, 'hex'));
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function authenticate(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash, user.password_salt)) return null;
  const result = { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
  if (user.role === 'customer') {
    const cust = db.prepare('SELECT id FROM customers WHERE user_id = ?').get(user.id);
    if (cust) result.customer_id = cust.id;
  } else if (user.role === 'walker') {
    const emp = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(user.id);
    if (emp) result.employee_id = emp.id;
  }
  return result;
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { hashPassword, verifyPassword, requireAuth, authenticate, requireRole };
