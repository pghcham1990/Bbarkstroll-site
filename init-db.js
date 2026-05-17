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
    batch_id    TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointment_dogs (
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    dog_id         INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    PRIMARY KEY (appointment_id, dog_id)
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_time);
  CREATE INDEX IF NOT EXISTS idx_appointments_employee ON appointments(employee_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_batch ON appointments(batch_id);
  CREATE INDEX IF NOT EXISTS idx_dogs_customer ON dogs(customer_id);
`);

// Migrate existing dog_id data to junction table (safe to re-run)
const migrated = db.prepare("SELECT COUNT(*) as c FROM appointment_dogs").get().c;
const oldData = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE dog_id IS NOT NULL").get().c;
if (!migrated && oldData) {
  db.prepare("INSERT INTO appointment_dogs (appointment_id, dog_id) SELECT id, dog_id FROM appointments WHERE dog_id IS NOT NULL").run();
  console.log('Migrated ' + oldData + ' appointments to appointment_dogs junction table');
}

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
    'scott', hash, salt, 'Scott', 'scott@barkstroll.com', 'admin'
  );
  console.log('Created admin user: scott / ' + password);
}

// --- Portal migration: user_id on customers, appointment_requests tables, portal user accounts ---

// Add user_id column to customers if not present
const custCols = db.prepare("PRAGMA table_info(customers)").all().map(c => c.name);
if (!custCols.includes('user_id')) {
  db.exec("ALTER TABLE customers ADD COLUMN user_id INTEGER REFERENCES users(id)");
  console.log('Added user_id column to customers');
}

// Create appointment_requests table
db.exec(`
  CREATE TABLE IF NOT EXISTS appointment_requests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id    INTEGER NOT NULL REFERENCES customers(id),
    service_id     INTEGER NOT NULL REFERENCES services(id),
    preferred_date TEXT    NOT NULL,
    preferred_time TEXT    NOT NULL,
    notes          TEXT,
    status         TEXT    NOT NULL DEFAULT 'pending',
    accepted_by    INTEGER REFERENCES employees(id),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointment_request_dogs (
    request_id INTEGER NOT NULL REFERENCES appointment_requests(id) ON DELETE CASCADE,
    dog_id     INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    PRIMARY KEY (request_id, dog_id)
  );
`);

// Create portal user accounts if they don't exist
function ensurePortalUser(username, password, displayName, role) {
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return exists.id;
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const r = db.prepare('INSERT INTO users (username, password_hash, password_salt, display_name, email, role) VALUES (?, ?, ?, ?, ?, ?)').run(
    username, hash, salt, displayName, username, role
  );
  console.log('Created ' + role + ' user: ' + username + ' / ' + password);
  return r.lastInsertRowid;
}

// Kate Garaventa — customer
const kateUserId = ensurePortalUser('k8whitt10@gmail.com', 'BarkStroll1', 'Kate Garaventa', 'customer');
db.prepare('UPDATE customers SET user_id = ? WHERE id = 2 AND user_id IS NULL').run(kateUserId);

// Jackie Erickson — customer
const jackieUserId = ensurePortalUser('jerickson711@gmail.com', 'BarkStroll1', 'Jackie Erickson', 'customer');
db.prepare('UPDATE customers SET user_id = ? WHERE id = 1 AND user_id IS NULL').run(jackieUserId);

// Shannon Daly — walker
const shannonUserId = ensurePortalUser('shannon@revivemarketinggroup.com', 'BarkStroll1', 'Shannon Daly', 'walker');
db.prepare('UPDATE employees SET user_id = ? WHERE id = 1 AND user_id IS NULL').run(shannonUserId);

// Liz Valli — walker
const lizUserId = ensurePortalUser('liz.valli@barkstroll.com', 'BarkStroll1', 'Liz Valli', 'walker');
db.prepare('UPDATE employees SET user_id = ? WHERE id = 3 AND user_id IS NULL').run(lizUserId);

// Kara McCusker — customer (exclusive to Scott)
const karaUserId = ensurePortalUser('klm1006@yahoo.com', 'BarkStroll1', 'Kara McCusker', 'customer');
db.prepare('UPDATE customers SET user_id = ? WHERE id = 3 AND user_id IS NULL').run(karaUserId);

// --- Documents table (invoices & proposals) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id   INTEGER NOT NULL REFERENCES customers(id),
    type          TEXT    NOT NULL DEFAULT 'invoice',
    doc_number    TEXT    NOT NULL,
    file_id       TEXT    NOT NULL,
    filename      TEXT    NOT NULL,
    html_content  TEXT,
    conversation  TEXT    NOT NULL DEFAULT '[]',
    status        TEXT    NOT NULL DEFAULT 'draft',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_documents_customer ON documents(customer_id);
  CREATE INDEX IF NOT EXISTS idx_documents_file_id ON documents(file_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    full_name TEXT NOT NULL,
    preferred_name TEXT,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    zip TEXT NOT NULL,
    is_18_plus INTEGER NOT NULL,
    has_transport INTEGER NOT NULL,
    closest_area TEXT NOT NULL,
    days_available TEXT NOT NULL,
    time_windows TEXT NOT NULL,
    hours_hoping TEXT NOT NULL,
    owned_dogs INTEGER NOT NULL,
    experience_note TEXT,
    sizes_ok TEXT NOT NULL,
    uncomfortable TEXT,
    allergies TEXT,
    why_interested TEXT NOT NULL,
    tricky_situation TEXT NOT NULL,
    ref1_name TEXT,
    ref1_phone TEXT,
    ref1_relation TEXT,
    ref2_name TEXT,
    ref2_phone TEXT,
    ref2_relation TEXT,
    refs_on_request INTEGER NOT NULL DEFAULT 0,
    attestations TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    scott_notes TEXT,
    bgcheck_sent_at TEXT,
    rejected_at TEXT,
    delete_after TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_applicants_status ON applicants(status, created_at DESC);
`);
console.log('Created applicants table');

console.log('Database initialized at', require('path').join(__dirname, 'data', 'barkstroll.db'));
db.close();
