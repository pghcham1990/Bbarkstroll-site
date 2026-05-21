const { test } = require('node:test');
const assert = require('node:assert');

// Set a fixed key BEFORE requiring the module so it does not touch .env.
process.env.DOC_ENC_KEY = 'a'.repeat(64); // 32 bytes in hex

const { encryptBuffer, decryptBuffer } = require('../lib/doc-crypto');

test('round-trips a buffer', () => {
  const plain = Buffer.from('hello %PDF secret SSN 123-45-6789');
  const { ciphertext, ivHex, tagHex } = encryptBuffer(plain);
  // ciphertext must not contain the plaintext
  assert.ok(!ciphertext.includes(Buffer.from('SSN 123-45-6789')));
  const out = decryptBuffer(ciphertext, ivHex, tagHex);
  assert.deepStrictEqual(out, plain);
});

test('fresh IV per call', () => {
  const a = encryptBuffer(Buffer.from('x'));
  const b = encryptBuffer(Buffer.from('x'));
  assert.notStrictEqual(a.ivHex, b.ivHex);
});

test('tampered ciphertext fails authentication', () => {
  const { ciphertext, ivHex, tagHex } = encryptBuffer(Buffer.from('data'));
  const bad = Buffer.from(ciphertext);
  bad[0] = bad[0] ^ 0xff;
  assert.throws(() => decryptBuffer(bad, ivHex, tagHex));
});
