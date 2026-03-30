const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');

module.exports = function SqliteStore(options = {}) {
  const Store = session.Store;
  const db = new Database(path.join(__dirname, '..', 'data', 'sessions.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
  `);

  // Clean up expired sessions every 15 minutes
  const cleanup = db.prepare('DELETE FROM sessions WHERE expired < ?');
  setInterval(() => cleanup.run(Date.now()), 15 * 60 * 1000);

  function SqliteSessionStore() {
    Store.call(this, options);
    this._db = db;
    this._get = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?');
    this._set = db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)');
    this._destroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
  }

  SqliteSessionStore.prototype = Object.create(Store.prototype);
  SqliteSessionStore.prototype.constructor = SqliteSessionStore;

  SqliteSessionStore.prototype.get = function(sid, cb) {
    try {
      const row = this._get.get(sid, Date.now());
      if (!row) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (err) { cb(err); }
  };

  SqliteSessionStore.prototype.set = function(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 8 * 60 * 60 * 1000;
      const expired = Date.now() + maxAge;
      this._set.run(sid, JSON.stringify(sess), expired);
      if (cb) cb(null);
    } catch (err) { if (cb) cb(err); }
  };

  SqliteSessionStore.prototype.destroy = function(sid, cb) {
    try {
      this._destroy.run(sid);
      if (cb) cb(null);
    } catch (err) { if (cb) cb(err); }
  };

  return new SqliteSessionStore();
};
