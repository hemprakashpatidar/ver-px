import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// Notion select option names cannot contain commas
const selectName = (label) => z.string().trim().min(1, `${label} is required`).max(100)
  .refine(value => !value.includes(','), `${label} cannot contain commas`);

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

export const registerSchema = z.object({
  username: z.string().trim().regex(
    /^[a-zA-Z0-9_.-]{3,32}$/,
    'Username must be 3-32 characters: letters, numbers, dot, dash or underscore.'
  ),
  // bcrypt ignores bytes beyond 72
  password: z.string().min(8, 'Password must be 8-72 characters.').max(72, 'Password must be 8-72 characters.')
});

export const monthQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100)
});

export const transactionIdSchema = z.object({
  id: z.string().regex(NOTION_ID, 'Invalid transaction id')
});

const transactionFields = {
  expense: z.string().trim().min(1, 'Expense is required').max(200),
  amount: z.coerce.number().positive('Amount must be greater than 0').finite(),
  category: selectName('Category'),
  paymentMethod: selectName('Payment method'),
  date: z.string().regex(ISO_DATE, 'Date must be YYYY-MM-DD')
};

export const createTransactionSchema = z.object({
  ...transactionFields,
  date: transactionFields.date.default(() => new Date().toISOString().split('T')[0])
});

export const updateTransactionSchema = z.object(transactionFields)
  .partial()
  .refine(changes => Object.keys(changes).length > 0, 'Provide at least one field to update');

// ── Ledger ──────────────────────────────────────────────────────────────────

// Rupees with at most two decimals (stored as integer paise)
const rupees = z.coerce.number().finite().positive('Amount must be greater than 0').max(100_000_000)
  .refine(value => /^\d+(\.\d{1,2})?$/.test(String(value)), 'Use at most 2 decimal places');
const isoDate = z.string().regex(ISO_DATE, 'Date must be YYYY-MM-DD');
const optionalText = (max) => z.string().trim().max(max).optional().transform(v => v || undefined);

export const personIdSchema = z.object({ id: z.uuid('Invalid person id') });
export const entryIdSchema = z.object({ id: z.uuid('Invalid id') });

export const listPeopleQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
});

const personName = z.string().trim().min(1, 'Name is required').max(80);

export const createPersonSchema = z.object({ name: personName });

export const updatePersonSchema = z.object({
  name: personName.optional(),
  archived: z.boolean().optional(),
}).refine(changes => Object.keys(changes).length > 0, 'Provide a name or archived');

const loanEntry = (type) => z.object({
  type: z.literal(type),
  personId: z.uuid('Invalid person id'),
  amount: rupees,
  date: isoDate,
  description: optionalText(200),
});

const splitEntry = z.object({
  type: z.literal('split'),
  personId: z.uuid('Invalid person id'),
  amount: rupees,
  date: isoDate,
  description: z.string().trim().min(1, 'Description is required').max(200),
  paidBy: z.enum(['me', 'them']),
  split: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('equal') }),
    z.object({ mode: z.literal('exact'), myShare: z.coerce.number().finite().min(0) }),
  ]),
  addMyShare: z.boolean().default(false),
  category: selectName('Category').optional(),
  paymentMethod: selectName('Payment method').optional(),
}).superRefine((entry, ctx) => {
  // Your share becomes a normal expense, which needs both
  if (entry.addMyShare && !entry.category) {
    ctx.addIssue({ code: 'custom', path: ['category'], message: 'Pick a category to add your share to expenses' });
  }
  if (entry.addMyShare && !entry.paymentMethod) {
    ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Pick a payment method to add your share to expenses' });
  }
});

export const createEntrySchema = z.discriminatedUnion('type', [loanEntry('lent'), loanEntry('borrowed'), splitEntry]);

export const createSettlementSchema = z.object({
  personId: z.uuid('Invalid person id'),
  direction: z.enum(['they_paid', 'i_paid']),
  amount: rupees,
  date: isoDate,
  note: optionalText(200),
});
