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
3. **Supabase database** — the live data is auto-synced here on every successful fetch, and used as a fallback when the boards are unreachable.
4. **Hardcoded defaults** — last-resort times defined per masjid in [js/config.js](js/config.js).

A few cross-cutting details:

- **Time normalization** — boards mix 12-h and 24-h formats; times are normalized per prayer (e.g. Esha `7:15` → `19:15`, Fajr `5:30` stays `05:30`).
- **Shared Maghrib** — sunset is effectively the same across the area, so a valid Maghrib time fetched from any masjid is shared to fill in masajid that don't publish one.
- **Reference prayer** — Jamia's live data is probed on load to decide which prayer is "next," keeping all cards consistent.

## Project structure

| Path | Purpose |
|------|---------|
| [index.html](index.html) | Home — "Next Salah, all masajid" with filter tabs, countdown, moon phase |
| [home.html](home.html) | Alternate next-prayer view |
| [schedule.html](schedule.html) | Full daily schedule for a selected masjid |
| [admin.html](admin.html) | Password-protected manual time editor |
| [404.html](404.html) | Not-found page |
| [js/config.js](js/config.js) | Masjid list, default times, board IDs, Supabase config |
| [js/api.js](js/api.js) | Fetch/parse/cache logic and the source fallback chain |
| [js/supabase-client.js](js/supabase-client.js) | Thin Supabase REST client (query / upsert) |
| [js/app.js](js/app.js) | Schedule-page app logic |
| [js/admin.js](js/admin.js) | Admin-page logic |
| [css/style.css](css/style.css) | Shared styling (theme, layout, ornaments) |
| [setup.sql](setup.sql) | Supabase table + RLS policies |
| [manifest.json](manifest.json) / [sw.js](sw.js) | PWA manifest and offline service worker |
| [_redirects](_redirects) / [robots.txt](robots.txt) / [sitemap.xml](sitemap.xml) | Netlify & SEO config |

## Tech stack

- Vanilla **HTML / CSS / JavaScript** — no framework, no build step
- **Supabase** (Postgres + REST) for fallback storage and auto-sync
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
- **Supabase** — set `SUPABASE_URL` / `SUPABASE_KEY` in [js/config.js](js/config.js) and create the table by running [setup.sql](setup.sql) in the Supabase SQL editor.
- **Admin access** — gated by `ADMIN_PASSWORD` in [js/config.js](js/config.js).

> **Note:** `js/config.js` is shipped to the browser, so the Supabase anon key and admin password are publicly visible. The Supabase table relies on row-level security policies (read + anon write) rather than secret keys; treat the admin password as a light gate, not real security.

## Deployment

Pushing to the repository's default branch deploys to Netlify. Bump `CACHE_VERSION` in [sw.js](sw.js) on each deploy so clients pick up updated shell assets instead of stale cached copies.
