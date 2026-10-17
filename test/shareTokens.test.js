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

test('invite and share-link encryption keys are separate', async () => {
  const { encryptToken: enc, decryptToken: dec } = await import('../lib/shareTokens.js');
  process.env.JWT_SECRET = 'same-secret';
  const token = newToken();
  assert.equal(dec(enc(token, 'group-invites'), 'group-invites'), token);
  assert.equal(dec(enc(token, 'group-invites'), 'group-share-links'), null);
});

test('member codes are stable per invite and differ between invites', async () => {
  const { memberRef } = await import('../lib/shareTokens.js');
  const person = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const a = newToken();
  assert.equal(memberRef(a, person), memberRef(a, person));
  assert.match(memberRef(a, person), /^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(memberRef(a, person), memberRef(newToken(), person));
});
