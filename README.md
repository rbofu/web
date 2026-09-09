# Program Calendar

> **See `CHANGES.md` for a summary of the latest update** (online users,
> login frequency, activity status tracking, three-tier report visibility,
> the calendar date-range fix, and new profile fields), plus screenshots in
> `screenshots/`.

A small web app for a team of officers to share one program calendar:
login, an admin panel for creating accounts, a calendar dashboard, and an
activity reporting tab. Every activity is visible to everyone once logged
in, and the app flags when a participant is booked on two overlapping
activities at once.

## Features

- **Login** — no public sign-up; an admin creates every account.
- **Admin panel** — create/remove officer or admin accounts.
- **Activity editing** — admins can update submitted activity details if needed.
- **Staff reports** — officers can add a report and attach files for each activity.
- **Calendar dashboard** — month view of every activity, shared across all
  officers.
- **Add activity** — any logged-in officer can add an activity with a name,
  start date, end date, and participants.
- **Activity reporting tab** — a sortable table of every activity logged.
- **Conflict detection** — if the same participant appears in two
  activities whose date ranges overlap, both the calendar and the
  reporting tab flag it.

## Tech stack

Plain and easy to run anywhere: Node.js + Express, server-rendered pages
(EJS), a single SQLite file for storage, and vanilla JS on the client — no
build step, no framework to compile.

## Run it locally

```bash
npm install
cp .env.example .env      # then edit .env — set SESSION_SECRET and ADMIN_PASSWORD
npm run seed               # creates your first admin account
npm start                  # runs at http://localhost:3000
```

Log in with the admin account you just seeded, then use the **Admin** tab
to create accounts for the other officers.

## Deploying with Docker

This app can be packaged as a container and run on any host that supports
Docker or container orchestration.

```bash
docker build -t program-calendar-app .
docker run -p 3000:3000 \
 -e SESSION_SECRET="your-long-secret" \
 -e ADMIN_USERNAME="admin" \
 -e ADMIN_PASSWORD="your-password" \
 -e ADMIN_FULL_NAME="Program Administrator" \
 program-calendar-app
```

Then open http://localhost:3000 and seed the initial admin account with:

```bash
docker run --rm \
 -e SESSION_SECRET="your-long-secret" \
 -e ADMIN_USERNAME="admin" \
 -e ADMIN_PASSWORD="your-password" \
 -e ADMIN_FULL_NAME="Program Administrator" \
 program-calendar-app npm run seed
```

## Deploying to Render or Railway

If you want a managed host, connect this repository to Render or Railway
instead of running a container yourself.

- On Render, use the included `render.yaml` file to configure a web service.
 Set the required environment variables in the Render dashboard:
 `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and
 `ADMIN_FULL_NAME`.
- On Railway, connect the repo and set the same environment variables in the
 project settings.
- If the app starts without any users, it will auto-create the first admin
 using `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_FULL_NAME`.

Users can update their own name and password on the new profile page.
When an admin creates a new account, the user can log in and finish their profile there.

Both platforms can build and start the app with:

```bash
npm install --omit=dev --no-package-lock
npm start
```

On managed platforms, the SQLite database is stored in the app's local disk.
Make sure your host provides persistent storage if you want activity data to
survive restarts and redeploys.

## Project layout

```
server.js              app entry point
db.js                  SQLite connection + schema
seed.js                 creates the first admin account
middleware/auth.js      login/role checks
routes/                 auth, activities (+ API), admin
utils/conflicts.js      overlap-detection logic (server copy)
views/                  EJS page templates
public/                 CSS + client-side JS (includes a browser copy of
                         conflicts.js, kept in sync manually since there's
                         no build step)
```

## Putting it on GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

`.env` and the `data/` folder (your SQLite database) are already excluded
via `.gitignore` — don't commit real passwords or activity data.

## Deploying it so officers can reach it

This needs a host that can run a persistent Node process (unlike the static
HTML calendar from earlier, this one has a real backend and database), for
example:

- **Render** or **Railway** — connect your GitHub repo, set the environment
  variables from `.env.example` in their dashboard, and deploy. Both have
  free tiers suitable for a small team.
- **A VPS or your own server** — clone the repo, run `npm install`,
  set the `.env` file, then run it behind a process manager like `pm2` and
  a reverse proxy (Nginx) for HTTPS.

Whichever you pick, set `SESSION_SECRET` to a long random value and change
`ADMIN_PASSWORD` before seeding — don't leave the example values in place.

## Notes on the conflict check

A "conflict" here means the same participant name appears in two
activities whose date ranges overlap (including single-day activities
against each other). Names are compared case-insensitively but must be
typed the same way for the system to recognize them as the same person —
consider agreeing on a naming convention (e.g. full names) when adding
participants.
