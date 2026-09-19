import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  categoryBudgets,
  customCategories,
  financeSettings,
  PAYMENT_METHODS,
  savingsGoals,
  transactions,
} from '../db/schema.js';
import { resolveTz, todayIn } from '../lib/dates.js';
import { isoDate, isUniqueViolation, parseBody, parseId } from '../lib/http.js';

export const financeRouter = Router();

// Money columns are numeric(…) so Postgres hands them back as strings; the
// app's types want numbers.
const num = (v: string) => Number(v);

// Categories are free text — the built-ins plus whatever the user creates.
const category = z.string().trim().min(1).max(60);

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

const transactionFields = z.object({
  title: z.string().trim().min(1).max(160),
  amount: z.number().positive(),
  category,
  date: isoDate,
  time: z.string().trim().min(1).max(16), // '1:15 PM'
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidForFriend: z.boolean(),
});
const transactionCreate = transactionFields.extend({ paidForFriend: z.boolean().optional() });
const transactionUpdate = transactionFields.partial();

const serializeTransaction = (t: typeof transactions.$inferSelect) => ({
  id: String(t.id),
  title: t.title,
  amount: num(t.amount),
  category: t.category,
  date: t.date,
  time: t.time,
  paymentMethod: t.paymentMethod,
  paidForFriend: t.paidForFriend,
});

const ownedTransaction = (id: number, userId: number) =>
  and(eq(transactions.id, id), eq(transactions.userId, userId));

// GET /finance/transactions?category=Food&date=2026-09-19  (also from= / to= for a range)
financeRouter.get('/transactions', async (req, res) => {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, req.userId),
        str(req.query.category) ? eq(transactions.category, str(req.query.category)!) : undefined,
        str(req.query.date) ? eq(transactions.date, str(req.query.date)!) : undefined,
        str(req.query.from) ? gte(transactions.date, str(req.query.from)!) : undefined,
        str(req.query.to) ? lte(transactions.date, str(req.query.to)!) : undefined
      )
    )
    .orderBy(desc(transactions.date), desc(transactions.id));
  res.json(rows.map(serializeTransaction));
});

// POST /finance/transactions
financeRouter.post('/transactions', async (req, res) => {
  const body = parseBody(transactionCreate, req, res);
  if (!body) return;
  const [row] = await db
    .insert(transactions)
    .values({ ...body, amount: String(body.amount), paidForFriend: body.paidForFriend ?? false, userId: req.userId })
    .returning();
  res.status(201).json(serializeTransaction(row));
});

// GET /finance/transactions/:id
financeRouter.get('/transactions/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.select().from(transactions).where(ownedTransaction(id, req.userId)).limit(1) : [];
  if (!row) return res.status(404).json({ error: 'Transaction not found' });
  res.json(serializeTransaction(row));
});

// PUT /finance/transactions/:id — send any subset of the fields
financeRouter.put('/transactions/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Transaction not found' });
  const body = parseBody(transactionUpdate, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });
  const { amount, ...rest } = body;
  const [row] = await db
    .update(transactions)
    .set({ ...rest, ...(amount !== undefined && { amount: String(amount) }) })
    .where(ownedTransaction(id, req.userId))
    .returning();
  if (!row) return res.status(404).json({ error: 'Transaction not found' });
  res.json(serializeTransaction(row));
});

