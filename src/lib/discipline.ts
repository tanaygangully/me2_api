import { addDays, WEEKDAYS_LONG, WEEKDAYS_SHORT, weekdayIndex } from './dates.js';

// Pure functions over routine history — no database access, so everything
// the Discipline / Monitoring / Insights / Interventions screens show can be
// derived (and tested) from two lists: routines and their per-day logs.
//
// Vocabulary
//   logged status : what the user recorded for a day (Completed/Delayed/Skipped)
//   day status    : logged status, or 'Missed' (scheduled, past, nothing logged),
//                   or 'Pending' (scheduled today, nothing logged yet)
//   "done"        : Completed or Delayed (Delayed = did it, late)

export type Frequency = 'Daily' | 'Weekdays' | 'Weekends' | 'Weekly' | 'Custom';
export type Priority = 'Low' | 'Medium' | 'High';
export type LoggedStatus = 'Completed' | 'Delayed' | 'Skipped';
export type DayStatus = LoggedStatus | 'Missed' | 'Pending';
export type DisciplineBand = 'Low' | 'Improving' | 'Strong' | 'Exceptional';

export interface RoutineFacts {
  id: number;
  name: string;
  frequency: Frequency;
  priority: Priority;
  enabled: boolean;
  /** 'YYYY-MM-DD' in the user's timezone; nothing counts before this day. */
  createdDate: string;
}

export interface LogFacts {
  routineId: number;
  date: string;
  status: LoggedStatus;
}

export interface Entry {
  routine: RoutineFacts;
  date: string;
  status: Exclude<DayStatus, 'Pending'>;
}

// --- Tunables --------------------------------------------------------------

const PRIORITY_WEIGHT: Record<Priority, number> = { High: 3, Medium: 2, Low: 1 };
// Partial credit: a delayed routine still happened.
const STATUS_CREDIT: Record<Exclude<DayStatus, 'Pending'>, number> = {
  Completed: 1,
  Delayed: 0.5,
  Skipped: 0,
  Missed: 0,
};

const SCORE_WINDOW_DAYS = 7;
const MAX_STREAK_DAYS = 365;
/** History a caller must load so streaks and every window below are complete. */
export const LOOKBACK_DAYS = MAX_STREAK_DAYS;

const DROP_THRESHOLD = 8; // points lost in a week that count as a "drop"
const BROKEN_STREAK_LOOKBACK_DAYS = 3;

export function band(score: number): DisciplineBand {
  if (score >= 90) return 'Exceptional';
  if (score >= 70) return 'Strong';
  if (score >= 40) return 'Improving';
  return 'Low';
}

const isDone = (s: DayStatus) => s === 'Completed' || s === 'Delayed';
const isBad = (s: DayStatus) => s === 'Missed' || s === 'Skipped';

// ---------------------------------------------------------------------------

export class RoutineLedger {
  private logged = new Map<string, LoggedStatus>();

  constructor(
    readonly routines: RoutineFacts[],
    logs: LogFacts[],
    /** 'YYYY-MM-DD' in the user's timezone. */
    readonly today: string
  ) {
    for (const log of logs) this.logged.set(`${log.routineId}:${log.date}`, log.status);
  }

  isScheduled(r: RoutineFacts, date: string): boolean {
    if (!r.enabled || date < r.createdDate) return false;
    const dow = weekdayIndex(date);
    switch (r.frequency) {
      case 'Weekdays':
        return dow >= 1 && dow <= 5;
      case 'Weekends':
        return dow === 0 || dow === 6;
      case 'Weekly':
        return dow === weekdayIndex(r.createdDate);
      default:
        // 'Daily', and 'Custom' — the app has no custom-schedule data, so it
        // is treated as every day.
        return true;
    }
  }

  /** Status of a routine on a day, or null when it wasn't expected that day. */
  statusOn(r: RoutineFacts, date: string): DayStatus | null {
    const logged = this.logged.get(`${r.id}:${date}`);
    if (logged) return logged; // an explicit log always counts, scheduled or not
    if (date > this.today || !this.isScheduled(r, date)) return null;
    return date < this.today ? 'Missed' : 'Pending';
  }

