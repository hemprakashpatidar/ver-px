import express from 'express';
import dotenv from 'dotenv';
import loginHandler from './api/login.js';
import notionHandler from './api/notion.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Basic JSON parsing
app.use(express.json());

// Minimal CORS to match handlers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Mount routes using existing handlers
app.post('/api/login', loginHandler);
app.get('/api/notion', notionHandler);

// For Vercel deployment
export default app;

// For local development (not used in Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}


