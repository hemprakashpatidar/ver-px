// Replaces req.body / req.query / req.params with the parsed (trimmed, coerced) values.
// A failed parse throws a ZodError, which errorHandler turns into a 400.
export const validate = (schemas) => (req, res, next) => {
  try {
    for (const part of ['body', 'query', 'params']) {
      if (schemas[part]) {
        req[part] = schemas[part].parse(req[part] ?? {});
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};