  /**
   * Consecutive scheduled days, ending at `end`, on which the routine was
   * done. Days it wasn't scheduled are skipped (a Weekdays routine keeps its
   * streak over the weekend); a still-Pending today doesn't break it.
   */
  streak(r: RoutineFacts, end: string = this.today): number {
    let n = 0;
    let date = end;
    for (let i = 0; i < MAX_STREAK_DAYS && date >= r.createdDate; i++, date = addDays(date, -1)) {
      const s = this.statusOn(r, date);
      if (s === null || s === 'Pending') continue;
      if (!isDone(s)) break;
      n++;
    }
    return n;
  }

  /** Every resolved routine-day in the `days` days ending at `end` (Pending excluded). */
  entries(end: string, days: number): Entry[] {
    const out: Entry[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(end, -i);
      for (const routine of this.routines) {
        const status = this.statusOn(routine, date);
        if (status !== null && status !== 'Pending') out.push({ routine, date, status });
      }
    }
    return out;
  }

  /**
   * 0–100 priority-weighted completion over the 7 days ending at `end`;
   * null when nothing was scheduled in that window (no basis for a score).
   */
  score(end: string = this.today): number | null {
    let earned = 0;
    let possible = 0;
    for (const e of this.entries(end, SCORE_WINDOW_DAYS)) {
      const w = PRIORITY_WEIGHT[e.routine.priority];
      earned += w * STATUS_CREDIT[e.status];
      possible += w;
    }
    return possible === 0 ? null : Math.round((earned / possible) * 100);
  }

  /** Oldest → newest scores for the last 7 days, labelled 'Mon'… */
  history(): { day: string; score: number }[] {
    const out: { day: string; score: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = addDays(this.today, -i);
      out.push({ day: WEEKDAYS_SHORT[weekdayIndex(date)], score: this.score(date) ?? 0 });
    }
    return out;
  }

  /** How many points the score fell over the last week, or null if unknown / not a fall. */
  scoreDrop(): { from: number; to: number; drop: number } | null {
    const to = this.score(this.today);
    const from = this.score(addDays(this.today, -7));
    if (to === null || from === null || from - to < DROP_THRESHOLD) return null;
    return { from, to, drop: from - to };
  }
}

// ---------------------------------------------------------------------------
// Behaviour patterns (Monitoring screen)
// ---------------------------------------------------------------------------

export interface Pattern {
  id: string;
  label: string;
  detail: string;
  severity: 'Info' | 'Watch' | 'Risk';
}

const SEVERITY_RANK = { Risk: 0, Watch: 1, Info: 2 } as const;

function groupBy<T>(items: T[], key: (t: T) => string | number): Map<string | number, T[]> {
  const m = new Map<string | number, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = m.get(k);
    if (list) list.push(item);
    else m.set(k, [item]);
  }
  return m;
}

/** The weekday (last 4 weeks) on which most scheduled routines were missed or skipped. */
function hardestWeekday(ledger: RoutineLedger) {
  const byDay = groupBy(ledger.entries(ledger.today, 28), (e) => weekdayIndex(e.date));
  let worst: { name: string; bad: number; total: number; rate: number } | null = null;
  for (const [dow, list] of byDay) {
    if (list.length < 3) continue; // too little data to call it a pattern
    const bad = list.filter((e) => isBad(e.status)).length;
    const rate = bad / list.length;
    if (rate >= 0.4 && (!worst || rate > worst.rate)) {
      worst = { name: WEEKDAYS_LONG[dow as number], bad, total: list.length, rate };
    }
  }
  return worst;
}

/** Routines delayed 3+ times in the last 2 weeks, worst first. */
function delayedRoutines(ledger: RoutineLedger) {
  const byRoutine = groupBy(ledger.entries(ledger.today, 14), (e) => e.routine.id);
  return [...byRoutine.values()]
    .map((list) => ({
      routine: list[0].routine,
      delays: list.filter((e) => e.status === 'Delayed').length,
    }))
    .filter((r) => r.delays >= 3)
    .sort((a, b) => b.delays - a.delays);
}

