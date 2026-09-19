import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { GOAL_CATEGORIES, goals, PRIORITIES } from '../db/schema.js';
import { isoDate, parseBody, parseId } from '../lib/http.js';

export const goalsRouter = Router();

const goalFields = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  category: z.enum(GOAL_CATEGORIES),
  targetDate: isoDate,
  priority: z.enum(PRIORITIES),
  progress: z.number().int().min(0).max(100),
});
const goalCreate = goalFields.extend({
  description: z.string().max(2000).optional(),
  progress: z.number().int().min(0).max(100).optional(),
});
const goalUpdate = goalFields.partial();

const serialize = (g: typeof goals.$inferSelect) => ({
  id: String(g.id),
  title: g.title,
  description: g.description,
  category: g.category,
  targetDate: g.targetDate,
  priority: g.priority,
  progress: g.progress,
});

const owned = (id: number, userId: number) => and(eq(goals.id, id), eq(goals.userId, userId));

// GET /goals
goalsRouter.get('/', async (req, res) => {
  const rows = await db.select().from(goals).where(eq(goals.userId, req.userId)).orderBy(desc(goals.id));
  res.json(rows.map(serialize));
});

// POST /goals
goalsRouter.post('/', async (req, res) => {
  const body = parseBody(goalCreate, req, res);
  if (!body) return;
  const [row] = await db
    .insert(goals)
    .values({ ...body, description: body.description ?? '', progress: body.progress ?? 0, userId: req.userId })
    .returning();
  res.status(201).json(serialize(row));
});

// GET /goals/:id
goalsRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.select().from(goals).where(owned(id, req.userId)).limit(1) : [];
  if (!row) return res.status(404).json({ error: 'Goal not found' });
  res.json(serialize(row));
});

// PUT /goals/:id — send any subset of the fields
goalsRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Goal not found' });
  const body = parseBody(goalUpdate, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });
  const [row] = await db.update(goals).set(body).where(owned(id, req.userId)).returning();
  if (!row) return res.status(404).json({ error: 'Goal not found' });
  res.json(serialize(row));
});

// DELETE /goals/:id
goalsRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.delete(goals).where(owned(id, req.userId)).returning() : [];
  if (!row) return res.status(404).json({ error: 'Goal not found' });
  res.status(204).send();
});
