# NTDCP Website — Frontend + Backend

A redesign of the Neglected Tropical Diseases Control Programme (NTDCP) site,
Ministry of Health, United Republic of Tanzania — restyled with the layout
patterns of ihi.or.tz (mega-menu navigation, hero + events panel, animated
statistics, card grids, three-column news/resources/videos, footer visitor
counter) while keeping the NTDCP's own identity (navy / teal / gold, Tanzania
emblem, and its existing content sections).

The project has two parts:

- **`frontend/`** — the public website (static HTML, CSS, vanilla JS). Pulls
  its dynamic content (news, events, activities, diseases, partners,
  resources, statistics) from the backend API, and falls back to the
  placeholder content baked into each page if the API is unreachable.
- **`backend/`** — a small Node/Express server that (a) serves the frontend,
  (b) exposes a public REST API, and (c) provides a password-protected admin
  panel for managing all site content without touching code.

## Quick start

```bash
cd backend
npm install
npm start
```

Then open:

- **Public site:** http://localhost:4000/
- **Admin panel:** http://localhost:4000/admin
  Default login — `admin` / `ChangeMe123!` (change this before deploying,
  see below).

The frontend and API are served from the same origin (port 4000), so no
separate frontend server or CORS setup is needed.

## Project structure

```
ntdcp/
├── frontend/                  Public website
│   ├── index.html, about.html, diseases.html, activities.html,
│   │   activity.html, partners.html, publications.html, media.html,
│   │   contact.html
│   ├── partials/               header.html / footer.html (injected by JS)
│   ├── uploads/                 Files uploaded via the admin panel
│   └── assets/
│       ├── css/style.css       Design tokens + all page styles
│       ├── js/main.js          Nav, carousel, counters, API calls, forms
│       └── img/                Hero + placeholder SVG art
│
└── backend/                    Express server
    ├── server.js                Entry point
    ├── config.js                Session secret / port
    ├── db.js                    Tiny JSON-file datastore helper
    ├── data/db.json              All content, units, users & events live here
    ├── lib/
    │   ├── credentials.js         Username/password verification (bcrypt)
    │   ├── orgTree.js             Unit-tree helpers (subtree/visibility scoping)
    │   ├── userAccounts.js        Shared account CRUD (used by both admin UIs)
    │   ├── activityStatus.js      Computes Upcoming/Ongoing/Awaiting Report/Completed
    │   ├── mailer.js              Sends reminder email (or logs to Mail Outbox if no SMTP)
    │   └── reminders.js           Periodic job: emails units ahead of their activities
    ├── middleware/auth.js        requireAdmin (site CMS) / requireLogin + requireCalendarAdmin (calendar)
    ├── routes/
    │   ├── api.js                Public read API + contact form
    │   ├── adminAuth.js          /admin/login, /admin/logout (admin role only)
    │   ├── adminApi.js           Protected CRUD API for the admin panel (incl. Units & Users)
    │   ├── upload.js             Protected image/document upload endpoint
    │   ├── calendarAuth.js       /calendar/login, /calendar/logout (any role)
    │   ├── calendarApi.js        Unit-scoped calendar CRUD, comments, attachments, reports
    │   └── calendarAdminApi.js   Calendar's own Admin tab: accounts + danger zone
    ├── public/admin/             Site CMS UI (login.html, index.html, app.js)
    └── public/calendar/          Program Calendar UI:
        ├── login.html, index.html (Calendar), reporting.html, profile.html, admin.html
        └── nav.js                 Shared top nav + conflict-detection helpers
```

## Public API (read-only, used by the frontend)

| Method | Endpoint              | Notes                                  |
|--------|-----------------------|-----------------------------------------|
| GET    | `/api/statistics`     | Visitor counters + programme stats      |
| GET    | `/api/events?limit=N` | Upcoming events, newest first           |
| GET    | `/api/news?limit=N`   | News posts, newest first                |
| GET    | `/api/activities?limit=N` | Activity cards, newest first        |
| GET    | `/api/activities/:id` | Single activity (used by activity.html) |
| GET    | `/api/diseases`       | Disease list                            |
| GET    | `/api/partners`       | Partner list                            |
| GET    | `/api/resources?limit=N` | Publications / resource list         |
| POST   | `/api/contact`        | Body: `{ name, email, subject, message }` |