/** Routines completed on time in ≥85% of at least 5 scheduled days (last 2 weeks). */
function stableRoutines(ledger: RoutineLedger) {
  const byRoutine = groupBy(ledger.entries(ledger.today, 14), (e) => e.routine.id);
  return [...byRoutine.values()]
    .map((list) => ({
      routine: list[0].routine,
      completed: list.filter((e) => e.status === 'Completed').length,
      total: list.length,
    }))
    .filter((r) => r.total >= 5 && r.completed / r.total >= 0.85)
    .sort((a, b) => b.completed / b.total - a.completed / a.total);
}

export function behaviorPatterns(ledger: RoutineLedger): Pattern[] {
  const patterns: Pattern[] = [];

  const hardest = hardestWeekday(ledger);
  if (hardest) {
    patterns.push({
      id: 'hardest-day',
      label: `${hardest.name}s are your hardest day`,
      detail: `${hardest.bad} of ${hardest.total} scheduled routines were missed or skipped on ${hardest.name}s in the last 4 weeks.`,
      severity: hardest.bad / hardest.total >= 0.6 ? 'Risk' : 'Watch',
    });
  }

  for (const { routine, delays } of delayedRoutines(ledger).slice(0, 2)) {
    patterns.push({
      id: `late-${routine.id}`,
      label: `${routine.name} keeps starting late`,
      detail: `Delayed ${delays} times in the last 2 weeks.`,
      severity: delays >= 5 ? 'Risk' : 'Watch',
    });
  }

  for (const { routine, completed, total } of stableRoutines(ledger).slice(0, 2)) {
    patterns.push({
      id: `stable-${routine.id}`,
      label: `${routine.name} is stable`,
      detail: `Completed on time ${completed} of the last ${total} scheduled days.`,
      severity: 'Info',
    });
  }

  return patterns.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ---------------------------------------------------------------------------
// Weekly insight
// ---------------------------------------------------------------------------

export interface WeeklyInsight {
  completionRate: number;
  scoreTrend: number[];
  bestDay: string;
  hardestRoutine: string;
  patternNote: string;
}

const NO_DATA = 'Not enough data yet';

export function weeklyInsight(ledger: RoutineLedger): WeeklyInsight {
  const week = ledger.entries(ledger.today, 7);
  const completionRate = week.length
    ? Math.round((week.filter((e) => isDone(e.status)).length / week.length) * 100)
    : 0;

  // Best weekday: highest done-rate over 4 weeks (needs 2+ data points).
  let bestDay = NO_DATA;
  let bestRate = -1;
  for (const [dow, list] of groupBy(ledger.entries(ledger.today, 28), (e) => weekdayIndex(e.date))) {
    if (list.length < 2) continue;
    const rate = list.filter((e) => isDone(e.status)).length / list.length;
    if (rate > bestRate) {
      bestRate = rate;
      bestDay = WEEKDAYS_LONG[dow as number];
    }
  }

  // Hardest routine: lowest done-rate over 2 weeks (needs 3+ data points, and < 100%).
  let hardestRoutine = NO_DATA;
  let worstRate = 1;
  for (const list of groupBy(ledger.entries(ledger.today, 14), (e) => e.routine.id).values()) {
    if (list.length < 3) continue;
    const rate = list.filter((e) => isDone(e.status)).length / list.length;
    if (rate < worstRate) {
      worstRate = rate;
      hardestRoutine = list[0].routine.name;
    }
  }

  const notes: string[] = [];
  const hardest = hardestWeekday(ledger);
  if (hardest) notes.push(`You miss or skip routines most on ${hardest.name}s.`);
  const late = delayedRoutines(ledger)[0];
  if (late) notes.push(`You often start ${late.routine.name} late.`);

  return {
    completionRate,
    scoreTrend: ledger.history().map((h) => h.score),
    bestDay,
    hardestRoutine,
    patternNote: notes.length ? notes.join(' ') : 'Keep logging routines to surface your patterns.',
  };
}

// ---------------------------------------------------------------------------
// Drift signals (Failure Detection) — computed on read, never stored.
// ---------------------------------------------------------------------------

export interface DriftSignal {
  id: string;
  title: string;
  detail: string;
  detectedAt: string;
  suggestion: string;
}

/** Routine-days missed or skipped in the last 2 fully elapsed days. */
function recentBad(ledger: RoutineLedger) {
  const entries = ledger.entries(addDays(ledger.today, -1), 2);
  return { bad: entries.filter((e) => isBad(e.status)).length, total: entries.length };
}

export function driftSignals(ledger: RoutineLedger): DriftSignal[] {
  const signals: DriftSignal[] = [];
  const { today } = ledger;

  const { bad, total } = recentBad(ledger);
  if (total >= 4 && bad / total >= 0.4) {
    signals.push({
      id: `completion-drop:${today}`,
      title: `Missed ${bad} of ${total} routines in 2 days`,
      detail: 'A short window with a sharp drop in completion.',
      detectedAt: today,
      suggestion: 'Cut today’s list to your top 2 priority routines.',
    });
  }

  const drop = ledger.scoreDrop();
  if (drop) {
    signals.push({
      id: `score-drop:${today}`,
      title: `Discipline score fell ${drop.drop} points in a week`,
      detail: `Down from ${drop.from} to ${drop.to} over the last 7 days.`,
      detectedAt: today,
      suggestion: 'Revisit your Experience Vault before planning tomorrow.',
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Intervention triggers
// ---------------------------------------------------------------------------

export type InterventionTrigger =
  | 'Multiple Missed Routines'
  | 'Broken Streak'
  | 'Repeated Delays'
  | 'Discipline Drop';

export interface InterventionCandidate {
  trigger: InterventionTrigger;
  /** Identifies what it's about, so one condition yields one intervention per day. */
  subject: string;
  message: string;
  action: string;
}

export function interventionCandidates(ledger: RoutineLedger): InterventionCandidate[] {
  const out: InterventionCandidate[] = [];
  const yesterday = addDays(ledger.today, -1);

  for (const r of ledger.routines) {
    // Broken Streak: a streak of 3+ ended by a miss/skip in the last 3 days.
    // Interventions are generated when the app next asks, so the window is
    // wider than "yesterday" — and the subject carries the day the streak
    // broke, so each break yields exactly one intervention.
    for (let i = 0, d = yesterday; i < BROKEN_STREAK_LOOKBACK_DAYS; i++, d = addDays(d, -1)) {
      const s = ledger.statusOn(r, d);
      if (s === null || !isBad(s)) continue;
      const lost = ledger.streak(r, addDays(d, -1));
      if (lost >= 3) {
        out.push({
          trigger: 'Broken Streak',
          subject: `${r.id}:${d}`,
          message: `Your ${r.name} streak just reset. One missed day doesn’t erase ${lost} good ones.`,
          action: `Do a 10-minute version of ${r.name} today to restart the streak`,
        });
        break;
      }
    }

    // Repeated Delays: delayed on each of its last 3 scheduled days.
    const recent: DayStatus[] = [];
    for (let i = 0, d = ledger.today; i < 60 && recent.length < 3; i++, d = addDays(d, -1)) {
      const s = ledger.statusOn(r, d);
      if (s !== null && s !== 'Pending') recent.push(s);
    }
    if (recent.length === 3 && recent.every((s) => s === 'Delayed')) {
      out.push({
        trigger: 'Repeated Delays',
        subject: String(r.id),
        message: `${r.name} has started late 3 days running.`,
        action: 'Move it 30 minutes earlier tomorrow',
      });
    }
  }

  const { bad } = recentBad(ledger);
  if (bad >= 3) {
    out.push({
      trigger: 'Multiple Missed Routines',
      subject: 'all',
      message: `You missed or skipped ${bad} routines in the last 2 days.`,
      action: 'Pick your top 2 routines and protect them today',
    });
  }

  const drop = ledger.scoreDrop();
  if (drop) {
    out.push({
      trigger: 'Discipline Drop',
      subject: 'score',
      message: `Your discipline score dropped ${drop.drop} points this week.`,
      action: 'Review your Experience Vault for a reset rule',
    });
  }

  return out;
}
