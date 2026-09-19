import 'dotenv/config';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Add it to .env (see .env.example).');
}
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      userId: number;
    }
  }
}

// ---------------------------------------------------------------------------
// Passwords — scrypt from node:crypto (no native module to build on Vercel).
// Stored as "<salt hex>:<key hex>".
// ---------------------------------------------------------------------------

const KEY_LENGTH = 64;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await deriveKey(password, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Verified against when the email is unknown, so "no such user" and "wrong
// password" take the same time and can't be told apart by timing.
export const dummyHash = hashPassword('not-a-real-password');

// ---------------------------------------------------------------------------
// Tokens — stateless HS256 JWT, subject = user id.
// ---------------------------------------------------------------------------

export function signToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) throw new Error('bad subject');
    req.userId = userId;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
