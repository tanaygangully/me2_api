# ME2 API — frontend integration notes

Hand-off for wiring the app (`ME2/me2`) to the backend. Pair this with
`postman/me2-server.postman_collection.json`, which has an example request for
every endpoint. Full endpoint tables are in `README.md`.

**Base URL:** `https://me2-api.vercel.app` — no trailing slash. Don't use the
long per-deployment `*-projects.vercel.app` URLs; they sit behind a Vercel login
and return `401 Protected deployment`.

## 1. Two headers on every request

| Header | Value | Why |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Required on everything except `/health` and `/auth/*`. |
| `X-Timezone` | IANA zone, e.g. `Asia/Kolkata` (`Intl.DateTimeFormat().resolvedOptions().timeZone`) | "Today" is decided in this zone. Without it the server uses UTC and routine status/streaks, the discipline score and `monthSpent` roll over at the wrong hour. |

Also send `Content-Type: application/json` on requests with a body.

## 2. Auth flow

- `POST /auth/signup` `{name, email, password}` and `POST /auth/login`
  `{email, password}` both return `{ user: {id, name, email}, token }`.
- Store the token in `expo-secure-store` (not AsyncStorage).
- **App launch:** if a token is stored, call `GET /auth/me` to restore the
  session (keep `isLoading` true until it answers). `401` → discard the token,
  show login.
- **Any `401` from any endpoint** means the token is missing, invalid or expired
  (tokens last 30 days; there is no refresh token). Clear it and go to login.
- **Sign out:** discard the token locally. `POST /auth/logout` returns `{}` and
  does nothing server-side; calling it is optional.
- Passwords: min 8, max 128 characters. Emails are case-insensitive.
- Change / forgot / reset password: see `docs/PASSWORD_APIS_HANDOFF.md`.
- Every user only ever sees their own data. Another user's id returns `404`.

## 3. Response conventions

- **Ids are strings** (`"12"`), matching `lib/types.ts`. Use them as-is in URLs.
- **Money is a JSON number** (`180`, `120.5`).
- **Dates** are `YYYY-MM-DD`. Routine `scheduledTime` and reminder `time` are
  24-hour `HH:MM` (`"06:30"`). A transaction's `time` is free text (`"1:15 PM"`).
- **`DELETE` returns `204` with no body** — don't call `.json()` on it.
  `POST /drift-signals/:id/dismiss` also returns `204`.
- **`PUT` takes any subset of fields** (send only what changed). An empty body is a `400`.
- **Errors** are always `{ "error": ... }`:

  | Status | `error` | Meaning |
  | --- | --- | --- |
  | 400 | `{ formErrors: string[], fieldErrors: { field: string[] } }` | Validation failed — show `fieldErrors` against the form fields. Also `"Invalid JSON body"` / `"No fields to update"` as plain strings. |
  | 401 | `"Unauthorized"` (or `"Invalid email or password"` on login) | See auth flow above. |
  | 404 | `"… not found"` | Doesn't exist, or belongs to someone else. |
  | 409 | string | Email already registered / custom category name already exists. |
  | 500 | `"Internal server error"` | Retry / show a generic error. |

## 4. Things that are derived, not stored

Don't try to write these; they come from what the user logs.

- **Routine `status` and `streak`.** The list/detail endpoints compute them.
  `status` is only ever `Pending | Completed | Delayed | Skipped` for today (a
  routine is never `Missed` *today*; missed days show up in history/scores).
- **Recording an outcome:** `POST /routines/:id/complete | delay | skip` return
  the **updated routine** — replace it in local state, no refetch needed. The last
  tap of the day wins, so a mis-tap is corrected by tapping another button.
  A delayed routine still keeps its streak; a skip breaks it.
- **Discipline score, history, patterns, weekly insight, drift signals** are all
  computed from routine history on every request. To see them change, log
  routine outcomes.
- **Finance `monthSpent` / `daysLeftInMonth`** come from `GET /finance/settings`,
  computed from transactions. There is no endpoint to write them.
- **Interventions appear lazily**: `GET /interventions` checks the history and
  creates new ones when it's called. Refetch it when the interventions screen
  opens (and on the dashboard if you show a count).

## 5. Empty states (new account)

