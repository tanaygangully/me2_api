import { Router } from 'express';
import { z } from 'zod';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { passwordResets, users } from '../db/schema.js';
import {
  dummyHash,
  generateOtp,
  hashOtp,
  hashPassword,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  otpMatches,
  requireAuth,
  RESET_WINDOW_MS,
  signResetToken,
  signToken,
  verifyPassword,
  verifyResetToken,
} from '../lib/auth.js';
import { isUniqueViolation, parseBody } from '../lib/http.js';
import { sendPasswordResetCode } from '../lib/mailer.js';

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email().max(255);

const newPassword = z.string().min(8).max(128);

const signupInput = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password: newPassword,
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

// ---------------------------------------------------------------------------
// Change password (signed in)
// ---------------------------------------------------------------------------

const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword,
});

// PUT /auth/change-password
// A wrong current password is a 400, not a 401: the app treats 401 as "session
// expired" and signs the user out. Other sessions stay signed in.
authRouter.put('/change-password', requireAuth, async (req, res) => {
  const body = parseBody(changePasswordInput, req, res);
  if (!body) return;

  const [user] = await db.select().from(users).where(eq(users.id, req.userId)).limit(1);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (body.newPassword === body.currentPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password' });
  }

  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, user.id));
  res.json({});
});

// ---------------------------------------------------------------------------
// Forgot password: forgot-password → verify-otp → reset-password
// ---------------------------------------------------------------------------

const forgotPasswordInput = z.object({ email });
const verifyOtpInput = z.object({ email, otp: z.string().regex(/^\d{6}$/) });
const resetPasswordInput = z.object({ resetToken: z.string().min(1), newPassword });

const INVALID_CODE = { error: 'Invalid or expired code' };
const INVALID_RESET_TOKEN = { error: 'Invalid or expired reset token' };

// POST /auth/forgot-password — emails a 6-digit code.
// Always answers `{}` whether or not the email has an account, so it can't be
// used to find out who is registered. A code sent less than a minute ago is
// not replaced (stops the endpoint being used to spam someone's inbox).
authRouter.post('/forgot-password', async (req, res) => {
  const body = parseBody(forgotPasswordInput, req, res);
  if (!body) return;

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (user) {
    const [pending] = await db.select().from(passwordResets).where(eq(passwordResets.userId, user.id)).limit(1);
    const tooSoon = pending && Date.now() - pending.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS;

    if (!tooSoon) {
      const otp = generateOtp();
      const fresh = { otpHash: hashOtp(user.id, otp), attempts: 0, expiresAt: new Date(Date.now() + OTP_TTL_MS) };
      await db
        .insert(passwordResets)
        .values({ userId: user.id, ...fresh })
        .onConflictDoUpdate({ target: passwordResets.userId, set: { ...fresh, createdAt: new Date() } });
      try {
        await sendPasswordResetCode(user.email, user.name, otp, OTP_TTL_MS / 60_000);
      } catch (err) {
        // Reported server-side only; telling the caller would leak that the account exists.
        console.error('Failed to send password reset email:', err);
      }
    }
  }
  res.json({});
});

// POST /auth/verify-otp — checks the code, returns a short-lived reset token.
authRouter.post('/verify-otp', async (req, res) => {
  const body = parseBody(verifyOtpInput, req, res);
  if (!body) return;

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!user) return res.status(400).json(INVALID_CODE);

  // Count the attempt first, atomically, so parallel guesses can't get past
  // the cap. No row back = no code pending, expired, or attempts used up.
  const [reset] = await db
    .update(passwordResets)
    .set({ attempts: sql`${passwordResets.attempts} + 1` })
    .where(
      and(
        eq(passwordResets.userId, user.id),
        lt(passwordResets.attempts, OTP_MAX_ATTEMPTS),
        gt(passwordResets.expiresAt, new Date())
      )
    )
    .returning();
  if (!reset || !otpMatches(user.id, body.otp, reset.otpHash)) return res.status(400).json(INVALID_CODE);

  // Give the user the full window to type a new password, however late in the
  // code's own lifetime they verified.
  await db
    .update(passwordResets)
    .set({ expiresAt: new Date(Date.now() + RESET_WINDOW_MS) })
    .where(eq(passwordResets.id, reset.id));
  res.json({ resetToken: await signResetToken(reset.id) });
});

// POST /auth/reset-password — spends the reset token, sets the new password,
// and signs out every existing session.
authRouter.post('/reset-password', async (req, res) => {
  const body = parseBody(resetPasswordInput, req, res);
  if (!body) return;

  const resetId = await verifyResetToken(body.resetToken);
  if (resetId === null) return res.status(400).json(INVALID_RESET_TOKEN);

  // Deleting the row is what makes the token single-use.
  const [reset] = await db
    .delete(passwordResets)
    .where(and(eq(passwordResets.id, resetId), gt(passwordResets.expiresAt, new Date())))
    .returning();
  if (!reset) return res.status(400).json(INVALID_RESET_TOKEN);

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(body.newPassword), passwordChangedAt: new Date() })
    .where(eq(users.id, reset.userId));
  res.json({});
});
