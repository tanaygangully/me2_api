# me2-server

Backend API for the "Me" app: auth, routines, reminders, goals, experience
vault, reflections, discipline/insights, interventions and finance.
Stack: Express + Drizzle ORM + Neon (serverless Postgres), deployed as a
single Vercel serverless function.

## 1. Create the Neon project

1. Sign up at https://neon.tech (no card needed).
2. Create a project (e.g. `me2`).
3. Copy the connection string from the dashboard.

## 2. Local setup

```bash
npm install
cp .env.example .env
# paste your Neon connection string into DATABASE_URL in .env
# set JWT_SECRET to a long random string:  openssl rand -hex 32
```

## 3. Create the tables (schema → migration, before any API work)

```bash
npm run db:generate   # reads src/db/schema.ts, writes SQL into ./drizzle
npm run db:migrate    # applies that SQL to your Neon database
```

Re-run both commands any time you change `src/db/schema.ts`.

Optional: `npm run db:studio` opens Drizzle Studio, a browser UI to look at
the actual tables/rows in Neon.

## 4. Run the API locally

```bash
npm run dev
```

Server runs at `http://localhost:4000`. Try `GET /health`.

## 5. Deploy to Vercel

```bash
npm i -g vercel   # if you don't have it
vercel
```

Add `DATABASE_URL` and `JWT_SECRET` as environment variables in the Vercel
project settings (same values as your `.env`). `vercel.json` routes every request
into the one serverless function in `api/index.ts`, which wraps the same
Express app you ran locally.

## Conventions

- **Auth.** Everything except `/health` and `/auth/signup|login|logout` needs
  `Authorization: Bearer <token>` (returned by signup/login, valid 30 days).
  Every route only ever sees the signed-in user's data; someone else's id is a
  `404`.
- **Timezone.** "Today" is decided in the caller's timezone. Send
  `X-Timezone: Asia/Kolkata` (or `?tz=`) on every request; it falls back to
  UTC. This affects routine status/streaks, the discipline score, and
  `monthSpent` / `daysLeftInMonth`.
- **Shapes.** Responses match the app's `lib/types.ts`: ids are strings,
  money is a number. `PUT` accepts any subset of a resource's fields.
  Deletes return `204`. Validation errors return `400 { error }`.

## Endpoints

### Auth

| Method | Path            | Purpose                                     |
| ------ | --------------- | ------------------------------------------- |
| POST   | `/auth/signup`  | `{name, email, password}` → `{user, token}` |
| POST   | `/auth/login`   | `{email, password}` → `{user, token}`       |
| POST   | `/auth/logout`  | → `{}` (tokens are stateless; client drops its token) |
| GET    | `/auth/me`      | → `{user}` (session restore)                |

### Routines

| Method | Path                     | Purpose                                            |
| ------ | ------------------------ | -------------------------------------------------- |
| GET    | `/routines`              | List, each with derived `status` and `streak`      |
| POST   | `/routines`              | Create                                             |
| GET    | `/routines/:id`          | Detail                                             |
| PUT    | `/routines/:id`          | Edit                                               |
| DELETE | `/routines/:id`          | Delete                                             |
| PATCH  | `/routines/:id/toggle`   | `{enabled}`                                        |
| POST   | `/routines/:id/complete` | Record today as Completed (returns the routine)    |
| POST   | `/routines/:id/delay`    | Record today as Delayed                            |
| POST   | `/routines/:id/skip`     | Record today as Skipped                            |

The last of complete/delay/skip on a given day wins. `status` is
Completed/Delayed/Skipped for today if logged, otherwise `Pending`; a
scheduled day with nothing logged counts as `Missed` in history.

### Reminders, Goals, Vault, Reflections