A new account gets empty lists everywhere, and:

- `GET /discipline-score` → `{ score: 0, band: "Low" }`
- `GET /discipline-history` → 7 points, all `score: 0`
- `GET /insights/weekly` → `completionRate: 0`, `bestDay` and `hardestRoutine` =
  `"Not enough data yet"`, `patternNote` = a "keep logging" hint
- `GET /finance/settings` → all zeros

Build real empty states for these rather than assuming data.

## 6. Screen → endpoint map

| Screen | Calls |
| --- | --- |
| login / signup / more (sign out) / launch | `/auth/login`, `/auth/signup`, discard token, `/auth/me` |
| dashboard | `/discipline-score`, `/routines`, `/auth/me` user |
| routines list / new / edit / detail | `/routines` (GET, POST), `/routines/:id` (GET, PUT, DELETE), `/routines/:id/toggle` |
| routine detail buttons | `/routines/:id/complete`, `/delay`, `/skip` |
| reminders | `/reminders`, `/reminders/:id`, `/reminders/:id/toggle` |
| goals list / new / detail | `/goals`, `/goals/:id` (new.tsx "Save goal" should `POST /goals`) |
| vault | `/vault-entries`, `/vault-entries/:id` |
| reflection | `/reflections`, `/reflections/:id` (no GET-by-id; use the list) |
| discipline-score | `/discipline-score`, `/discipline-history` |
| monitoring | `/behavior-patterns` (+ `/routines` for the counts) |
| insights | `/insights/weekly` |
| failure-detection | `/drift-signals`, `POST /drift-signals/:id/dismiss` |
| interventions | `/interventions?resolved=false`, `PATCH /interventions/:id/resolve` |
| finance home / history | `/finance/transactions` (`?category=`, `?date=`), `/finance/settings`, `/finance/category-budgets` |
| finance add | `POST /finance/transactions` |
| finance categories | `/finance/category-budgets`, `PUT /finance/category-budgets/:category` |
| manage-categories | `/finance/categories/custom` (+ `/:id`) |
| finance goals / new-goal | `/finance/savings-goals` (+ `/:id`) |
| daily-cap | `PUT /finance/settings/daily-cap` |

Setting the month budget: `PUT /finance/settings` `{ monthBudget }` (the only way).

## 7. App-side changes this implies

- `lib/mock-data.ts` and `lib/mockdata.json` go away; screens load from the API
  (loading, error and empty states for each).
- `auth-context.tsx`: `signIn` / `signUp` become async and return errors to the
  form; add token storage and the `/auth/me` restore on launch.
- `finance-context.tsx`: replace the in-memory arrays with API calls; `addTransaction`
  etc. call the endpoints and update state from the response (the server returns
  the saved record, including its real `id`). Drop the client-generated ids
  (`t${Date.now()}`).
- Custom expense categories are plain strings. Transactions and category budgets
  refer to a category by **name**, not id. URL-encode the name in
  `PUT /finance/category-budgets/:category` (`encodeURIComponent`).
- Send a category name that no longer exists after a rename/delete? The server
  doesn't enforce it — keep names consistent client-side.

## 8. Validation limits (for form validation)

- Routine: `name` 1–160; `category` Morning · Work · Study · Health & Fitness ·
  Evening · Reflection; `frequency` Daily · Weekdays · Weekends · Weekly · Custom
  (`Custom` behaves like Daily); `priority` Low · Medium · High;
  `expectedDurationMinutes` 1–1440.
- Reminder: `type` Routine · Pre-Action · Missed Alert; `leadMinutes` optional positive int.
- Goal: `category` Health · Skill · Career · Personal Growth; `progress` 0–100.
- Transaction: `amount` > 0; `paymentMethod` Cash · Card · UPI; `category` 1–60 chars, free text.
- Savings goal: `targetAmount` > 0; `savedAmount` ≥ 0. Category budget ≥ 0.
- Custom category: `name` 1–60, unique per user; `color` 1–20.

## 9. Not built yet — don't design around these

No pagination (lists return everything), no delete account, no refresh tokens, no login rate limiting, no push notifications
(reminders are stored data only — scheduling them on the device is the app's job),
no realtime updates or offline sync.
