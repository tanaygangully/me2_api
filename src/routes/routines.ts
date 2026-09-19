import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  PRIORITIES,
  ROUTINE_CATEGORIES,
  ROUTINE_FREQUENCIES,
  type ROUTINE_LOG_STATUSES,
  routineLogs,
  routines,
} from '../db/schema.js';
import { resolveTz, todayIn } from '../lib/dates.js';
import { hhmm, parseBody, parseId } from '../lib/http.js';
import { loadLedger, serializeRoutine } from '../lib/ledger.js';

export const routinesRouter = Router();

const routineFields = z.object({
  name: z.string().trim().min(1).max(160),
  scheduledTime: hhmm,
  category: z.enum(ROUTINE_CATEGORIES),
  frequency: z.enum(ROUTINE_FREQUENCIES),
  priority: z.enum(PRIORITIES),
  expectedDurationMinutes: z.number().int().positive().max(1440),
  enabled: z.boolean(),
});
// `enabled` defaults on create only (a default inside the shared schema would
// also re-enable a routine on every partial update).
const routineCreate = routineFields.extend({ enabled: z.boolean().optional() });
const routineUpdate = routineFields.partial();
const toggleInput = z.object({ enabled: z.boolean() });

// Loads one of the caller's routines together with its derived status/streak.
async function respondWithRoutine(userId: number, id: number, tz: string) {
  const { ledger, routineRows } = await loadLedger(userId, tz);
  const row = routineRows.find((r) => r.id === id);
  return row ? serializeRoutine(row, ledger) : null;
}

// GET /routines
routinesRouter.get('/', async (req, res) => {
  const { ledger, routineRows } = await loadLedger(req.userId, resolveTz(req));
  res.json(routineRows.map((r) => serializeRoutine(r, ledger)));
});

// POST /routines
routinesRouter.post('/', async (req, res) => {
  const body = parseBody(routineCreate, req, res);
  if (!body) return;
  const [row] = await db
    .insert(routines)
    .values({ ...body, enabled: body.enabled ?? true, userId: req.userId })
    .returning();
  res.status(201).json(await respondWithRoutine(req.userId, row.id, resolveTz(req)));
});

// GET /routines/:id
routinesRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const routine = id && (await respondWithRoutine(req.userId, id, resolveTz(req)));
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  res.json(routine);
});

// PUT /routines/:id — edit form save (send any subset of the fields)
routinesRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Routine not found' });
  const body = parseBody(routineUpdate, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });

  const [row] = await db
    .update(routines)
    .set(body)
    .where(and(eq(routines.id, id), eq(routines.userId, req.userId)))
    .returning();
  if (!row) return res.status(404).json({ error: 'Routine not found' });
  res.json(await respondWithRoutine(req.userId, id, resolveTz(req)));
});

// DELETE /routines/:id (its day logs go with it)
routinesRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Routine not found' });
  const [row] = await db
    .delete(routines)
    .where(and(eq(routines.id, id), eq(routines.userId, req.userId)))
    .returning();
  if (!row) return res.status(404).json({ error: 'Routine not found' });
  res.status(204).send();
});

// PATCH /routines/:id/toggle — enable/disable switch
routinesRouter.patch('/:id/toggle', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Routine not found' });
  const body = parseBody(toggleInput, req, res);
  if (!body) return;
  const [row] = await db
    .update(routines)
    .set({ enabled: body.enabled })
    .where(and(eq(routines.id, id), eq(routines.userId, req.userId)))
    .returning();
  if (!row) return res.status(404).json({ error: 'Routine not found' });
  res.json(await respondWithRoutine(req.userId, id, resolveTz(req)));
});

// POST /routines/:id/{complete,delay,skip} — record today's outcome. The last
// action of the day wins, so a mis-tap can be corrected by tapping another.
function recordOutcome(status: (typeof ROUTINE_LOG_STATUSES)[number]) {
  return async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Routine not found' });

    const [owned] = await db
      .select({ id: routines.id })
      .from(routines)
      .where(and(eq(routines.id, id), eq(routines.userId, req.userId)))
      .limit(1);
    if (!owned) return res.status(404).json({ error: 'Routine not found' });

    const tz = resolveTz(req);
    await db
      .insert(routineLogs)
      .values({ userId: req.userId, routineId: id, date: todayIn(tz), status })
      .onConflictDoUpdate({
        target: [routineLogs.routineId, routineLogs.date],
        set: { status, updatedAt: new Date() },
      });
    res.json(await respondWithRoutine(req.userId, id, tz));
  };
}

routinesRouter.post('/:id/complete', recordOutcome('Completed'));
routinesRouter.post('/:id/delay', recordOutcome('Delayed'));
routinesRouter.post('/:id/skip', recordOutcome('Skipped'));