| Resource    | Path                | Methods                                         |
| ----------- | ------------------- | ----------------------------------------------- |
| Reminders   | `/reminders`        | GET, POST · GET/PUT/DELETE `/:id` · PATCH `/:id/toggle` `{enabled}` |
| Goals       | `/goals`            | GET, POST · GET/PUT/DELETE `/:id`               |
| Vault       | `/vault-entries`    | GET, POST · GET/PUT/DELETE `/:id`               |
| Reflections | `/reflections`      | GET, POST · PUT/DELETE `/:id`                   |

### Discipline, monitoring, insights (derived, read-only)

| Method | Path                          | Response                                              |
| ------ | ----------------------------- | ----------------------------------------------------- |
| GET    | `/discipline-score`           | `{score, band}` — band: Low <40, Improving <70, Strong <90, Exceptional |
| GET    | `/discipline-history`         | Last 7 days, `[{day, score}]`                         |
| GET    | `/behavior-patterns`          | `[{id, label, detail, severity}]`                     |
| GET    | `/insights/weekly`            | `{completionRate, scoreTrend, bestDay, hardestRoutine, patternNote}` |
| GET    | `/drift-signals`              | Detected, undismissed `[{id, title, detail, detectedAt, suggestion}]` |
| POST   | `/drift-signals/:id/dismiss`  | Hide a signal for today                               |

### Interventions

| Method | Path                          | Purpose                                     |
| ------ | ----------------------------- | ------------------------------------------- |
| GET    | `/interventions?resolved=false` | List (omit `resolved` for all)            |
| PATCH  | `/interventions/:id/resolve`  | "Mark as handled"                           |

### Finance — base path `/finance`

| Method | Path                            | Purpose                                                  |
| ------ | ------------------------------- | -------------------------------------------------------- |
| GET    | `/transactions`                 | List (filters: `category`, `date`, or `from`/`to`)       |
| POST   | `/transactions`                 | Add                                                      |
| GET/PUT/DELETE | `/transactions/:id`     | One transaction                                          |
| GET    | `/category-budgets`             | `[{category, budget}]`                                   |
| PUT    | `/category-budgets/:category`   | `{budget}` — create or update                            |
| GET/POST | `/categories/custom`          | Custom categories `{id, name, color}`                    |
| PUT/DELETE | `/categories/custom/:id`    | Edit / delete                                            |
| GET/POST | `/savings-goals`              | List / create                                            |
| GET/PUT/DELETE | `/savings-goals/:id`    | One goal (PATCH also works for PUT)                      |
| GET    | `/settings`                     | `{dailySpendCap, monthBudget, monthSpent, daysLeftInMonth}` |
| PUT    | `/settings/daily-cap`           | `{dailySpendCap}`                                        |
| PUT    | `/settings`                     | `{dailySpendCap?, monthBudget?}` (the only way to set `monthBudget`) |
| GET    | `/summary?month=YYYY-MM`        | `{month, monthSpent, daysLeftInMonth}`                   |

## Notes on the schema

- Nothing that can be computed is stored. A routine's `status` and `streak`,
  the discipline score/history, patterns, weekly insight, drift signals, and
  `monthSpent` / `daysLeftInMonth` are all derived on each request — from
  `routine_logs` (one row per routine per day) and `transactions`. The rules
  live in `src/lib/discipline.ts` and are plain functions, so they're easy to
  tune (score weights, band cut-offs, thresholds are constants at the top).
- **Interventions are created lazily**: there is no scheduler, so each
  `GET /interventions` checks the user's history and stores any newly
  triggered ones (with a 3-day cooldown per trigger).
- Passwords are hashed with scrypt; tokens are HS256 JWTs signed with
  `JWT_SECRET`. There is no rate limiting on login yet.
- Expense categories are free text (the app allows custom ones), so
  `transactions.category` / `category_budgets.category` are varchar, not an enum.
- `user_id` is nullable on the finance/reminders tables only because they
  pre-date auth; the API never returns rows without an owner. Newer tables
  are NOT NULL. Deleting a user cascades to all their data.
- Other enums (`payment_method`, `reminder_type`, routine/goal/priority
  values, …) match the union types in `lib/types.ts` exactly.
# me2_api
