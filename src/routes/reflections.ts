import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reflections } from '../db/schema.js';
import { isoDate, parseBody, parseId } from '../lib/http.js';

export const reflectionsRouter = Router();

const reflectionFields = z.object({
  date: isoDate,
  wentWell: z.string().trim().min(1).max(5000),
  mistakes: z.string().trim().min(1).max(5000),
  learned: z.string().trim().min(1).max(5000),
});
const reflectionUpdate = reflectionFields.partial();

const serialize = (r: typeof reflections.$inferSelect) => ({
  id: String(r.id),
  date: r.date,
  wentWell: r.wentWell,
  mistakes: r.mistakes,
  learned: r.learned,
});

const owned = (id: number, userId: number) => and(eq(reflections.id, id), eq(reflections.userId, userId));

// GET /reflections — newest first
reflectionsRouter.get('/', async (req, res) => {
  const rows = await db
    .select()
    .from(reflections)
    .where(eq(reflections.userId, req.userId))
    .orderBy(desc(reflections.date), desc(reflections.id));
  res.json(rows.map(serialize));
});

// POST /reflections
reflectionsRouter.post('/', async (req, res) => {
  const body = parseBody(reflectionFields, req, res);
  if (!body) return;
  const [row] = await db.insert(reflections).values({ ...body, userId: req.userId }).returning();
  res.status(201).json(serialize(row));
});

// PUT /reflections/:id — send any subset of the fields
reflectionsRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Reflection not found' });
  const body = parseBody(reflectionUpdate, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });
  const [row] = await db.update(reflections).set(body).where(owned(id, req.userId)).returning();
  if (!row) return res.status(404).json({ error: 'Reflection not found' });
  res.json(serialize(row));
});

// DELETE /reflections/:id
reflectionsRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.delete(reflections).where(owned(id, req.userId)).returning() : [];
  if (!row) return res.status(404).json({ error: 'Reflection not found' });
  res.status(204).send();
});
