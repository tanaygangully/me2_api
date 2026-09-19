import 'dotenv/config';
import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Add it to .env.');
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

  let userId: number;
  let issuedAt: number;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    userId = Number(payload.sub);
    issuedAt = payload.iat ?? 0;
    if (!Number.isInteger(userId)) throw new Error('bad subject');
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Outside the try on purpose: a database outage is a 500, not a 401 (which
  // the app would read as "session expired" and sign the user out).
  const [user] = await db
    .select({ passwordChangedAt: users.passwordChangedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // unknown user (deleted), or the password was reset after this token was issued
  if (!user || (user.passwordChangedAt && issuedAt < Math.floor(user.passwordChangedAt.getTime() / 1000))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.userId = userId;
  next();
}

// ---------------------------------------------------------------------------
// Password reset — one-time code (OTP) + short-lived reset token
// ---------------------------------------------------------------------------

export const OTP_TTL_MS = 10 * 60 * 1000;
/** After a correct code, how long the user has to set the new password. */
export const RESET_WINDOW_MS = 15 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** Minimum gap between two codes being sent to the same user. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** Six digits, uniformly random, zero-padded. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// Keyed hash, so a leaked database alone can't be used to brute-force the
// (small) 6-digit space offline.
export function hashOtp(userId: number, otp: string): string {
  return createHmac('sha256', secret).update(`otp:${userId}:${otp}`).digest('hex');
}

export function otpMatches(userId: number, otp: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(userId, otp), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Reset tokens are signed with a key derived from (not equal to) JWT_SECRET,
// so a reset token can never be accepted as a login token or vice versa —
// both carry the user id, so sharing a key would make that a real risk.
const resetSecret = createHmac('sha256', secret).update('password-reset-token').digest();

/** Proves the caller passed OTP verification for reset row `resetId`. Valid 15 minutes. */
export function signResetToken(resetId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(resetId))
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(resetSecret);
}

/** The reset row id inside a valid reset token, or null. */
export async function verifyResetToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, resetSecret, { algorithms: ['HS256'] });
    const id = Number(payload.sub);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}