## Admin panel

The admin panel (`/admin`) lets a non-technical staff member manage every
list on the site — News, Events, Activities, Diseases, Partners, Resources —
plus edit the visitor/programme statistics shown in the footer and homepage,
and review messages submitted through the Contact page.

Any image or file field (news/activity images, partner logos, resource
documents) has an **Upload…** button next to it: pick a file from your
computer and it's saved to `frontend/uploads/`, with the field auto-filled
with its URL. You can still paste an external URL directly into the field
instead if you prefer. Uploads accept images (JPG, PNG, GIF, WEBP, SVG) plus,
for resource/document fields, PDF, Word, Excel, and PowerPoint files, up to
10MB, and are rejected with a clear error otherwise. The upload endpoint
(`POST /api/admin/upload`) requires an authenticated admin session, same as
the rest of the admin API.

It's a generic CRUD UI (`backend/public/admin/app.js`) driven by a small
schema per collection, calling the protected API at `/api/admin/...`, which
requires a logged-in session (`middleware/auth.js`).

### Changing the admin password

Generate a new bcrypt hash and set it via environment variable (recommended
for production), or edit `backend/config.js` directly:

```bash
node -e "console.log(require('bcryptjs').hashSync('YourNewPassword', 10))"
```

```bash
export ADMIN_USERNAME=youradmin
export ADMIN_PASSWORD_HASH='$2b$10$...'   # paste the generated hash
export SESSION_SECRET='some-long-random-string'
npm start
```

## Programme Calendar (role- and unit-scoped)

Alongside the public website, the backend now runs an internal **Programme
Calendar** for staff — a shared activity calendar where visibility depends on
where you sit in the organisation.

- **Organisational Units** form a tree (e.g. *Ministry of Health* →
  *NTD Control Programme* → *Surveillance & Mapping Unit*, *MDA & Logistics
  Unit*, etc.; and separately *Ministry of Health* → *Environmental Health
  and Sanitation Section* → *Food, Water, Hygiene and Environmental
  Sanitation Unit*, *Occupational Health and Safety Unit*, *Port Health
  Services Unit*, *Environmental Health Protection Unit*), managed under the
  admin panel's **Organisational Units** tab.
