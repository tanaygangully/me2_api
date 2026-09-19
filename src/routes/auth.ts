import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { dummyHash, hashPassword, requireAuth, signToken, verifyPassword } from '../lib/auth.js';
import { isUniqueViolation, parseBody } from '../lib/http.js';

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email().max(255);

const signupInput = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password: z.string().min(8).max(128),
});

const loginInput = z.object({
  email,
  password: z.string().min(1).max(128),
});

const publicUser = (u: { id: number; name: string; email: string }) => ({
  id: String(u.id),
  name: u.name,
  email: u.email,
});

// POST /auth/signup
authRouter.post('/signup', async (req, res) => {
  const body = parseBody(signupInput, req, res);
  if (!body) return;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  try {
    const [user] = await db
      .insert(users)
      .values({ name: body.name, email: body.email, passwordHash: await hashPassword(body.password) })
      .returning();
    res.status(201).json({ user: publicUser(user), token: await signToken(user.id) });
  } catch (err) {
    // two signups for the same email racing past the check above
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'An account with this email already exists' });
    throw err;
  }
});

// POST /auth/login
authRouter.post('/login', async (req, res) => {
  const body = parseBody(loginInput, req, res);
  if (!body) return;

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  const ok = await verifyPassword(body.password, user ? user.passwordHash : await dummyHash);
  if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password' });

  res.json({ user: publicUser(user), token: await signToken(user.id) });
});

// POST /auth/logout — tokens are stateless, so signing out is the client
// discarding its token; this exists so the app has one call to make.
authRouter.post('/logout', (_req, res) => {
  res.json({});
});

// GET /auth/me — session restore on app launch
authRouter.get('/me', requireAuth, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId)).limit(1);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: publicUser(user) });
});
