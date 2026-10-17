import test from 'node:test';
import assert from 'node:assert/strict';
import { newToken, hashToken, encryptToken, decryptToken, TOKEN_PATTERN } from '../lib/shareTokens.js';

test('tokens are 32 URL-safe characters and unique', () => {
  const a = newToken();
  assert.match(a, TOKEN_PATTERN);
  assert.notEqual(a, newToken());
});

test('encrypted tokens round-trip, and fail closed with a different secret', () => {
  process.env.JWT_SECRET = 'first-secret';
  const token = newToken();
  const stored = encryptToken(token);
  assert.notEqual(stored, token);
  assert.equal(decryptToken(stored), token);

  process.env.JWT_SECRET = 'rotated-secret';
  assert.equal(decryptToken(stored), null);
});

test('hashes are stable and do not contain the token', () => {
  const token = newToken();
  assert.equal(hashToken(token), hashToken(token));
  assert.ok(!hashToken(token).includes(token));
});
