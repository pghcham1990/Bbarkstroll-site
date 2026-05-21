const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Temp DB + docs dir + fixed key, set BEFORE any app module is required.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsdocs-'));
process.env.BARKSTROLL_DB_PATH = path.join(tmp, 'test.db');
process.env.SECURE_DOCS_DIR = path.join(tmp, 'secure-docs');
process.env.DOC_ENC_KEY = 'b'.repeat(64);

const express = require('express');
const { migrate } = require('../migrate-employee-documents');

let server, baseUrl, db;

before(async () => {
  db = require('../lib/db');
  db.prepare(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT,
    email TEXT, phone TEXT, active INTEGER DEFAULT 1, crew_type TEXT DEFAULT 'contractor'
  )`).run();
  migrate(db);
  db.prepare("INSERT INTO employees (first_name,last_name,crew_type) VALUES ('Test','Walker','contractor')").run();

  const app = express();
  app.use(require('../routes/employee-documents'));
  await new Promise((r) => { server = app.listen(0, r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const PDF = Buffer.from('%PDF-1.4\nSSN 111-22-3333\n%%EOF\n');

test('upload, list, view, delete round-trip', async () => {
  // upload
  const fd = new FormData();
  fd.set('file', new Blob([PDF], { type: 'application/pdf' }), 'walker-w9.pdf');
  let res = await fetch(`${baseUrl}/employees/1/documents`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 200);
  const created = await res.json();
  assert.ok(created.id);

  // the on-disk blob must not contain the plaintext
  const stored = db.prepare('SELECT stored_file FROM employee_documents WHERE id=?').get(created.id).stored_file;
  const blob = fs.readFileSync(path.join(process.env.SECURE_DOCS_DIR, stored));
  assert.ok(!blob.includes(Buffer.from('SSN 111-22-3333')));

  // list
  res = await fetch(`${baseUrl}/employees/1/documents`);
  const list = await res.json();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].doc_type, 'w9');
  assert.strictEqual(list[0].original_name, 'walker-w9.pdf');

  // view returns original bytes + mime
  res = await fetch(`${baseUrl}/employees/1/documents/${created.id}/file`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
  const got = Buffer.from(await res.arrayBuffer());
  assert.deepStrictEqual(got, PDF);

  // delete removes row and blob
  res = await fetch(`${baseUrl}/employees/1/documents/${created.id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.prepare('SELECT count(*) c FROM employee_documents').get().c, 0);
  assert.ok(!fs.existsSync(path.join(process.env.SECURE_DOCS_DIR, stored)));
});

test('rejects a disallowed mime type', async () => {
  const fd = new FormData();
  fd.set('file', new Blob([Buffer.from('MZexe')], { type: 'application/x-msdownload' }), 'bad.exe');
  const res = await fetch(`${baseUrl}/employees/1/documents`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 400);
});