// DELETE /finance/transactions/:id
financeRouter.delete('/transactions/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.delete(transactions).where(ownedTransaction(id, req.userId)).returning() : [];
  if (!row) return res.status(404).json({ error: 'Transaction not found' });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Category budgets
// ---------------------------------------------------------------------------

// GET /finance/category-budgets → [{ category, budget }]
financeRouter.get('/category-budgets', async (req, res) => {
  const rows = await db
    .select()
    .from(categoryBudgets)
    .where(eq(categoryBudgets.userId, req.userId))
    .orderBy(categoryBudgets.id);
  res.json(rows.map((b) => ({ category: b.category, budget: num(b.budget) })));
});

const budgetInput = z.object({ budget: z.number().nonnegative() });

// PUT /finance/category-budgets/:category { budget } — creates or updates
financeRouter.put('/category-budgets/:category', async (req, res) => {
  const name = category.safeParse(req.params.category);
  if (!name.success) return res.status(400).json({ error: 'Invalid category' });
  const body = parseBody(budgetInput, req, res);
  if (!body) return;

  const [row] = await db
    .insert(categoryBudgets)
    .values({ userId: req.userId, category: name.data, budget: String(body.budget) })
    .onConflictDoUpdate({
      target: [categoryBudgets.userId, categoryBudgets.category],
      set: { budget: String(body.budget) },
    })
    .returning();
  res.json({ category: row.category, budget: num(row.budget) });
});

// ---------------------------------------------------------------------------
// Custom categories
// ---------------------------------------------------------------------------

const categoryFields = z.object({ name: category, color: z.string().trim().min(1).max(20) });
const categoryUpdate = categoryFields.partial();

const serializeCategory = (c: typeof customCategories.$inferSelect) => ({
  id: String(c.id),
  name: c.name,
  color: c.color,
});

const ownedCategory = (id: number, userId: number) =>
  and(eq(customCategories.id, id), eq(customCategories.userId, userId));

const DUPLICATE_CATEGORY = { error: 'A category with this name already exists' };

// GET /finance/categories/custom
financeRouter.get('/categories/custom', async (req, res) => {
  const rows = await db
    .select()
    .from(customCategories)
    .where(eq(customCategories.userId, req.userId))
    .orderBy(customCategories.id);
  res.json(rows.map(serializeCategory));
});

// POST /finance/categories/custom { name, color }
financeRouter.post('/categories/custom', async (req, res) => {
  const body = parseBody(categoryFields, req, res);
  if (!body) return;
  try {
    const [row] = await db.insert(customCategories).values({ ...body, userId: req.userId }).returning();
    res.status(201).json(serializeCategory(row));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json(DUPLICATE_CATEGORY);
    throw err;
  }
});

// PUT /finance/categories/custom/:id { name?, color? }
financeRouter.put('/categories/custom/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Category not found' });
  const body = parseBody(categoryUpdate, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });
  try {
    const [row] = await db.update(customCategories).set(body).where(ownedCategory(id, req.userId)).returning();
    if (!row) return res.status(404).json({ error: 'Category not found' });
    res.json(serializeCategory(row));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json(DUPLICATE_CATEGORY);
    throw err;
  }
});

// DELETE /finance/categories/custom/:id
financeRouter.delete('/categories/custom/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.delete(customCategories).where(ownedCategory(id, req.userId)).returning() : [];
  if (!row) return res.status(404).json({ error: 'Category not found' });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Savings goals
// ---------------------------------------------------------------------------

const savingsGoalFields = z.object({
  title: z.string().trim().min(1).max(160),
  icon: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(20),
  targetAmount: z.number().positive(),
  savedAmount: z.number().nonnegative(),
  targetDate: isoDate,
});
const savingsGoalCreate = savingsGoalFields.extend({ savedAmount: z.number().nonnegative().optional() });
const savingsGoalUpdate = savingsGoalFields.partial();

const serializeSavingsGoal = (g: typeof savingsGoals.$inferSelect) => ({
  id: String(g.id),
  title: g.title,
  icon: g.icon,
  color: g.color,
  targetAmount: num(g.targetAmount),
  savedAmount: num(g.savedAmount),
  targetDate: g.targetDate,
});

const ownedGoal = (id: number, userId: number) => and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId));

// GET /finance/savings-goals
financeRouter.get('/savings-goals', async (req, res) => {
  const rows = await db
    .select()
    .from(savingsGoals)
    .where(eq(savingsGoals.userId, req.userId))
    .orderBy(desc(savingsGoals.id));
  res.json(rows.map(serializeSavingsGoal));
});

// POST /finance/savings-goals
financeRouter.post('/savings-goals', async (req, res) => {
  const body = parseBody(savingsGoalCreate, req, res);
  if (!body) return;
  const [row] = await db
    .insert(savingsGoals)
    .values({
      ...body,
      targetAmount: String(body.targetAmount),
      savedAmount: String(body.savedAmount ?? 0),
      userId: req.userId,
    })
    .returning();
  res.status(201).json(serializeSavingsGoal(row));
});

// GET /finance/savings-goals/:id
financeRouter.get('/savings-goals/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.select().from(savingsGoals).where(ownedGoal(id, req.userId)).limit(1) : [];
  if (!row) return res.status(404).json({ error: 'Savings goal not found' });
  res.json(serializeSavingsGoal(row));
});

