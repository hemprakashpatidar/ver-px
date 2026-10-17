import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { shareTokenSchema, claimInviteSchema } from '../schemas.js';
import * as invites from '../services/groupInvites.js';

const router = Router();

router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests. Try again in a minute.' },
}));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Public, so the invite page can say what it's for before you log in
router.get('/:token', validate({ params: shareTokenSchema }), asyncHandler(async (req, res) => {
  res.json(await invites.previewInvite(req.params.token));
}));

// Logged in: claim which member you are
router.post('/:token/claim', requireAuth, validate({ params: shareTokenSchema, body: claimInviteSchema }), asyncHandler(async (req, res) => {
  res.json(await invites.claimInvite(req.user, req.params.token, req.body));
}));

export default router;
