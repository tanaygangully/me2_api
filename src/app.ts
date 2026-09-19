// Must load before any router is created: it makes Express 4 forward a
// rejected async handler to the error middleware below instead of leaving it
// as an unhandled rejection that kills the process.
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './lib/auth.js';
import { authRouter } from './routes/auth.js';
import { financeRouter } from './routes/finance.js';
import { goalsRouter } from './routes/goals.js';
import { insightsRouter } from './routes/insights.js';
import { interventionsRouter } from './routes/interventions.js';
import { reflectionsRouter } from './routes/reflections.js';
import { remindersRouter } from './routes/reminders.js';
import { routinesRouter } from './routes/routines.js';
import { vaultRouter } from './routes/vault.js';

export const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Public
app.use('/auth', authRouter);

// Everything below needs `Authorization: Bearer <token>` and only ever sees
// the signed-in user's data.
app.use('/routines', requireAuth, routinesRouter);
app.use('/reminders', requireAuth, remindersRouter);
app.use('/goals', requireAuth, goalsRouter);
app.use('/vault-entries', requireAuth, vaultRouter);
app.use('/reflections', requireAuth, reflectionsRouter);
app.use('/interventions', requireAuth, interventionsRouter);
app.use('/finance', requireAuth, financeRouter);
// Discipline score/history, behavior patterns, weekly insights, drift
// signals — mounted at the root, auth is applied per route.
app.use(insightsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler — catches anything a route throws or rejects with.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // malformed JSON body (thrown by express.json())
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
