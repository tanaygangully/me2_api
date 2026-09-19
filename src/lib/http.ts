import type { Request, Response } from 'express';
import { z } from 'zod';

// 'YYYY-MM-DD' that is also a real calendar date (rejects 2026-02-31).
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Invalid date');

// 24h 'HH:MM', e.g. '06:30'.
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

// Route ids are serial ints. Returns null for anything else so the caller
// can answer 404 instead of sending NaN to Postgres.
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

// Validates req.body; on failure sends the 400 and returns null.
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  req: Request,
  res: Response
): z.infer<T> | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return null;
  }
  return parsed.data;
}

// Postgres unique_violation, whether the driver error is wrapped or not.
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
