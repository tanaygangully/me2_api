import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { interventions } from '../db/schema.js';
import { resolveTz } from '../lib/dates.js';
import { interventionCandidates, type RoutineLedger } from '../lib/discipline.js';
import { parseId } from '../lib/http.js';
import { loadLedger } from '../lib/ledger.js';

export const interventionsRouter = Router();

// Don't raise the same trigger again within this window of a previous one
// (resolved or not) — otherwise "Repeated Delays" would re-fire every day.
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

const serialize = (i: typeof interventions.$inferSelect) => ({
  id: String(i.id),
  trigger: i.trigger,
  message: i.message,
  action: i.action,
  createdAt: i.createdAt.toISOString(),
  resolved: i.resolved,
});

// Interventions are created lazily: there is no scheduler, so each read
// checks the user's routine history and stores any newly-triggered ones.
// (Missed routines are an absence of events, so they can't be created at
// write time.)
async function raiseNewInterventions(userId: number, ledger: RoutineLedger) {
  const candidates = interventionCandidates(ledger).map((c) => ({
    ...c,
    // per-day key: makes the insert race-safe via the unique (user, key) index
    dedupeKey: `${c.trigger}:${c.subject}:${ledger.today}`,
    cooldownKey: `${c.trigger}:${c.subject}`,
  }));
  if (candidates.length === 0) return;

  const recent = await db
    .select({ dedupeKey: interventions.dedupeKey, createdAt: interventions.createdAt })
    .from(interventions)
    .where(
      and(
        eq(interventions.userId, userId),
        inArray(
          interventions.trigger,
          candidates.map((c) => c.trigger)
        )
      )
    )
    .orderBy(desc(interventions.createdAt))
    .limit(200);

  const cutoff = Date.now() - COOLDOWN_MS;
  const inCooldown = new Set(
    recent
      .filter((r) => r.createdAt.getTime() >= cutoff)
      // dedupeKey = "<trigger>:<subject>:<date>" → drop the date part
      .map((r) => r.dedupeKey.slice(0, r.dedupeKey.lastIndexOf(':')))
  );

  const fresh = candidates.filter((c) => !inCooldown.has(c.cooldownKey));
  if (fresh.length === 0) return;

  await db
    .insert(interventions)
    .values(
      fresh.map((c) => ({
        userId,
        trigger: c.trigger,
        message: c.message,
        action: c.action,
        dedupeKey: c.dedupeKey,
      }))
    )
    .onConflictDoNothing();
}

// GET /interventions?resolved=false
interventionsRouter.get('/', async (req, res) => {
  const { ledger } = await loadLedger(req.userId, resolveTz(req));
  await raiseNewInterventions(req.userId, ledger);

  const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : undefined;
  const rows = await db
    .select()
    .from(interventions)
    .where(
      and(
        eq(interventions.userId, req.userId),
        resolved !== undefined ? eq(interventions.resolved, resolved) : undefined
      )
    )
    .orderBy(desc(interventions.createdAt), desc(interventions.id));
  res.json(rows.map(serialize));
});

// PATCH /interventions/:id/resolve — the "Mark as handled" button
interventionsRouter.patch('/:id/resolve', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id
    ? await db
        .update(interventions)
        .set({ resolved: true })
        .where(and(eq(interventions.id, id), eq(interventions.userId, req.userId)))
        .returning()
    : [];
  if (!row) return res.status(404).json({ error: 'Intervention not found' });
  res.json(serialize(row));
});
