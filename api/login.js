import { findUserByName, verifyPassword, hashPassword, updatePasswordHash } from '../utils/users.js';
import { signToken } from '../middleware/auth.js';

const INVALID_CREDENTIALS = 'Invalid credentials. Please check your username and password.';

export default async function handler(req, res) {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const user = await findUserByName(username.trim());
    if (!user) {
      return res.status(401).json({ message: INVALID_CREDENTIALS });
    }

    const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: INVALID_CREDENTIALS });
    }

    // Upgrade legacy SHA-256 hashes to bcrypt on successful login
    if (needsRehash) {
      try {
        await updatePasswordHash(user.pageId, await hashPassword(password));
      } catch (error) {
        console.error('Password rehash failed:', error);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token: signToken(user),
      user: {
        userName: user.userName,
        isMe: user.isMe
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      message: 'Internal server error. Please try again.'
    });
  }
}
