import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { groupIdSchema } from '../schemas.js';
import * as invites from '../services/groupInvites.js';

// Groups other people invited you to: read-only, from your point of view
const router = Router();

router.use(requireAuth);

router.get('/groups', asyncHandler(async (req, res) => {
  res.json({ groups: await invites.listSharedWithMe(req.user) });
}));

router.get('/groups/:id', validate({ params: groupIdSchema }), asyncHandler(async (req, res) => {
  res.json(await invites.getSharedWithMe(req.user, req.params.id));
}));

// Leave: you stop seeing it; the owner's data is untouched
router.delete('/groups/:id', validate({ params: groupIdSchema }), asyncHandler(async (req, res) => {
  await invites.leaveSharedGroup(req.user, req.params.id);
  res.status(204).end();
}));

export default router;
