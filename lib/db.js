const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.BARKSTROLL_DB_PATH || path.join(__dirname, '..', 'data', 'barkstroll.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
