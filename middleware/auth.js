import jwt from 'jsonwebtoken';

const TOKEN_TTL = '7d';

// Read lazily: dotenv.config() runs after imports are evaluated
const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
};

export const signToken = ({ uuid, userName, isMe }) =>
  jwt.sign({ userName, isMe: !!isMe }, getSecret(), { subject: uuid, expiresIn: TOKEN_TTL });

export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Authentication required. Please login first.' });
  }

  try {
    const payload = jwt.verify(token, getSecret());
    // Identity comes only from the verified token, never from the request body
    req.user = { uuid: payload.sub, userName: payload.userName, isMe: !!payload.isMe };
    return next();
  } catch (error) {
    if (error.message === 'JWT_SECRET is not configured') {
      console.error(error.message);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
    return res.status(401).json({ message: 'Session expired. Please login again.' });
  }
};
