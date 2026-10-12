import crypto from 'crypto';
import { findUserByName, createUser, hashPassword } from '../utils/users.js';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores bytes beyond 72

export default async function handler(req, res) {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username.trim())) {
    return res.status(400).json({
      message: 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore.'
    });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({
      message: `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`
    });
  }

  const userName = username.trim();

  try {
    if (await findUserByName(userName)) {
      return res.status(400).json({ message: 'User already exists' });
    }

    await createUser({
      userName,
      passwordHash: await hashPassword(password),
      uuid: crypto.randomUUID()
    });

    return res.status(200).json({ message: 'User created' });

  } catch (error) {
    console.error('Register Error:', error);
    return res.status(500).json({ message: 'User not created. Please try again.' });
  }
}
