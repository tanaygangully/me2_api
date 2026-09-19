# Password APIs — frontend handoff

Four endpoints: `PUT /auth/change-password` (Profile screen) and the
forgot-password flow `POST /auth/forgot-password` → `POST /auth/verify-otp` →
`POST /auth/reset-password`. Base URL and general conventions (headers, error
shapes, `204`s) are in `FRONTEND_HANDOFF.md`; these endpoints are also in the
Postman collection under **Auth**.

All success responses are `{}` except verify-otp, which returns `{ resetToken }`.

---

## 1. `PUT /auth/change-password` — profile/index.tsx

Signed in (`Authorization: Bearer <token>`).

```json
{ "currentPassword": "old one", "newPassword": "new one, 8+ chars" }
```

| Status | Body | What to do |
| --- | --- | --- |
| 200 | `{}` | Show success. Keep the user signed in and keep the same token. |
| 400 | `{ error: "Current password is incorrect" }` | Show under the *current password* field. |
| 400 | `{ error: "New password must be different from the current password" }` | Show under the *new password* field. |
| 400 | `{ error: { fieldErrors: { newPassword: [...] } } }` | Validation (8–128 chars). Show per field. |
| 401 | `{ error: "Unauthorized" }` | Token expired → sign out (the normal rule). |

> **A wrong current password is a 400 on purpose.** Your global "401 ⇒ sign the
> user out" handler must not fire for it.

Other devices stay signed in after a change (only a *reset* signs everything out).

---

## 2. `POST /auth/forgot-password` — forgot-password.tsx

No auth. Emails a **6-digit code** to the address.

```json
{ "email": "you@example.com" }
```

- **Always** returns `200 {}` — even if no account uses that email. That is
  deliberate (so the endpoint can't be used to discover who is registered), so
  **the copy must be neutral**: *"If an account exists for this email, we've sent
  a code."* Never say "email sent to your account" or "no account found".
- Invalid email format → `400` (`fieldErrors.email`).
- **Resend throttle:** a code sent less than **60 seconds** ago is not replaced —
  the call still returns `{}` but no new email goes out. Disable your Resend
  button for 60 s after each request (with a countdown) so this is invisible.
- A new code invalidates the previous one. Codes expire after **10 minutes**.

## 3. `POST /auth/verify-otp` — reset-password.tsx, step 1 ("Verify code")

No auth.

```json
{ "email": "you@example.com", "otp": "042917" }
```

- **`otp` must be a string of exactly 6 digits** — not a number (that drops the
  leading zero of `"042917"`). Anything else is a `400` with `fieldErrors.otp`.
- `200 { "resetToken": "<jwt>" }` → keep it **in memory/state only** (don't
  persist it) and switch the screen to the new-password step. It is valid for
  **15 minutes**.
- `400 { error: "Invalid or expired code" }` for a wrong code, an expired code,
  an unknown email, or too many tries — deliberately the same message for all
  of them. Show it under the code field.
- **Max 5 attempts per code.** After that even the correct code is rejected and
  the user must request a new one (via forgot-password). When you get this `400`
  repeatedly, offer "Resend code".

## 4. `POST /auth/reset-password` — reset-password.tsx, step 2 ("Reset password")

No auth.

```json
{ "resetToken": "<from verify-otp>", "newPassword": "new one, 8+ chars" }
```

- `200 {}` → password changed. Send the user to **login** and have them sign in
  with the new password. This call does **not** return a login token.
- `400 { error: "Invalid or expired reset token" }` → the token was already used,
  expired (15 min), or is invalid. Send the user back to step 1 (request a new code).
- `400` with `fieldErrors.newPassword` → too short/long. **The token is not spent
  by a validation failure**, so the user can correct the password and resubmit.
- The token is **single-use**. Don't retry a request that already succeeded.
- A successful reset **signs out every existing session** (all devices). Any
  other request using an older token will get `401`.

---

## Flow at a glance

```
forgot-password.tsx  ── POST /auth/forgot-password {email}      → {}   ──► go to reset-password (carry `email`)
reset-password.tsx
   step 1  (OTP field)   POST /auth/verify-otp {email, otp}     → {resetToken}   keep in state
           "Resend"      POST /auth/forgot-password {email}     → {}   (60 s cooldown)
   step 2  (new pw +     POST /auth/reset-password              → {}   ──► login screen
            confirm)          {resetToken, newPassword}
```

The screen needs the **email** in step 1 — pass it from forgot-password.tsx
(route param or state). The raw OTP is only ever sent to `verify-otp`, never again.

## Error handling summary

None of these endpoints return `401` for a business error (only change-password
without a valid token does), so you can show `error` messages inline without
treating them as session problems. `error` is a **string** for the messages above
and an **object** (`{ formErrors, fieldErrors }`) for validation failures.

## Testing during development

- With no email provider configured, the server **prints the code to its console**
  (`[dev email] to=… Your ME2 password reset code is 123456`) instead of emailing it.
  Run `npm run dev` and read the terminal.
- On the deployed server, emails are only sent once `RESEND_API_KEY` and
  `MAIL_FROM` are set in Vercel; **until then forgot-password returns `{}` but
  nothing is delivered** — the flow can't be tested end-to-end on production yet.
- Postman: **Auth → Forgot password** → read the code → **Verify OTP** (saves
  `{{resetToken}}`) → **Reset password**.
