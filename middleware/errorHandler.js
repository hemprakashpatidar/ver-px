import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { NotionError } from '../lib/notion.js';

// Every error leaves the API as { message }; internal details are only logged
// Express only treats 4-argument middleware as an error handler, so `next` must stay
export const errorHandler = (error, req, res, next) => {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue.path.join('.');
    return res.status(400).json({ message: field ? `${field}: ${issue.message}` : issue.message });
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message });
  }

  if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body must be valid JSON' });
  }

  // Postgres constraint errors that slipped past validation: a bad reference or a duplicate
  if (error.code === '23503') {
    return res.status(400).json({ message: 'That refers to something that does not exist.' });
  }
  if (error.code === '23505') {
    return res.status(409).json({ message: 'That already exists.' });
  }

  console.error(`${req.method} ${req.originalUrl} failed:`, error);

  if (error instanceof NotionError) {
    return res.status(502).json({ message: 'Upstream data store error. Please try again.' });
  }

  return res.status(500).json({ message: 'Internal Server Error' });
};

export const notFound = (req, res) => {
  res.status(404).json({ message: 'Route not found' });
};
