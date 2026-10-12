import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

const notionHeaders = () => ({
  'Authorization': `Bearer ${process.env.NOTION_SECRET}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
});

// Query the user table by userName instead of scanning the first 100 rows
export const findUserByName = async (userName) => {
  const response = await fetch(`https://api.notion.com/v1/databases/${process.env.USER_TABLE_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      filter: { property: 'userName', title: { equals: userName } },
      page_size: 1
    })
  });
  if (!response.ok) {
    throw new Error(`Notion user lookup failed with status ${response.status}`);
  }
  const data = await response.json();
  const page = data.results[0];
  if (!page) return null;

  return {
    pageId: page.id,
    userName: page.properties.userName.title[0]?.plain_text,
    uuid: page.properties.uuid.rich_text[0]?.plain_text,
    passwordHash: page.properties.password.rich_text[0]?.plain_text || '',
    isMe: !!page.properties.isMe?.number
  };
};

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

const isBcryptHash = (hash) => /^\$2[aby]\$/.test(hash);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Returns { valid, needsRehash }. Accounts created before bcrypt store unsalted SHA-256.
export const verifyPassword = async (password, storedHash) => {
  if (!storedHash) return { valid: false, needsRehash: false };

  if (isBcryptHash(storedHash)) {
    return { valid: await bcrypt.compare(password, storedHash), needsRehash: false };
  }

  const candidate = Buffer.from(sha256(password));
  const stored = Buffer.from(storedHash);
  const valid = candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  return { valid, needsRehash: valid };
};

export const updatePasswordHash = async (pageId, passwordHash) => {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({
      properties: { password: { rich_text: [{ text: { content: passwordHash } }] } }
    })
  });
  if (!response.ok) {
    throw new Error(`Notion password update failed with status ${response.status}`);
  }
};

export const createUser = async ({ userName, passwordHash, uuid }) => {
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { database_id: process.env.USER_TABLE_ID },
      properties: {
        userName: { title: [{ text: { content: userName } }] },
        password: { rich_text: [{ text: { content: passwordHash } }] },
        uuid: { rich_text: [{ text: { content: uuid } }] }
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Notion user create failed with status ${response.status}`);
  }
};
