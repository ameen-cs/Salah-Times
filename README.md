# Salah Times — Stanger & Ballito

Live **Jamaat (congregation) prayer times** for every masjid in Stanger (KwaDukuza) and Ballito, KwaZulu-Natal, South Africa.

**Live site:** https://stanger-salah-times.netlify.app/

The site shows the next upcoming Salah across all masajid at a glance, plus a full daily schedule per masjid — Fajr, Zohr, Asr, Maghrib, Esha, and Jumu'ah. Times are pulled automatically from each masjid's live board, so they stay current without manual updates.

## Features

- **Next Salah at a glance** — the home page ranks all masajid by their next upcoming prayer, with a live countdown to the earliest one.
- **Per-prayer filter** — switch tabs to see, for example, every masjid's Asr time sorted earliest-to-latest. Rolls over to tomorrow automatically once a prayer has passed.
- **Full schedule per masjid** — tap any masjid to see its complete day: Jamaat times, Azan (adhan) times, Jumu'ah khutbah/speaker, and extended times (Suhur ends, sunrise, Ishraq, Zawwal, sunset, etc.).
- **Friday & weekend handling** — Jumu'ah replaces Zohr on Fridays; special weekend Zohr times are applied per masjid.
- **Upcoming time changes** — seasonal time changes ("next change") published on the boards are shown and applied on the right date.
- **Live local clock**, Hijri **moon-phase** indicator (Southern-Hemisphere oriented), and Arabic calligraphy styling.
- **Installable PWA** — works offline with a cached app shell; add to home screen on mobile.
- **Admin panel** — password-protected page to manually edit/override any masjid's times.

## Masajid covered

Stanger Jamia Masjid · Musjid Noor · Munawwar Masjid · Darul Uloom · Manor Musallah · Blythedale Beach Musallah · Sunnypark Musallah · Glenhills Musallah · Chakaskraal Musjid · Ballito Jamia Masjid

## How it works

The site is a static front-end (no build step) that gathers each masjid's times through a layered fallback chain, so it stays fast and resilient even when an upstream source is down:

