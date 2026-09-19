import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { REMINDER_TYPES, reminders } from '../db/schema.js';
import { hhmm, parseBody, parseId } from '../lib/http.js';

export const remindersRouter = Router();

const reminderFields = z.object({
  routineName: z.string().trim().min(1).max(160),
  type: z.enum(REMINDER_TYPES),
  time: hhmm,
  leadMinutes: z.number().int().positive().optional(),
  enabled: z.boolean(),
});
// `enabled` defaults on create only, so a partial update can't silently re-enable.
const reminderCreate = reminderFields.extend({ enabled: z.boolean().optional() });
const reminderUpdate = reminderFields.partial();
const toggleInput = z.object({ enabled: z.boolean() });

const serialize = (r: typeof reminders.$inferSelect) => ({
  id: String(r.id),
  routineName: r.routineName,
  type: r.type,
  time: r.time,
  ...(r.leadMinutes !== null && { leadMinutes: r.leadMinutes }),
  enabled: r.enabled,
});

const owned = (id: number, userId: number) => and(eq(reminders.id, id), eq(reminders.userId, userId));

// GET /reminders
remindersRouter.get('/', async (req, res) => {
  const rows = await db.select().from(reminders).where(eq(reminders.userId, req.userId)).orderBy(reminders.time, reminders.id);
  res.json(rows.map(serialize));
});

// POST /reminders
remindersRouter.post('/', async (req, res) => {
  const body = parseBody(reminderCreate, req, res);
  if (!body) return;
  const [row] = await db
    .insert(reminders)
    .values({ ...body, enabled: body.enabled ?? true, userId: req.userId })
    .returning();
  res.status(201).json(serialize(row));
});

// GET /reminders/:id
remindersRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.select().from(reminders).where(owned(id, req.userId)).limit(1) : [];
  if (!row) return res.status(404).json({ error: 'Reminder not found' });
  res.json(serialize(row));
});

// PUT /reminders/:id (PATCH kept as an alias) — send any subset of the fields
async function update(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Reminder not found' });
  const body = parseBody(reminderUpdate, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });
  const [row] = await db.update(reminders).set(body).where(owned(id, req.userId)).returning();
  if (!row) return res.status(404).json({ error: 'Reminder not found' });
  res.json(serialize(row));
}
remindersRouter.put('/:id', update);
remindersRouter.patch('/:id', update);

// PATCH /reminders/:id/toggle — enable/disable switch
remindersRouter.patch('/:id/toggle', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Reminder not found' });
  const body = parseBody(toggleInput, req, res);
  if (!body) return;
  const [row] = await db.update(reminders).set({ enabled: body.enabled }).where(owned(id, req.userId)).returning();
  if (!row) return res.status(404).json({ error: 'Reminder not found' });
  res.json(serialize(row));
});

// DELETE /reminders/:id
remindersRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.delete(reminders).where(owned(id, req.userId)).returning() : [];
  if (!row) return res.status(404).json({ error: 'Reminder not found' });
  res.status(204).send();
});
