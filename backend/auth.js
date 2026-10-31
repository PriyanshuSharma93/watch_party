import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

export const signToken = (u) => jwt.sign({ id: u.id, username: u.username }, SECRET, { expiresIn: '7d' });
export const verifyToken = (t) => jwt.verify(t, SECRET);
export const hashPassword = (p) => bcrypt.hash(p, 10);
export const checkPassword = (p, h) => bcrypt.compare(p, h);

export function requireAuth(req, res, next) {
  try {
    req.user = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
    next();
  } catch {
    res.status(401).json({ error: 'Please log in again.' });
  }
}