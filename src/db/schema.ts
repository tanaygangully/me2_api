import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums — mirror the union types in the app's lib/types.ts exactly, so the
// API can validate against the same values the UI already uses. The value
// lists are exported so route validation (zod) reuses them.
//
// Expense categories are deliberately NOT an enum: the app lets users create
// custom categories, so transactions.category / category_budgets.category
// are free-form varchar.
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = ['Cash', 'Card', 'UPI'] as const;
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);

export const REMINDER_TYPES = ['Routine', 'Pre-Action', 'Missed Alert'] as const;
export const reminderTypeEnum = pgEnum('reminder_type', REMINDER_TYPES);

export const PRIORITIES = ['Low', 'Medium', 'High'] as const;
export const priorityEnum = pgEnum('priority', PRIORITIES);

export const ROUTINE_CATEGORIES = [
  'Morning',
  'Work',
  'Study',
  'Health & Fitness',
  'Evening',
  'Reflection',
] as const;
export const routineCategoryEnum = pgEnum('routine_category', ROUTINE_CATEGORIES);

export const ROUTINE_FREQUENCIES = ['Daily', 'Weekdays', 'Weekends', 'Weekly', 'Custom'] as const;
export const routineFrequencyEnum = pgEnum('routine_frequency', ROUTINE_FREQUENCIES);

// What a user can explicitly log against a routine for a day. 'Missed' and
// 'Pending' from the app's RoutineStatus are derived, never stored.
export const ROUTINE_LOG_STATUSES = ['Completed', 'Delayed', 'Skipped'] as const;
export const routineLogStatusEnum = pgEnum('routine_log_status', ROUTINE_LOG_STATUSES);

export const GOAL_CATEGORIES = ['Health', 'Skill', 'Career', 'Personal Growth'] as const;
export const goalCategoryEnum = pgEnum('goal_category', GOAL_CATEGORIES);

export const INTERVENTION_TRIGGERS = [
  'Multiple Missed Routines',
  'Broken Streak',
  'Repeated Delays',
  'Discipline Drop',
] as const;
export const interventionTriggerEnum = pgEnum('intervention_trigger', INTERVENTION_TRIGGERS);

// ---------------------------------------------------------------------------
// Users — every other table hangs a user_id off this. Every API route except
// /auth/signup and /auth/login is scoped to the signed-in user.
//
// user_id is nullable on the finance/reminders tables only because they
// pre-date auth and may hold ownerless rows; the API never returns or
// touches those. Tables added after auth are NOT NULL.
// ---------------------------------------------------------------------------

// FK to users; deleting a user removes all their data.
const userRef = () => integer('user_id').references(() => users.id, { onDelete: 'cascade' });

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(), // stored lowercased
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  userId: userRef(),
  title: varchar('title', { length: 160 }).notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  category: varchar('category', { length: 60 }).notNull(),
  date: varchar('date', { length: 10 }).notNull(), // 'YYYY-MM-DD'
  time: varchar('time', { length: 16 }).notNull(), // '1:15 PM'
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  paidForFriend: boolean('paid_for_friend').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const categoryBudgets = pgTable(
  'category_budgets',
  {
    id: serial('id').primaryKey(),
    userId: userRef(),
    category: varchar('category', { length: 60 }).notNull(),
    budget: numeric('budget', { precision: 10, scale: 2 }).notNull(),
  },
  (table) => ({
    // one budget row per category per user
    userCategoryUnique: unique().on(table.userId, table.category),
  })
);

