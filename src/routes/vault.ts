import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { vaultEntries } from '../db/schema.js';
import { isoDate, parseBody, parseId } from '../lib/http.js';

export const vaultRouter = Router();

const entryFields = z.object({
  title: z.string().trim().min(1).max(160),
  observation: z.string().trim().min(1).max(5000),
  learning: z.string().trim().min(1).max(5000),
  rule: z.string().trim().min(1).max(5000),
  date: isoDate,
});
const entryUpdate = entryFields.partial();

const serialize = (v: typeof vaultEntries.$inferSelect) => ({
  id: String(v.id),
  title: v.title,
  observation: v.observation,
  learning: v.learning,
  rule: v.rule,
  date: v.date,
});

const owned = (id: number, userId: number) => and(eq(vaultEntries.id, id), eq(vaultEntries.userId, userId));

// GET /vault-entries — newest first
vaultRouter.get('/', async (req, res) => {
  const rows = await db
    .select()
    .from(vaultEntries)
    .where(eq(vaultEntries.userId, req.userId))
    .orderBy(desc(vaultEntries.date), desc(vaultEntries.id));
  res.json(rows.map(serialize));
});

// POST /vault-entries
vaultRouter.post('/', async (req, res) => {
  const body = parseBody(entryFields, req, res);
  if (!body) return;
  const [row] = await db.insert(vaultEntries).values({ ...body, userId: req.userId }).returning();
  res.status(201).json(serialize(row));
});

// GET /vault-entries/:id
vaultRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.select().from(vaultEntries).where(owned(id, req.userId)).limit(1) : [];
  if (!row) return res.status(404).json({ error: 'Vault entry not found' });
  res.json(serialize(row));
});

// PUT /vault-entries/:id — send any subset of the fields
vaultRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Vault entry not found' });
  const body = parseBody(entryUpdate, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });
  const [row] = await db.update(vaultEntries).set(body).where(owned(id, req.userId)).returning();
  if (!row) return res.status(404).json({ error: 'Vault entry not found' });
  res.json(serialize(row));
});

// DELETE /vault-entries/:id
vaultRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.delete(vaultEntries).where(owned(id, req.userId)).returning() : [];
  if (!row) return res.status(404).json({ error: 'Vault entry not found' });
  res.status(204).send();
});
