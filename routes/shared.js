import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { shareTokenSchema } from '../schemas.js';
import { getSharedGroup } from '../services/groupShares.js';

// Public, no login: what someone with a share link can see
const router = Router();

// Tokens can't realistically be guessed, but there's no reason to let anyone try fast
const viewLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests. Try again in a minute.' },
});

router.use(viewLimiter);
router.use((req, res, next) => {
  // Personal data behind a secret link: don't cache it or let search engines list it
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

router.get('/groups/:token', validate({ params: shareTokenSchema }), asyncHandler(async (req, res) => {
  res.json(await getSharedGroup(req.params.token));
}));

export default router;
