import type { Request } from 'express';

// The database stores plain 'YYYY-MM-DD' strings, so "today" has to be
// decided in the user's timezone, not the server's (Vercel runs in UTC).
// Clients send an IANA name in the X-Timezone header (or ?tz=); anything
// missing or invalid falls back to UTC.

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTz(req: Request): string {
  const raw = req.header('x-timezone') ?? req.query.tz;
  return typeof raw === 'string' && isValidTz(raw) ? raw : 'UTC';
}

export function dateInTz(d: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function todayIn(tz: string): string {
  return dateInTz(new Date(), tz);
}

// Calendar arithmetic on 'YYYY-MM-DD' strings (noon UTC avoids DST edges).
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 0 = Sunday
export function weekdayIndex(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