// PUT /finance/savings-goals/:id (PATCH kept as an alias) — send any subset of
// the fields, e.g. just savedAmount to top up
async function updateSavingsGoal(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Savings goal not found' });
  const body = parseBody(savingsGoalUpdate, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });
  const { targetAmount, savedAmount, ...rest } = body;
  const [row] = await db
    .update(savingsGoals)
    .set({
      ...rest,
      ...(targetAmount !== undefined && { targetAmount: String(targetAmount) }),
      ...(savedAmount !== undefined && { savedAmount: String(savedAmount) }),
    })
    .where(ownedGoal(id, req.userId))
    .returning();
  if (!row) return res.status(404).json({ error: 'Savings goal not found' });
  res.json(serializeSavingsGoal(row));
}
financeRouter.put('/savings-goals/:id', updateSavingsGoal);
financeRouter.patch('/savings-goals/:id', updateSavingsGoal);

// DELETE /finance/savings-goals/:id
financeRouter.delete('/savings-goals/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = id ? await db.delete(savingsGoals).where(ownedGoal(id, req.userId)).returning() : [];
  if (!row) return res.status(404).json({ error: 'Savings goal not found' });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Settings (daily spend cap, month budget) + derived month figures
// ---------------------------------------------------------------------------

// monthSpent / daysLeftInMonth are derived rather than stored, so they can't
// drift out of sync with the transactions.
async function monthSummary(userId: number, month: string, tz: string) {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();

  const rows = await db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.date, `${month}-01`),
        lte(transactions.date, `${month}-${String(lastDay).padStart(2, '0')}`)
      )
    );
  const monthSpent = rows.reduce((sum, r) => sum + Number(r.amount), 0);

  const [ty, tm, td] = todayIn(tz).split('-').map(Number);
  const daysLeftInMonth = ty === year && tm === mon ? lastDay - td : 0;
  return { month, monthSpent, daysLeftInMonth };
}

const currentMonth = (tz: string) => todayIn(tz).slice(0, 7);
const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

async function loadSettings(userId: number) {
  const [row] = await db.select().from(financeSettings).where(eq(financeSettings.userId, userId)).limit(1);
  return row;
}

async function saveSettings(userId: number, patch: { dailySpendCap?: number; monthBudget?: number }) {
  const existing = await loadSettings(userId);
  const values = {
    dailySpendCap: String(patch.dailySpendCap ?? existing?.dailySpendCap ?? 0),
    monthBudget: String(patch.monthBudget ?? existing?.monthBudget ?? 0),
  };
  const [row] = existing
    ? await db.update(financeSettings).set(values).where(eq(financeSettings.id, existing.id)).returning()
    : await db.insert(financeSettings).values({ ...values, userId }).returning();
  return row;
}

// GET /finance/settings → { dailySpendCap, monthBudget, monthSpent, daysLeftInMonth }
financeRouter.get('/settings', async (req, res) => {
  const tz = resolveTz(req);
  const [settings, summary] = await Promise.all([
    loadSettings(req.userId),
    monthSummary(req.userId, currentMonth(tz), tz),
  ]);
  res.json({
    dailySpendCap: settings ? num(settings.dailySpendCap) : 0,
    monthBudget: settings ? num(settings.monthBudget) : 0,
    monthSpent: summary.monthSpent,
    daysLeftInMonth: summary.daysLeftInMonth,
  });
});

const dailyCapInput = z.object({ dailySpendCap: z.number().nonnegative() });
const settingsInput = z
  .object({ dailySpendCap: z.number().nonnegative(), monthBudget: z.number().nonnegative() })
  .partial();

// PUT /finance/settings/daily-cap { dailySpendCap }
financeRouter.put('/settings/daily-cap', async (req, res) => {
  const body = parseBody(dailyCapInput, req, res);
  if (!body) return;
  const row = await saveSettings(req.userId, body);
  res.json({ dailySpendCap: num(row.dailySpendCap), monthBudget: num(row.monthBudget) });
});

// PUT /finance/settings { dailySpendCap?, monthBudget? } — the only way to set monthBudget
financeRouter.put('/settings', async (req, res) => {
  const body = parseBody(settingsInput, req, res);
  if (!body) return;
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No fields to update' });
  const row = await saveSettings(req.userId, body);
  res.json({ dailySpendCap: num(row.dailySpendCap), monthBudget: num(row.monthBudget) });
});

// GET /finance/summary?month=2026-09
financeRouter.get('/summary', async (req, res) => {
  const tz = resolveTz(req);
  const month = monthParam.safeParse(req.query.month ?? currentMonth(tz));
  if (!month.success) return res.status(400).json({ error: 'month must be YYYY-MM' });
  res.json(await monthSummary(req.userId, month.data, tz));
});
