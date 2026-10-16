import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createEntrySchema, createSettlementSchema, entryIdSchema } from '../schemas.js';
import * as ledger from '../services/ledger.js';

const router = Router();

router.use(requireAuth);

// Lent, borrowed, or a bill split with one person. Responds with that person's updated balance.
router.post('/entries', validate({ body: createEntrySchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await ledger.createEntry(req.user, req.body));
}));

router.delete('/entries/:id', validate({ params: entryIdSchema }), asyncHandler(async (req, res) => {
  res.json(await ledger.deleteEntry(req.user, req.params.id));
}));

// Settling up, in full or in part
router.post('/settlements', validate({ body: createSettlementSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await ledger.createSettlement(req.user, req.body));
}));

router.delete('/settlements/:id', validate({ params: entryIdSchema }), asyncHandler(async (req, res) => {
  await ledger.deleteSettlement(req.user, req.params.id);
  res.status(204).end();
}));

export default router;
