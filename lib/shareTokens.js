import crypto from 'crypto';

// Share-link tokens: 24 random bytes as 32 URL-safe characters. Stored as a sha256 hash
// (for lookup) plus an AES-256-GCM copy (so the owner can copy the link again).

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const newToken = () => crypto.randomBytes(24).toString('base64url');

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Separate from the login-signing use of JWT_SECRET via HKDF, so one can't stand in for the
// other; each purpose ('group-share-links', 'group-invites') gets its own key
const encryptionKey = (purpose) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'ver-px', purpose, 32));
};

// iv (12 bytes) | auth tag (16 bytes) | ciphertext, as base64url
export const encryptToken = (token, purpose = 'group-share-links') => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
};

// null if it can't be read, e.g. JWT_SECRET changed since the link was made
export const decryptToken = (stored, purpose = 'group-share-links') => {
  try {
    const data = Buffer.from(stored, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(purpose), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

// A stable, opaque code for a member within one invite, so invite pages never expose
// database ids: the same token and person always give the same code, and codes from
// one invite say nothing about another
export const memberRef = (token, personId) =>
  crypto.createHmac('sha256', token).update(personId).digest('base64url').slice(0, 16);
