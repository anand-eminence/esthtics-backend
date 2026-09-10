# TEC Admin API

Backend for the Esti Confidential daily quiz admin panel. Next.js route handlers +
Prisma + PostgreSQL, same shape as the POC's `esti-backend` so the Render setup carries over.

No UI lives here. The admin panel is `../esthetics-frontend` and talks to `/api/admin/*`.

## Run locally

```bash
createdb tec_admin          # once
cp .env.example .env        # then fill in DATABASE_URL and AUTH_SECRET
npm install
npx prisma migrate deploy   # or: npm run db:push while the schema is still moving
npm run db:seed             # five themes, settings row, administrator account
npm run dev                 # http://localhost:4001
```

Generate a real `AUTH_SECRET` with `openssl rand -base64 48`.

## Endpoints

Everything under `/api/admin/*` requires a bearer token or the `tec_admin_session`
cookie. There is one role, `ADMINISTRATOR` — everyone who can sign in has full
access, so signed in is the only gate.

| Screen | Method | Route |
|---|---|---|
| — | GET | `/api/health` |
| A1 | POST | `/api/admin/auth/login` → `{ token, user }` |
| A1 | GET | `/api/admin/auth/me` |
| A1 | POST | `/api/admin/auth/logout` |
| A2 | GET | `/api/admin/dashboard` |
| A3 | GET | `/api/admin/questions?search=&date=&themeId=&status=&slot=&page=` |
| A4 | POST | `/api/admin/questions` |
| A4 | GET·PATCH·DELETE | `/api/admin/questions/:id` |
| A5 | GET | `/api/admin/schedule?week=YYYY-MM-DD` |
| A6 | GET·POST | `/api/admin/featured` |
| A6 | GET·PATCH·DELETE | `/api/admin/featured/:id` |
| A7 | GET | `/api/admin/members?search=&sort=&activity=&page=` |
| A8 | GET | `/api/admin/members/:id` |
| A9 | GET | `/api/admin/statistics?date=YYYY-MM-DD` |
| A10 | GET·PATCH | `/api/admin/settings` |
| A10 | GET·POST | `/api/admin/users` |
| — | GET | `/api/admin/themes` |

`date` on A3 accepts a full day (`2026-08-27`) or a whole month (`2026-08`).

### Member quiz

Moved here from `esti-backend`. No auth — the member is identified by the `uid`
Circle provides. Separate CORS policy (`QUIZ_ALLOWED_ORIGINS`, wildcard by
default) because these send no cookie.

| Screen | Method | Route |
|---|---|---|
| Q1–Q3, Q9, Q10 | GET | `/api/quiz/today?uid=&email=&name=` |
| Q4, Q5 | POST | `/api/quiz/answer` |
| — | GET | `/api/quiz/answers?uid=&date=` |

`/today` never includes `correctIndex`. The only place a correct answer appears
is the reply to the member's own submission.

### Streak rules

Not specified in the proposal — these are the defaults, all in `lib/streak.ts`:

1. A day counts only when **all** of that day's non-bonus questions are answered.
   Two of three does not extend the streak.
2. The bonus never affects score or streak. It is recorded, but excluded from
   `answeredCount` and `correctCount`.
3. **A day with nothing scheduled is skipped, not treated as a miss.** The streak
   is measured against the last date that actually had questions, so an admin gap
   does not wipe every member's streak.
4. No grace period. Miss a scheduled day and the streak restarts at 1.

Change them in one place if Adam wants different behaviour.

## Rules the schema enforces

- One question per `(quizDate, slot)`. Slots 1–3 are the daily three, slot 4 is the bonus.
- One answer per `(memberId, questionId)`, so a refresh cannot double-record.
- `correctIndex` is only ever returned by admin endpoints and by the member
  answer response — never by the question feed.
- Deleting a question that members have already answered archives it instead,
  so their history stays intact.

## Not built yet

- **Results endpoint for Q8.** The end-of-quiz screen compares the member against
  the community per theme and shows how many aced it that day. The data is all
  here, but there is no `/api/quiz/results` yet.
- **Invite emails.** `POST /api/admin/users` creates the row; the set-password
  email is a TODO.
- **Rate limiting.** Planned for the member endpoints, per the proposal.
- **Content migration.** The POC's questions and answers are still in the old
  Neon database and have not been copied across.

## Cutover from esti-backend

`esti-backend` still serves live members, so it has been left running. Retire it
in this order:

1. Deploy this service with `QUIZ_ALLOWED_ORIGINS` set.
2. Migrate the POC questions and members across.
3. Point the quiz at this origin (`apiBase` in `esti-frontend/script.js`, and the
   `apiBaseUrl` in `circle-quiz-embed.html`).
4. Confirm real members are playing here, then delete `/api/quiz/*` from
   `esti-backend`.

Note the response shape changed with the schema — `esti-frontend/script.js` reads
the POC's field names (`aha`, `lbl`, `chair`, `slug`) and needs updating before
step 3. See the field mapping at the top of `prisma/schema.prisma`.

## Deploy (Render)

Build `npm install && npx prisma generate && npm run build`, pre-deploy
`npx prisma migrate deploy`, start `npm start`. Set `DATABASE_URL`, `AUTH_SECRET`
and `ALLOWED_ORIGINS` (must list the admin panel's origin).
