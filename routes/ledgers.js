import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createLedgerSchema, updateLedgerSchema, ledgerIdSchema, listLedgersQuerySchema } from '../schemas.js';
import * as ledger from '../services/ledger.js';

const router = Router();

router.use(requireAuth);

// Your ledgers (separate books), each with its totals. A "Personal" one exists from the start.
router.get('/', validate({ query: listLedgersQuerySchema }), asyncHandler(async (req, res) => {
  res.json({ ledgers: await ledger.listLedgers(req.user, req.query) });
}));

router.post('/', validate({ body: createLedgerSchema }), asyncHandler(async (req, res) => {
  res.status(201).json({ ledger: await ledger.createLedger(req.user, req.body) });
}));

// Rename, archive (only when everyone in it is settled), or restore
router.patch('/:id', validate({ params: ledgerIdSchema, body: updateLedgerSchema }), asyncHandler(async (req, res) => {
  res.json({ ledger: await ledger.updateLedger(req.user, req.params.id, req.body) });
}));

export default router;
