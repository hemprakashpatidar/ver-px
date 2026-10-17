import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  groupIdSchema,
  groupItemSchema,
  listGroupsQuerySchema,
  createGroupSchema,
  updateGroupSchema,
  createGroupExpenseSchema,
  createGroupSettlementSchema,
} from '../schemas.js';
import * as groups from '../services/groups.js';

const router = Router();

router.use(requireAuth);

// Your groups with member count, total spent and your position in each
router.get('/', validate({ query: listGroupsQuerySchema }), asyncHandler(async (req, res) => {
  res.json({ groups: await groups.listGroups(req.user, req.query) });
}));

router.post('/', validate({ body: createGroupSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await groups.createGroup(req.user, req.body));
}));

// One group: members with their nets, who should pay whom, and the activity
router.get('/:id', validate({ params: groupIdSchema }), asyncHandler(async (req, res) => {
  res.json(await groups.getGroup(req.user, req.params.id));
}));

// Rename, change emoji, switch "simplify debts", add members
router.patch('/:id', validate({ params: groupIdSchema, body: updateGroupSchema }), asyncHandler(async (req, res) => {
  res.json(await groups.updateGroup(req.user, req.params.id, req.body));
}));

router.post('/:id/expenses', validate({ params: groupIdSchema, body: createGroupExpenseSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await groups.addGroupExpense(req.user, req.params.id, req.body));
}));

router.delete('/:id/expenses/:itemId', validate({ params: groupItemSchema }), asyncHandler(async (req, res) => {
  res.json(await groups.deleteGroupExpense(req.user, req.params.id, req.params.itemId));
}));

router.post('/:id/settlements', validate({ params: groupIdSchema, body: createGroupSettlementSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await groups.addGroupSettlement(req.user, req.params.id, req.body));
}));

router.delete('/:id/settlements/:itemId', validate({ params: groupItemSchema }), asyncHandler(async (req, res) => {
  await groups.deleteGroupSettlement(req.user, req.params.id, req.params.itemId);
  res.status(204).end();
}));

export default router;
