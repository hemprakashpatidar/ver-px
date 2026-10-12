import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../schemas.js';
import * as users from '../services/users.js';

const router = Router();

// In-memory, so the limit is per server instance on Vercel; enough to slow down guessing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in 15 minutes.' }
});

router.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(async (req, res) => {
  const { token, user } = await users.login(req.body);
  res.json({ success: true, message: 'Login successful', token, user });
}));

router.post('/register', authLimiter, validate({ body: registerSchema }), asyncHandler(async (req, res) => {
  await users.register(req.body);
  res.status(201).json({ message: 'User created' });
}));

export default router;
