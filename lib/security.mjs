import crypto from 'node:crypto';

export function createCryptoBox(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Klucz szyfrowania musi mieć 32 bajty.');

  function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64')
    };
  }

  function decrypt(encrypted, iv, tag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const value = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final()
    ]);
    return JSON.parse(value.toString('utf8'));
  }

  return { encrypt, decrypt };
}

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

export function verifyPassword(password, storedHash, storedSalt) {
  const expected = Buffer.from(storedHash, 'hex');
  const salt = Buffer.from(storedSalt, 'hex');
  const candidates = [
    crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }),
    crypto.scryptSync(password, salt, 64)
  ];
  return candidates.some(candidate => candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected));
}

export function strongPassword(password) {
  return typeof password === 'string' && password.length >= 14 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    output += base32Alphabet[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  }
  return output;
}

function base32Decode(value) {
  const cleaned = value.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of cleaned) bits += base32Alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totpCode(secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret, code, timestamp = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const counter = Math.floor(timestamp / 30_000);
  return [-1, 0, 1].some(offset => {
    const expected = Buffer.from(totpCode(secret, counter + offset));
    const supplied = Buffer.from(String(code));
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  });
}

export function createTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}