- **Staff accounts** each have a role, a home unit, and a *visibility* unit
  (managed under the admin panel's **Staff Accounts** tab):
  - **Staff** — see and manage activities for their own unit only.
  - **Leader** — see and manage activities for their unit **and every unit
    beneath it**. A Programme Manager whose home unit is "NTD Control
    Programme" therefore sees the combined calendar of every unit under that
    programme, while a Unit Head whose home unit is one specific unit sees
    only that unit — the same role can mean a narrow or a wide view,
    depending on where they sit in the tree.
  - **Admin** — sees and manages everything, plus the site's content-management
    panel.
- A unit's calendar is independent of every other unit's by default; a
  leader's broader visibility is an explicit grant (their `visibilityUnitId`),
  not a side effect of their title.

### Trying it out

Visit **`/calendar`** (or click **Staff Login** in the site's top bar) and
sign in with any of the seeded demo accounts — all use the password
`ChangeMe123!`:

| Username              | Role    | Home unit                    | Sees calendar for                          |
|-----------------------|---------|-------------------------------|---------------------------------------------|
| `admin`               | admin   | Ministry of Health             | Everything                                   |
| `programme.manager`   | leader  | NTD Control Programme          | The whole programme (all 5 sub-units)        |
| `surveillance.lead`   | leader  | Surveillance & Mapping Unit     | Surveillance & Mapping Unit only             |
| `surveillance.staff`  | staff   | Surveillance & Mapping Unit     | Surveillance & Mapping Unit only             |
| `mda.staff`           | staff   | MDA & Logistics Unit            | MDA & Logistics Unit only                    |

Each account can add, edit, and delete activities for any unit within its own
management scope (its home unit and, for leaders, everything beneath it), and
sees a **Month, Week, Day, or Agenda view**, a per-day detail view, and a unit
filter/legend color-coded by unit.

### Discussion, attachments, and reminders

Every activity supports:
- **A cover image** — anyone who can manage an activity can add a photo when
  creating or editing it (upload from device or paste a URL, same pattern as
  the site's content editor). It shows as a thumbnail in day/agenda views and
  as a banner in the activity detail modal. This works identically whether
  you're signed in as an admin, a leader, or regular staff — it's the same
  shared calendar UI for every role.
- **Comments** — anyone who can *see* an activity can discuss it; a comment
  can be deleted by its author or by anyone with manage rights over that
  unit.
- **File attachments** — anyone who can see an activity can attach a file
  (up to 10MB); attachments are served through a scope-checked endpoint, so a
  direct link only works for someone with visibility into that unit.
- **Email reminders** — when creating or editing an activity, choose "remind
  N days before" (or no reminder). A background check runs every 15 minutes
  (and once at server startup) and emails everyone whose home unit matches
  the activity, once, ahead of the start date.

**Email delivery**: if `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` environment
variables are set, reminders are sent for real via SMTP. Without them (the
default), reminders are simulated and logged to the admin panel's **Mail
Outbox** tab instead — so the whole feature is testable without a real mail
account. That tab also has a "Check reminders now" button to trigger a sweep
immediately, rather than waiting up to 15 minutes.

```bash
export SMTP_HOST=smtp.example.com
export SMTP_PORT=587
export SMTP_USER=you@example.com
export SMTP_PASS=your-app-password
export SMTP_FROM="NTDCP Programme Calendar <you@example.com>"
npm start
```

### Beyond the basics: a full Program Calendar app

The calendar portal now has its own persistent navigation — **Calendar |
Activity Reporting | Profile | Admin** (Admin only shown to admin accounts) —
and several features modeled on how larger programme-calendar tools work:

- **Multiple views** — Month, Week, Day, and Agenda.
- **Participants** — assign one or more officers to an activity (not just a
  unit). Anyone within your view scope can be assigned.
- **Scheduling conflict detection** — a banner (shown on both the Calendar
  and Activity Reporting pages) automatically flags when the same person is
  booked on two overlapping activities, computed live from participant
  overlaps — no manual tagging needed.
- **Officer Timeline** — a Gantt-style chart on the Calendar page showing
  every visible officer's activities across the month, with weekends shaded
  and double-bookings outlined in red.
- **Activity Reporting page** — a master table of every activity in view.
  Status is computed automatically from today's date and whether a report
  has been filed — it's never set by hand:
  - **Upcoming** — hasn't started yet.
  - **Ongoing** — today falls within its date range.
  - **Awaiting Report** — its dates have passed and no report has been filed.
  - **Completed** — a report has been filed (permanently, regardless of date).

  A "Report" action lets anyone with manage rights log what happened once an
  activity is done, which files the report and moves it to Completed.
- **Profile page** — every account can update their own name, email, mobile,
  education, and password. Role, unit, and visibility privilege are shown
  read-only (an administrator sets those).
- **Admin page** (admin accounts only, at `/calendar/admin.html`) — account
  management with a live Online/Offline indicator (active in the last 5
  minutes), login counts and last-login time, per-account Uploads/Reports
  toggles, a one-click "Normal (own unit) / Administration (all units)"
  privilege switch, password reset, a new-account form, and a danger-zone
  "delete all activities" action.

This Admin page is separate from, and in addition to, the site's own
`/admin` content-management panel — one manages *who can use the calendar
and what they can see*, the other manages *what's published on the public
website*. Both draw from the same Users/Units data, so a change made in one
(e.g. adding a unit) is immediately visible in the other.

### Calendar API

All endpoints below require a signed-in session (any role) and are
automatically scoped to what that user is allowed to see/manage — attempting
to view or write outside that scope returns `403`.

| Method | Endpoint                        | Notes                                              |
|--------|----------------------------------|-----------------------------------------------------|
| GET    | `/api/calendar/context`          | Current user + the units they can view/manage       |
| GET    | `/api/calendar/events?start=&end=&unitId=` | Events within the caller's visibility scope |
| GET    | `/api/calendar/events/:id`       | A single event, with its comments and attachments   |
| POST   | `/api/calendar/events`           | Create — `unitId` must be within the caller's manage scope; accepts `reminderDaysBefore`, `image` |
| PUT    | `/api/calendar/events/:id`       | Edit — existing and new `unitId` must be manageable |
| DELETE | `/api/calendar/events/:id`       | Delete — must be within the caller's manage scope   |
| POST   | `/api/calendar/upload-image`     | Upload a cover image for an activity — any signed-in account |
| GET/PUT | `/api/calendar/me`              | View/update your own name, email, mobile, education, password |
| GET    | `/api/calendar/officers`         | Officers within your view scope, for assigning participants |
| POST   | `/api/calendar/events/:id/report` | Submit a completion report — marks the activity Completed |

Admin-only, at `/api/calendar/admin/...` (separate from the site-CMS admin API):

| Method | Endpoint                          | Notes                                   |
|--------|-------------------------------------|--------------------------------------------|
| GET/POST/PUT/DELETE | `/api/calendar/admin/accounts` | Manage staff accounts                   |
| GET    | `/api/calendar/admin/units`      | Full unit list, for the account form      |
| DELETE | `/api/calendar/admin/activities` | Danger zone — deletes every activity in the system |
| POST   | `/api/calendar/events/:id/comments` | Add a comment — requires view access            |
| DELETE | `/api/calendar/events/:id/comments/:commentId` | Requires being the author, or manage rights |
| POST   | `/api/calendar/events/:id/attachments` | Upload a file (multipart `file`) — requires view access |
| DELETE | `/api/calendar/events/:id/attachments/:attachmentId` | Requires being the uploader, or manage rights |
| GET    | `/api/calendar/attachments/:filename` | Downloads a file — only if the caller can view its event |

Managing the org chart and accounts (admin only, via `/api/admin/...`):

| Method | Endpoint                    | Notes                                    |
|--------|------------------------------|--------------------------------------------|
| GET/POST/PUT/DELETE | `/api/admin/collections/units` | Manage the unit tree (`name`, `parentId`) |
| GET/POST/PUT/DELETE | `/api/admin/users`             | Manage staff accounts, roles, and unit assignment |

## Data storage

Content is stored in a single JSON file, `backend/data/db.json`. This keeps
the project dependency-free (no database server, no native modules to
compile) and is easy to back up — just copy the file. If you outgrow it,
every route only ever calls the small helper in `backend/db.js`
(`read()` / `write()` / `nextId()`), so swapping in a real database (Postgres,
SQLite, MongoDB) means changing that one file rather than every route.

## Customising the design

All design tokens (colors, fonts, spacing, radius) live at the top of
`frontend/assets/css/style.css` as CSS custom properties — change them there
to re-theme the whole site. The header/footer markup lives once in
`frontend/partials/`, so navigation changes only need to be made in one place.

## Notes

- No photography is bundled (none was available to reuse), so hero banners
  and disease icons use simple, on-brand SVG illustrations and gradients
  instead. Swap in real photos by pointing `background-image` in
  `index.html`'s `.hero-slide` elements, or the `image` field on any content
  item in the admin panel, at real image URLs.
- The contact form posts to `/api/contact` and stores submissions in
  `db.json`, visible under **Contact Messages** in the admin panel. Wire it
  to a real email service (e.g. Nodemailer + SMTP) in
  `backend/routes/api.js` when you're ready to receive messages by email.