export const savingsGoals = pgTable('savings_goals', {
  id: serial('id').primaryKey(),
  userId: userRef(),
  title: varchar('title', { length: 160 }).notNull(),
  icon: varchar('icon', { length: 80 }).notNull(),
  color: varchar('color', { length: 20 }).notNull(),
  targetAmount: numeric('target_amount', { precision: 12, scale: 2 }).notNull(),
  savedAmount: numeric('saved_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  targetDate: varchar('target_date', { length: 10 }).notNull(), // 'YYYY-MM-DD'
});

// Singleton-per-user settings row: dailySpendCap + monthBudget.
// monthSpent / daysLeftInMonth from the mock data are derived values
// (sum of this month's transactions / calendar math) — the API computes
// them on read instead of storing them, so they can't drift out of sync.
export const financeSettings = pgTable('finance_settings', {
  id: serial('id').primaryKey(),
  userId: userRef().unique(),
  dailySpendCap: numeric('daily_spend_cap', { precision: 10, scale: 2 }).notNull().default('0'),
  monthBudget: numeric('month_budget', { precision: 10, scale: 2 }).notNull().default('0'),
});

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export const reminders = pgTable('reminders', {
  id: serial('id').primaryKey(),
  userId: userRef(),
  routineName: varchar('routine_name', { length: 160 }).notNull(),
  type: reminderTypeEnum('type').notNull(),
  time: varchar('time', { length: 8 }).notNull(), // '06:30'
  leadMinutes: integer('lead_minutes'), // only used by Pre-Action / Missed Alert
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Custom expense categories (the app's finance-context "customCategories")
// ---------------------------------------------------------------------------

export const customCategories = pgTable(
  'custom_categories',
  {
    id: serial('id').primaryKey(),
    userId: userRef().notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    color: varchar('color', { length: 20 }).notNull(),
  },
  (table) => ({
    userNameUnique: unique().on(table.userId, table.name),
  })
);

// ---------------------------------------------------------------------------
// Routines
//
// Only the routine definition lives on `routines`. A routine's `status` and
// `streak` from the app's types are derived from `routine_logs` on read, so
// they can't drift out of sync and "today" rolls over with no cron job.
// ---------------------------------------------------------------------------

export const routines = pgTable('routines', {
  id: serial('id').primaryKey(),
  userId: userRef().notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  scheduledTime: varchar('scheduled_time', { length: 5 }).notNull(), // '06:30'
  category: routineCategoryEnum('category').notNull(),
  frequency: routineFrequencyEnum('frequency').notNull(),
  priority: priorityEnum('priority').notNull(),
  expectedDurationMinutes: integer('expected_duration_minutes').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// One row per routine per day, written by complete / delay / skip. The last
// action of the day wins (upsert on routine + date).
export const routineLogs = pgTable(
  'routine_logs',
  {
    id: serial('id').primaryKey(),
    userId: userRef().notNull(),
    routineId: integer('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'cascade' }),
    date: varchar('date', { length: 10 }).notNull(), // 'YYYY-MM-DD' in the user's timezone
    status: routineLogStatusEnum('status').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    routineDateUnique: unique().on(table.routineId, table.date),
  })
);

// ---------------------------------------------------------------------------
// Goals, Experience Vault, Reflections
// ---------------------------------------------------------------------------

export const goals = pgTable('goals', {
  id: serial('id').primaryKey(),
  userId: userRef().notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  description: text('description').notNull().default(''),
  category: goalCategoryEnum('category').notNull(),
  targetDate: varchar('target_date', { length: 10 }).notNull(), // 'YYYY-MM-DD'
  priority: priorityEnum('priority').notNull(),
  progress: integer('progress').notNull().default(0), // 0-100
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const vaultEntries = pgTable('vault_entries', {
  id: serial('id').primaryKey(),
  userId: userRef().notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  observation: text('observation').notNull(),
  learning: text('learning').notNull(),
  rule: text('rule').notNull(),
  date: varchar('date', { length: 10 }).notNull(), // 'YYYY-MM-DD'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reflections = pgTable('reflections', {
  id: serial('id').primaryKey(),
  userId: userRef().notNull(),
  date: varchar('date', { length: 10 }).notNull(), // 'YYYY-MM-DD'
  wentWell: text('went_well').notNull(),
  mistakes: text('mistakes').notNull(),
  learned: text('learned').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Interventions + drift-signal dismissals
//
// Interventions are generated by the server from routine history (see
// routes/interventions.ts) and stored so "Mark as handled" persists.
// dedupe_key stops the same trigger being inserted twice for the same day.
//
// Drift signals are computed on every read and never stored; only the
// user's dismissals are.
// ---------------------------------------------------------------------------

export const interventions = pgTable(
  'interventions',
  {
    id: serial('id').primaryKey(),
    userId: userRef().notNull(),
    trigger: interventionTriggerEnum('trigger').notNull(),
    message: text('message').notNull(),
    action: text('action').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    dedupeKey: varchar('dedupe_key', { length: 160 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userDedupeUnique: unique().on(table.userId, table.dedupeKey),
  })
);

export const driftDismissals = pgTable(
  'drift_dismissals',
  {
    id: serial('id').primaryKey(),
    userId: userRef().notNull(),
    signalId: varchar('signal_id', { length: 120 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userSignalUnique: unique().on(table.userId, table.signalId),
  })
);
