import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  monthQuerySchema,
  transactionIdSchema,
  createTransactionSchema,
  updateTransactionSchema
} from '../schemas.js';
import * as transactions from '../services/transactions.js';

const router = Router();

router.use(requireAuth);

router.get('/', validate({ query: monthQuerySchema }), asyncHandler(async (req, res) => {
  res.json({ transactions: await transactions.listForMonth(req.user, req.query) });
}));

router.post('/', validate({ body: createTransactionSchema }), asyncHandler(async (req, res) => {
  res.status(201).json({ transaction: await transactions.create(req.user, req.body) });
}));

router.patch('/:id', validate({ params: transactionIdSchema, body: updateTransactionSchema }), asyncHandler(async (req, res) => {
  res.json({ transaction: await transactions.update(req.user, req.params.id, req.body) });
}));

router.delete('/:id', validate({ params: transactionIdSchema }), asyncHandler(async (req, res) => {
  await transactions.remove(req.user, req.params.id);
  res.status(204).end();
}));

export default router;
