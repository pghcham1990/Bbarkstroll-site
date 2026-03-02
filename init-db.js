const db = require('./lib/db');
const crypto = require('crypto');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    password_salt TEXT    NOT NULL,
    display_name  TEXT    NOT NULL,
    email         TEXT,
    role          TEXT    NOT NULL DEFAULT 'admin',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name  TEXT    NOT NULL,
    last_name   TEXT    NOT NULL,
    email       TEXT,
    phone       TEXT,
    address     TEXT,
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dogs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    breed       TEXT,
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    first_name  TEXT    NOT NULL,
    last_name   TEXT    NOT NULL,
    email       TEXT,
    phone       TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS services (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 30,
    active       INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    dog_id      INTEGER NOT NULL REFERENCES dogs(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    service_id  INTEGER NOT NULL REFERENCES services(id),
    start_time  TEXT    NOT NULL,
    end_time    TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'scheduled',
    notes       TEXT,
    email_sent  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_time);
  CREATE INDEX IF NOT EXISTS idx_appointments_employee ON appointments(employee_id);
  CREATE INDEX IF NOT EXISTS idx_dogs_customer ON dogs(customer_id);
`);

// Seed services if empty
const count = db.prepare('SELECT COUNT(*) as c FROM services').get().c;
if (count === 0) {
  const ins = db.prepare('INSERT INTO services (name, duration_min) VALUES (?, ?)');
  const seeds = [
    ['Dog Walking', 30],
    ['Poop Removal', 15],
    ['Pet Sitting', 60],
    ['Pet Feeding', 15],
    ['Custom Care', 30]
  ];
  for (const [name, dur] of seeds) ins.run(name, dur);
  console.log('Seeded 5 service types');
}

// Create admin user if none exists
const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get().c;
if (adminCount === 0) {
  const password = process.argv[2] || 'barkstroll2026';
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  db.prepare('INSERT INTO users (username, password_hash, password_salt, display_name, email, role) VALUES (?, ?, ?, ?, ?, ?)').run(
    'scott', hash, salt, 'Scott', 'scott.rocca.pa@gmail.com', 'admin'
  );
  console.log('Created admin user: scott / ' + password);
}

console.log('Database initialized at', require('path').join(__dirname, 'data', 'barkstroll.db'));
db.close();
