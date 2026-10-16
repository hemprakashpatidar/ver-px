import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import transactionRoutes from './routes/transactions.js';
import peopleRoutes from './routes/people.js';
import ledgerRoutes from './routes/ledger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Vercel sits in front of the app; trust its X-Forwarded-For so rate limiting sees client IPs
app.set('trust proxy', 1);

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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

app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/people', peopleRoutes);
app.use('/api/ledger', ledgerRoutes);

app.use(notFound);
app.use(errorHandler);

// For Vercel deployment
export default app;

// For local development (not used in Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}