1. **Live board** — fetched in parallel from [MasjidBoardLive](https://masjidboardlive.com)'s JSON API (`board.php`) and premium HTML board. Chakaskraal Musjid runs its own site, which is scraped directly. All upstream requests go through a CORS proxy (`api.codetabs.com`).
2. **`localStorage` cache** — 2-hour TTL for instant repeat loads; refreshes in the background.
3. **Netlify Database** (Postgres) — the scheduled `sync-times` function stores the live data here 3× a day, and the site falls back to it when the boards are unreachable. Admin edits are stored here too.
4. **Hardcoded defaults** — last-resort times defined per masjid in [js/config.js](js/config.js).

A few cross-cutting details:

- **Time normalization** — boards mix 12-h and 24-h formats; times are normalized per prayer (e.g. Esha `7:15` → `19:15`, Fajr `5:30` stays `05:30`).
- **Shared Maghrib** — sunset is effectively the same across the area, so a valid Maghrib time fetched from any masjid is shared to fill in masajid that don't publish one.
- **Reference prayer** — Jamia's live data is probed on load to decide which prayer is "next," keeping all cards consistent.

## Project structure

| Path | Purpose |
|------|---------|
| [index.html](index.html) | Home — "Next Salah, all masajid" with filter tabs, countdown, moon phase |
| [schedule.html](schedule.html) | Full daily schedule for a selected masjid |
| [admin.html](admin.html) | Password-protected manual time editor |
| [404.html](404.html) | Not-found page |
| [js/config.js](js/config.js) | Masjid list, default times, board IDs |
| [js/api.js](js/api.js) | Fetch/parse/cache logic and the source fallback chain |
| [js/db-client.js](js/db-client.js) | Browser client for the database, via `/api/db` (query / upsert / admin login) |
| [netlify/functions/db.mjs](netlify/functions/db.mjs) | `/api/db`: public reads, password-protected writes |
| [netlify/lib/database.mjs](netlify/lib/database.mjs) | Shared, parameterised database queries |
| [js/app.js](js/app.js) | Schedule-page app logic |
| [js/admin.js](js/admin.js) | Admin-page logic |
| [css/site.css](css/site.css) | Styling for the home and schedule pages (light theme, mobile-first) |
| [css/style.css](css/style.css) | Styling for the admin and 404 pages |
| [setup.sql](setup.sql) | Database table schema |
| [scripts/migrate-from-supabase.mjs](scripts/migrate-from-supabase.mjs) | One-off copy of the old Supabase rows into the Netlify Database |
| [manifest.json](manifest.json) / [sw.js](sw.js) | PWA manifest and offline service worker |
| [_redirects](_redirects) / [robots.txt](robots.txt) / [sitemap.xml](sitemap.xml) | Netlify & SEO config |

## Tech stack

- Vanilla **HTML / CSS / JavaScript** — no framework, no build step
- **Netlify Database** (Postgres) for fallback storage, admin edits and the scheduled sync
- **MasjidBoardLive** boards + a custom scraper as live data sources
- **Netlify** static hosting with redirects
- **PWA** (service worker + manifest) for offline support and installability

## Running locally

It's a fully static site — serve the folder with any static web server:

```bash
# Python
python -m http.server 8000

# or Node
npx serve .
```

Then open http://localhost:8000. The service worker and live fetches work over `http://localhost`.

## Configuration

- **Masajid & default times** live in [js/config.js](js/config.js). Add a masjid by appending an entry to the `MOSQUES` array (id, name, `boardId`/`scrapeUrl`, and `defaults`).
- **Database** — see [Netlify Database setup](#netlify-database-setup) below. There are no database credentials in the browser code.
- **Admin access** — the admin password is checked on the server against the `ADMIN_PASSWORD` environment variable (Netlify dashboard → Site configuration → Environment variables). It is not in any file in the repo.

## Netlify Database setup

Netlify provisions the database automatically on deploy once `@netlify/database` is installed, and applies the migrations in [netlify/database/migrations](netlify/database/migrations) as part of each deploy.

1. `netlify link` (this folder is linked to the `stanger-salah-times` project).
2. Set the admin password: `netlify env:set ADMIN_PASSWORD "<password>"`.
3. Local testing: `netlify dev` runs the site, the functions and a local copy of the database.
4. Deploy (a draft with `netlify deploy`, or production with `netlify deploy --prod`). The first deploy creates the database and applies the migration.
5. Copy the old data across (read-only on the Supabase side; safe to re-run). Preview first with `--dry-run`:
   ```powershell
   $env:SUPABASE_URL = "https://api.supabase.superbbulk.co.za"
   $env:SUPABASE_KEY = "<old anon key>"
   $env:NETLIFY_DB_URL = "<from: netlify database status --branch <branch> --show-credentials>"
   node scripts/migrate-from-supabase.mjs --dry-run
   node scripts/migrate-from-supabase.mjs
   ```
6. Test `/admin.html` (log in, edit a time, save) and `/api/db` (should list the rows).

Notes:
- Visitors' browsers only read. Stored times are refreshed by the scheduled `sync-times` function and by admin edits.
- To change the schema later, add a new migration with `netlify database migrations new`. Applied migrations cannot be edited.

## Deployment

The Netlify site is **not** connected to this GitHub repo, so `git push` only saves the code. To publish, run the deploy script from the project folder in PowerShell:

```powershell
./deploy.ps1                       # production (asks you to confirm)
./deploy.ps1 -Draft                # private preview URL, live site unchanged
./deploy.ps1 -DryRun               # copy + secret scan only, deploys nothing
./deploy.ps1 -Yes -Message "note"  # skip the confirmation, add a deploy note
```

It copies the project to a temporary folder without private files (`.claude`, `.git`, `scripts`, notes), scans that copy for keys, passwords and database addresses (and stops if it finds any), deploys it with the Netlify CLI, then checks the live pages, the database and the admin endpoint. If Windows blocks the script, run `powershell -ExecutionPolicy Bypass -File .\deploy.ps1`.

Bump `CACHE_VERSION` in [sw.js](sw.js) when the shell assets or script names change, so returning visitors don't keep using stale cached copies.

To undo a bad deploy, open the site's Deploys page in the Netlify dashboard and choose "Publish deploy" on an earlier one.
