import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { routineLogs, routines } from '../db/schema.js';
import { addDays, dateInTz, todayIn } from './dates.js';
import { LOOKBACK_DAYS, RoutineLedger } from './discipline.js';

type RoutineRow = typeof routines.$inferSelect;

// Everything derived from routine history (status, streak, score, patterns,
// insights, interventions, drift) starts from this ledger.
export async function loadLedger(userId: number, tz: string) {
  const today = todayIn(tz);

  const [routineRows, logRows] = await Promise.all([
    db.select().from(routines).where(eq(routines.userId, userId)).orderBy(routines.scheduledTime, routines.id),
    db
      .select()
      .from(routineLogs)
      .where(and(eq(routineLogs.userId, userId), gte(routineLogs.date, addDays(today, -LOOKBACK_DAYS)))),
  ]);

  const ledger = new RoutineLedger(
    routineRows.map((r) => ({
      id: r.id,
      name: r.name,
      frequency: r.frequency,
      priority: r.priority,
      enabled: r.enabled,
      createdDate: dateInTz(r.createdAt, tz),
    })),
    logRows,
    today
  );
  return { ledger, routineRows };
}

// The app's `Routine` shape; `status` and `streak` are derived.
export function serializeRoutine(row: RoutineRow, ledger: RoutineLedger) {
  const facts = ledger.routines.find((r) => r.id === row.id)!;
  return {
    id: String(row.id),
    name: row.name,
    scheduledTime: row.scheduledTime,
    category: row.category,
    frequency: row.frequency,
    priority: row.priority,
    expectedDurationMinutes: row.expectedDurationMinutes,
    status: ledger.statusOn(facts, ledger.today) ?? 'Pending',
    streak: ledger.streak(facts),
    enabled: row.enabled,
  };
}
