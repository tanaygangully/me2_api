import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { driftDismissals } from '../db/schema.js';
import { requireAuth } from '../lib/auth.js';
import { resolveTz } from '../lib/dates.js';
import { band, behaviorPatterns, driftSignals, weeklyInsight } from '../lib/discipline.js';
import { loadLedger } from '../lib/ledger.js';

// Read-only screens (Discipline Score, Monitoring, Insights, Failure
// Detection). Nothing here is stored: every response is derived from the
// user's routine history on each request — see lib/discipline.ts for the
// rules. Mounted at the app root, so each route opts in to requireAuth
// itself (a router-wide `use` would turn unknown paths into 401s).
export const insightsRouter = Router();

// GET /discipline-score
insightsRouter.get('/discipline-score', requireAuth, async (req, res) => {
  const { ledger } = await loadLedger(req.userId, resolveTz(req));
  const score = ledger.score() ?? 0;
  res.json({ score, band: band(score) });
});

// GET /discipline-history — last 7 days, oldest first
insightsRouter.get('/discipline-history', requireAuth, async (req, res) => {
  const { ledger } = await loadLedger(req.userId, resolveTz(req));
  res.json(ledger.history());
});

// GET /behavior-patterns
insightsRouter.get('/behavior-patterns', requireAuth, async (req, res) => {
  const { ledger } = await loadLedger(req.userId, resolveTz(req));
  res.json(behaviorPatterns(ledger));
});

// GET /insights/weekly
insightsRouter.get('/insights/weekly', requireAuth, async (req, res) => {
  const { ledger } = await loadLedger(req.userId, resolveTz(req));
  res.json(weeklyInsight(ledger));
});

// GET /drift-signals — currently detected signals the user hasn't dismissed
insightsRouter.get('/drift-signals', requireAuth, async (req, res) => {
  const { ledger } = await loadLedger(req.userId, resolveTz(req));
  const dismissed = await db
    .select({ signalId: driftDismissals.signalId })
    .from(driftDismissals)
    .where(eq(driftDismissals.userId, req.userId));
  const hidden = new Set(dismissed.map((d) => d.signalId));
  res.json(driftSignals(ledger).filter((s) => !hidden.has(s.id)));
});

// POST /drift-signals/:id/dismiss — signal ids embed the day they were
// detected, so a dismissed signal stays gone today but can re-appear on a
// later day if the drift is still there.
insightsRouter.post('/drift-signals/:id/dismiss', requireAuth, async (req, res) => {
  const { ledger } = await loadLedger(req.userId, resolveTz(req));
  if (!driftSignals(ledger).some((s) => s.id === req.params.id)) {
    return res.status(404).json({ error: 'Drift signal not found' });
  }
  await db
    .insert(driftDismissals)
    .values({ userId: req.userId, signalId: req.params.id })
    .onConflictDoNothing();
  res.status(204).send();
});
