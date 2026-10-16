import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createPersonSchema, updatePersonSchema, personIdSchema, listPeopleQuerySchema } from '../schemas.js';
import * as ledger from '../services/ledger.js';

const router = Router();

router.use(requireAuth);

// Everyone you share money with, their balances, and the totals
router.get('/', validate({ query: listPeopleQuerySchema }), asyncHandler(async (req, res) => {
  res.json(await ledger.listPeople(req.user, req.query));
}));

router.post('/', validate({ body: createPersonSchema }), asyncHandler(async (req, res) => {
  res.status(201).json({ person: await ledger.createPerson(req.user, req.body) });
}));

// One person: balance plus the full history between you
router.get('/:id', validate({ params: personIdSchema }), asyncHandler(async (req, res) => {
  res.json(await ledger.getPerson(req.user, req.params.id));
}));

router.patch('/:id', validate({ params: personIdSchema, body: updatePersonSchema }), asyncHandler(async (req, res) => {
  res.json({ person: await ledger.updatePerson(req.user, req.params.id, req.body) });
}));

export default router;
