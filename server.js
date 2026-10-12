import express from 'express';
import dotenv from 'dotenv';
import loginHandler from './api/login.js';
import registerHandler from './api/register.js';
import notionHandler from './api/notion.js';
import transactionHandler from './api/transaction.js';
import deleteTransactionHandler from './api/delete-transaction.js';
import editTransactionHandler from './api/edit.js';
import { requireAuth } from './middleware/auth.js';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Basic JSON parsing
app.use(express.json());

// CORS restricted to known frontends (comma-separated ALLOWED_ORIGINS overrides the default)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://ver-px-fe.vercel.app,http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'API Server Running',
  });
});

// Mount routes using existing handlers
app.post('/api/login', loginHandler);
app.post('/api/register', registerHandler);
app.post('/api/transaction', requireAuth, transactionHandler);
app.post('/api/notion', requireAuth, notionHandler);
app.post('/api/delete-transaction', requireAuth, deleteTransactionHandler);
app.post('/api/edit-transaction', requireAuth, editTransactionHandler);

// For Vercel deployment
export default app;

// For local development (not used in Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}


