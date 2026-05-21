const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGO = 'aes-256-gcm';

// Load the document encryption key. If absent, generate one and persist it to
// .env so it survives restarts and rides the normal backup/Dan mirror. The admin
// never handles this key directly.
function loadKey() {
  let hex = process.env.DOC_ENC_KEY;
  if (!hex) {
    hex = crypto.randomBytes(32).toString('hex');
    const envPath = path.join(__dirname, '..', '.env');
    fs.appendFileSync(envPath, `\nDOC_ENC_KEY=${hex}\n`);
    process.env.DOC_ENC_KEY = hex;
    console.log('[doc-crypto] generated DOC_ENC_KEY and saved to .env');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('DOC_ENC_KEY must be 32 bytes (64 hex chars)');
  return key;
}

const KEY = loadKey();

// encryptBuffer(Buffer) -> { ciphertext: Buffer, ivHex: string, tagHex: string }
function encryptBuffer(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, ivHex: iv.toString('hex'), tagHex: tag.toString('hex') };
}

// decryptBuffer(Buffer, ivHex, tagHex) -> Buffer (throws on auth failure)
function decryptBuffer(ciphertext, ivHex, tagHex) {
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { encryptBuffer, decryptBuffer };
