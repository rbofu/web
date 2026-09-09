# Changes in this update

This covers the six items requested. Everything below was tested against a
working copy of the real app and real database before delivery (see "How
this was tested" at the bottom).

## 1. Online users & login frequency (Admin panel)

- New `login_events` table logs every successful sign-in; `users.last_login_at`
  and `users.last_seen_at` track recency.
- A lightweight middleware (`middleware/auth.js` → `trackActivity`) refreshes
  `last_seen_at` on every request, throttled to once per 30 seconds per
  session so it doesn't hammer the database.
- "Online" = seen in the last 5 minutes (`ONLINE_WINDOW_MS` in
  `middleware/auth.js` — change this one constant to adjust the window).
- The Admin panel's Accounts table now shows an **Online/Offline** indicator
  and a **Logins** column (total sign-ins + last sign-in time) for every user.

## 2. "Ongoing" indicator + automatic report-status tracking

- New shared status logic in `utils/status.js` (server) and
  `public/js/status.js` (browser) computes one of four states for every
  activity:
  - **Upcoming** — before the start date
  - **Ongoing** — between start and end date (blinking pill, pulsing dot)
  - **Awaiting report** — end date has passed, no report submitted yet
  - **Completed** — end date has passed and a report has been submitted
- This shows up as a colored, blinking-when-relevant badge on: the calendar
  agenda, the calendar's day chips (small pulsing dot), the Activity
  Reporting table (new **Status** column), and the activity detail page.
- No manual step is needed — the status is computed live from today's date
  and whether a report row exists, every time the page loads.

## 3. Report visibility (Normal / Administration / Super)

- Added `users.privilege` (`normal` | `administration` | `super`, default
  `normal`). This is **separate** from the existing `role` field
  (`officer`/`admin`), which still controls who can reach the Admin panel to
  manage accounts.
- **The shared calendar and the Activity Reporting table always show every
  activity to every signed-in user, regardless of privilege** — the whole
  point of a shared calendar is that everyone can see what's planned.
- Privilege instead controls who can read a submitted **report's contents**
  (the write-up text and attachments on an activity's Report tab):
  - **Normal** — can read reports tagged with their own unit, plus any
    report they personally wrote.
  - **Administration** — can read every unit's reports.
  - **Super** — everything (this is also what a `role = admin` account
    always gets, regardless of its privilege setting).
- Enforced server-side in `routes/activities.js`
  (`scopeReportsForUser`), applied everywhere report content is rendered.
  An activity's Ongoing/Awaiting report/Completed status is always computed
  from whether a report exists at all — not from whether the viewer is
  allowed to read it — so the status badge stays accurate for everyone.
- Admins set this per-user from the Admin panel (inline dropdown in the
  Accounts table, or the account's Edit page).
- Activities are automatically tagged with their creator's unit when
  created (previously this `unit` column existed but was never populated).

## 4. Calendar date-range bug — fixed

**Root cause:** `public/js/dashboard.js` formatted calendar-grid dates with
`d.toISOString().slice(0, 10)` on a *locally-constructed* `Date`. That
function always converts to UTC first, which silently shifts the date back
by one day for any timezone ahead of UTC (e.g. East Africa Time) —
making activities visually start and end a day later than the dates that
were actually picked (3–7 June rendering as 4–8 June).

**Fix:** `fmtISO()` now builds the date string from the local
year/month/day directly, with no UTC conversion. Applied consistently in
`utils/status.js` / `public/js/status.js` too, and the various
`isCompleted` checks across `routes/activities.js` were switched from
`new Date(x) < new Date()` (same class of bug) to the same safe local-date
comparison.

Verified with a real browser (Playwright, `Africa/Dar_es_Salaam` timezone):
an activity created for 3–7 June now renders on exactly days 3, 4, 5, 6, 7.

## 5. User profile fields

Added to the `users` table and exposed on **My profile** (self-service) and
the **Admin → New account / Edit account** forms:
- Mobile number
- Highest level of education (free text)
- Email (validated with a basic format check)
- Unit (dropdown, shared list in `utils/units.js` — the same list already
  used on the report form, so it stays consistent everywhere)

## 6. Screenshots

See the attached PNGs:
- `screenshot-admin-panel.png` — Admin panel: accounts table with online
  status, login frequency, privilege control, and the new-account form.
- `screenshot-user-dashboard.png` — Signed-in calendar view showing all four
  activity statuses at once (Upcoming/Ongoing/Awaiting report/Completed).
- `screenshot-activity-reporting.png` — Activity Reporting table with the
  new Status column.
- `screenshot-profile.png` — My profile page with the new fields.
- `screenshot-officer-dashboard.png` — Same calendar view as seen by a
  non-admin officer account (no Admin nav item; report visibility scoped by
  their privilege level).

Note: the blinking effect on "Ongoing" is a CSS animation
(`public/css/features.css` → `.status-blink` / `.status-dot`) and won't show
as motion in a static screenshot — it pulses continuously in the browser.

## Other notes

- `views/partials/header.ejs`: re-added the **Profile** nav link (it had
  been removed previously due to a routing issue that no longer applies).
- A few new files: `utils/status.js`, `public/js/status.js`,
  `utils/units.js`, `views/partials/status-badge.ejs`.
- No new npm dependencies were added — everything uses packages already in
  `package.json`.

## How this was tested

`node_modules` isn't included in this zip (see Setup in `README.md` — run
`npm install`). Before packaging, I rebuilt `better-sqlite3` locally,
restored a safe working copy of your real `data/app.sqlite`, and ran the
actual server against it: logged in, created/edited/deleted accounts and
activities, submitted reports, switched privilege levels, and drove the real
calendar UI in a headless browser to confirm the date-bug fix and the status
badges — all through real HTTP requests, not just code review. Your real
`data/app.sqlite` and uploaded files in this zip are byte-identical to what
you originally sent (verified programmatically), aside from the new columns
that `db.js` will add automatically (with safe defaults) the first time you
start the app — the same lightweight migration pattern this project already
used for its earlier columns.
