import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { queryDatabase, createPage, updatePage } from '../lib/notion.js';
import { HttpError } from '../lib/errors.js';
import { signToken } from '../middleware/auth.js';

const BCRYPT_ROUNDS = 10;
const INVALID_CREDENTIALS = 'Invalid credentials. Please check your username and password.';

const findUserByName = async (userName) => {
  const [page] = await queryDatabase(process.env.USER_TABLE_ID, {
    filter: { property: 'userName', title: { equals: userName } }
  });
  if (!page) return null;

  return {
    pageId: page.id,
    userName: page.properties.userName.title[0]?.plain_text,
    uuid: page.properties.uuid.rich_text[0]?.plain_text,
    passwordHash: page.properties.password.rich_text[0]?.plain_text || '',
    isMe: !!page.properties.isMe?.number
  };
};

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

const isBcryptHash = (hash) => /^\$2[aby]\$/.test(hash);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Returns { valid, needsRehash }. Accounts created before bcrypt store unsalted SHA-256.
const verifyPassword = async (password, storedHash) => {
  if (!storedHash) return { valid: false, needsRehash: false };

  if (isBcryptHash(storedHash)) {
    return { valid: await bcrypt.compare(password, storedHash), needsRehash: false };
  }

  const candidate = Buffer.from(sha256(password));
  const stored = Buffer.from(storedHash);
  const valid = candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  return { valid, needsRehash: valid };
};

const passwordProperty = (passwordHash) => ({ rich_text: [{ text: { content: passwordHash } }] });

export const login = async ({ username, password }) => {
  const user = await findUserByName(username);
  if (!user) throw new HttpError(401, INVALID_CREDENTIALS);

  const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new HttpError(401, INVALID_CREDENTIALS);

  // Upgrade legacy SHA-256 hashes to bcrypt on successful login
  if (needsRehash) {
    try {
      await updatePage(user.pageId, { properties: { password: passwordProperty(await hashPassword(password)) } });
    } catch (error) {
      console.error('Password rehash failed:', error);
    }
  }

  return {
    token: signToken(user),
    user: { userName: user.userName, isMe: user.isMe }
  };
};

export const register = async ({ username, password }) => {
  if (await findUserByName(username)) {
    throw new HttpError(400, 'User already exists');
  }

  await createPage(process.env.USER_TABLE_ID, {
    userName: { title: [{ text: { content: username } }] },
    password: passwordProperty(await hashPassword(password)),
    uuid: { rich_text: [{ text: { content: crypto.randomUUID() } }] }
  });
};
